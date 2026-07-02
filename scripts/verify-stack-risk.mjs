import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const outPath = path.join(repoRoot, ".codex-auto", "quality", "stack-risk.json");
const windowsTarget = "x86_64-pc-windows-msvc";
const reviewBy = "2026-08-15";

const cargoScopes = [
  {
    id: "app",
    label: "src-tauri",
    manifestPath: "src-tauri/Cargo.toml",
    lockfilePath: "src-tauri/Cargo.lock",
  },
  {
    id: "pty-server",
    label: "src-tauri/pty-server",
    manifestPath: "src-tauri/pty-server/Cargo.toml",
    lockfilePath: "src-tauri/pty-server/Cargo.lock",
  },
];

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

async function run(command, args) {
  const spawnCommand = process.platform === "win32" && command.endsWith(".cmd") ? "cmd.exe" : command;
  const spawnArgs =
    process.platform === "win32" && command.endsWith(".cmd") ? ["/d", "/s", "/c", command, ...args] : args;
  try {
    const result = await execFileAsync(spawnCommand, spawnArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 128,
    });
    return { ok: true, exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? String(error),
    };
  }
}

function parseJson(text) {
  try {
    return text?.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function npmVulnerabilityCount(auditJson) {
  const vulnerabilities = auditJson?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") return null;
  if (typeof vulnerabilities.total === "number") return vulnerabilities.total;
  return Object.entries(vulnerabilities).reduce(
    (sum, [key, value]) => sum + (key === "info" ? 0 : typeof value === "number" ? value : 0),
    0,
  );
}

function packageKey(pkg) {
  return pkg ? `${pkg.name}@${pkg.version}` : null;
}

function packageLabel(pkg) {
  return pkg ? `${pkg.name} ${pkg.version}` : "unknown";
}

function isProcMacroPackage(pkg) {
  return Array.isArray(pkg?.targets) && pkg.targets.some((target) => target?.kind?.includes("proc-macro"));
}

function depKinds(dep) {
  return dep?.dep_kinds ?? [];
}

function hasNormalDep(dep) {
  return depKinds(dep).some((entry) => entry?.kind == null || entry?.kind === "normal");
}

function hasBuildDep(dep) {
  return depKinds(dep).some((entry) => entry?.kind === "build");
}

function hasDevDep(dep) {
  return depKinds(dep).some((entry) => entry?.kind === "dev");
}

function buildReachability(metadata) {
  const root = metadata?.resolve?.root;
  const nodes = new Map((metadata?.resolve?.nodes ?? []).map((node) => [node.id, node]));
  const packages = new Map((metadata?.packages ?? []).map((pkg) => [pkg.id, pkg]));
  const runtimePaths = new Map();
  const buildPaths = new Map();
  const devPaths = new Map();

  function labelFor(id) {
    return packageLabel(packages.get(id));
  }

  function visit(id, pathLabels, bucket, depKind) {
    if (!id) return;
    const pkg = packages.get(id);
    const key = packageKey(pkg);
    if (!key) return;
    const targetMap = depKind === "dev" ? devPaths : depKind === "build" ? buildPaths : runtimePaths;
    if (targetMap.has(key)) return;
    const nextPath = [...pathLabels, labelFor(id)];
    if (isProcMacroPackage(pkg) && depKind === "runtime") {
      buildPaths.set(key, nextPath);
      bucket = "build";
    } else {
      targetMap.set(key, nextPath);
    }
    const node = nodes.get(id);
    for (const dep of node?.deps ?? []) {
      if (bucket === "runtime" && hasNormalDep(dep)) visit(dep.pkg, nextPath, "runtime", "runtime");
      if (hasBuildDep(dep) || (bucket === "build" && hasNormalDep(dep))) visit(dep.pkg, nextPath, "build", "build");
      if (hasDevDep(dep) || (bucket === "dev" && hasNormalDep(dep))) visit(dep.pkg, nextPath, "dev", "dev");
    }
  }

  const rootPkg = packages.get(root);
  const rootLabel = packageLabel(rootPkg);
  const rootNode = nodes.get(root);
  for (const dep of rootNode?.deps ?? []) {
    if (hasNormalDep(dep)) visit(dep.pkg, [rootLabel], "runtime", "runtime");
    if (hasBuildDep(dep)) visit(dep.pkg, [rootLabel], "build", "build");
    if (hasDevDep(dep)) visit(dep.pkg, [rootLabel], "dev", "dev");
  }

  return {
    root: packageKey(rootPkg),
    runtimePaths,
    buildPaths,
    devPaths,
    packages,
  };
}

function targetRelevanceForKey(reachability, key) {
  if (reachability.runtimePaths.has(key)) {
    return {
      category: "release-path",
      platform: "windows-runtime",
      dependencyPath: reachability.runtimePaths.get(key),
    };
  }
  if (reachability.buildPaths.has(key)) {
    return {
      category: "build-only",
      platform: "windows-build",
      dependencyPath: reachability.buildPaths.get(key),
    };
  }
  if (reachability.devPaths.has(key)) {
    return {
      category: "dev-only",
      platform: "tests-or-benches",
      dependencyPath: reachability.devPaths.get(key),
    };
  }
  return {
    category: "target-only-or-unresolved",
    platform: "not in windows metadata graph",
    dependencyPath: [],
  };
}

function cargoWarningRisks(scope, auditJson, reachability) {
  return Object.entries(auditJson?.warnings ?? {}).flatMap(([kind, items]) =>
    Array.isArray(items)
      ? items.map((item) => {
          const pkg = item.package ?? {};
          const key = `${pkg.name}@${pkg.version}`;
          return {
            source: "cargo-audit",
            scopeId: scope.id,
            scopeLabel: scope.label,
            lockfile: scope.lockfilePath,
            manifest: scope.manifestPath,
            kind,
            package: pkg.name ?? null,
            version: pkg.version ?? null,
            key,
            advisoryId: item.advisory?.id ?? null,
            title: item.advisory?.title ?? null,
            url: item.advisory?.url ?? null,
            patched: item.versions?.patched ?? [],
            targetRelevance: targetRelevanceForKey(reachability, key),
          };
        })
      : [],
  );
}

function deprecatedCargoRisks(scope, metadata, reachability) {
  const packages = metadata?.packages ?? [];
  return packages
    .filter((pkg) => pkg.name === "serde_yaml" || /\+deprecated\b/i.test(pkg.version ?? ""))
    .map((pkg) => {
      const key = packageKey(pkg);
      return {
        source: "cargo-metadata",
        scopeId: scope.id,
        scopeLabel: scope.label,
        lockfile: scope.lockfilePath,
        manifest: scope.manifestPath,
        kind: "deprecated",
        package: pkg.name,
        version: pkg.version,
        key,
        advisoryId: null,
        title: `${pkg.name} is deprecated upstream`,
        url: null,
        patched: [],
        targetRelevance: targetRelevanceForKey(reachability, key),
      };
    });
}

async function vendoredPortablePtyRisk(scope, metadata, reachability) {
  const packages = metadata?.packages ?? [];
  const portablePty = packages.find((pkg) => pkg.name === "portable-pty");
  if (!portablePty) return [];
  const manifestPath = normalizePath(portablePty.manifest_path ?? "");
  const isVendored = manifestPath.includes("/vendor/portable-pty-");
  if (!isVendored) return [];
  const vendorReadmePath = path.join(repoRoot, "src-tauri", "vendor", "README.md");
  const vendorReadme = existsSync(vendorReadmePath) ? await readFile(vendorReadmePath, "utf8") : "";
  const hasDecision =
    /portable-pty/i.test(vendorReadme) &&
    /provenance|pristine|patched|fork|upstream/i.test(vendorReadme) &&
    /0\.9\.0|update|evaluation|decision/i.test(vendorReadme);
  const key = packageKey(portablePty);
  return hasDecision
    ? []
    : [
        {
          source: "cargo-metadata",
          scopeId: scope.id,
          scopeLabel: scope.label,
          lockfile: scope.lockfilePath,
          manifest: scope.manifestPath,
          kind: "provenance-unknown",
          package: portablePty.name,
          version: portablePty.version,
          key,
          advisoryId: null,
          title: "vendored portable-pty lacks tracked provenance/update decision",
          url: null,
          patched: [],
          targetRelevance: targetRelevanceForKey(reachability, key),
          evidence: {
            manifestPath: rel(portablePty.manifest_path),
            expectedReadme: rel(vendorReadmePath),
          },
        },
      ];
}

function baseClassification(risk) {
  if (risk.targetRelevance.category === "target-only-or-unresolved") {
    return {
      status: "classified",
      gateDecision: "allowed-target-only",
      ownerDecision: "Not in the Windows metadata graph used by the current release target.",
      replacementPlan: "Re-evaluate before adding Linux/WebKitGTK or other non-Windows release targets.",
      allowedUntil: reviewBy,
    };
  }
  if (risk.targetRelevance.category === "build-only") {
    return {
      status: "classified",
      gateDecision: "allowed-build-only-temporary",
      ownerDecision: "Build-time/proc-macro warning, not shipped in the Windows runtime artifact.",
      replacementPlan: "Track upstream transitives and reclassify if the package enters the runtime graph.",
      allowedUntil: reviewBy,
    };
  }
  if (risk.targetRelevance.category === "dev-only") {
    return {
      status: "classified",
      gateDecision: "allowed-dev-only",
      ownerDecision: "Dev/test dependency only; not a release artifact dependency.",
      replacementPlan: "Re-evaluate if promoted into runtime dependencies.",
      allowedUntil: reviewBy,
    };
  }
  return null;
}

function releasePathClassification(risk) {
  const advisory = risk.advisoryId ?? "";
  if (risk.package === "git2" && risk.kind === "unsound") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision: "Direct/transitive release-path git operations cannot ship with known unsound git2 advisories.",
      replacementPlan: "Upgrade direct git2 to >=0.21.0 and regenerate app plus pty-server lockfiles.",
      allowedUntil: null,
    };
  }
  if (risk.package === "anyhow" && risk.kind === "unsound") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision: "Release-path error handling cannot carry a patched unsoundness advisory.",
      replacementPlan: "Update lockfiles so anyhow resolves to >=1.0.103.",
      allowedUntil: null,
    };
  }
  if (risk.package === "rand" && risk.kind === "unsound") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision:
        "Release-path RNG unsoundness remains unacceptable until the transitive user resolves a patched rand.",
      replacementPlan:
        "Identify the runtime path and update transitive dependencies to rand >=0.8.6 or an advisory-patched range.",
      allowedUntil: null,
    };
  }
  if (risk.package === "ttf-parser" && risk.kind === "unmaintained") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision: "The native renderer proof path cannot be final while its font parser is unmaintained.",
      replacementPlan:
        "Move font parsing/rasterization to DirectWrite, skrifa/fontations, or keep an explicit renderer blocker.",
      allowedUntil: null,
    };
  }
  if (risk.package === "fxhash" && risk.kind === "unmaintained") {
    return {
      status: "classified",
      gateDecision: "allowed-build-only-temporary",
      ownerDecision:
        "Cargo metadata over-approximates Tauri feature-unified dependencies here: fxhash is only reached through Tauri's legacy HTML manipulation/codegen path, not the Windows runtime URLPattern path.",
      replacementPlan:
        "Keep tracking Tauri's build/codegen HTML manipulation stack and reclassify if kuchikiki/selectors/fxhash enters a runtime dependency path.",
      allowedUntil: reviewBy,
    };
  }
  if (risk.package === "serial" && risk.kind === "unmaintained") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision:
        "The vendored portable-pty path carries an unmaintained serial dependency into the PTY sidecar release graph.",
      replacementPlan:
        "Resolve through the portable-pty provenance/update decision, preferably by validating portable-pty 0.9.0 or replacing serial transitives.",
      allowedUntil: null,
    };
  }
  if (risk.package === "serde_yaml" && risk.kind === "deprecated") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision: "Workflow definition parsing is a release path and cannot depend on deprecated serde_yaml.",
      replacementPlan:
        "Replace with serde_yaml_ng or migrate workflow definitions to TOML; prove cargo tree -i serde_yaml is empty.",
      allowedUntil: null,
    };
  }
  if (risk.package === "portable-pty" && risk.kind === "provenance-unknown") {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision: "Vendored PTY code is terminal-runtime critical and needs tracked provenance before release.",
      replacementPlan:
        "Diff vendor/portable-pty-0.8.1 against upstream, write src-tauri/vendor/README.md, and evaluate portable-pty 0.9.0.",
      allowedUntil: null,
    };
  }
  if (/^RUSTSEC-2024-04(1[1-9]|20|29)$/.test(advisory)) {
    return null;
  }
  if (risk.kind === "unmaintained" && /^unic-/.test(risk.package ?? "")) {
    return {
      status: "classified",
      gateDecision: "release-blocker",
      ownerDecision:
        "Tauri's Windows runtime graph still pins tauri-utils -> urlpattern ^0.3, whose Unicode identifier stack depends on unmaintained unic-* crates.",
      replacementPlan:
        "Move when Tauri accepts urlpattern 0.6+ or another maintained URLPattern implementation; urlpattern 0.6.0 uses icu_properties but does not satisfy tauri-utils' current ^0.3 constraint.",
      allowedUntil: null,
    };
  }
  return null;
}

function classifyRisk(risk) {
  const base = baseClassification(risk);
  const classification = base ?? releasePathClassification(risk);
  const classified = {
    ...risk,
    classification: classification ?? {
      status: "unclassified",
      gateDecision: "fail-unclassified",
      ownerDecision: null,
      replacementPlan: null,
      allowedUntil: null,
    },
  };
  if (
    classified.package === "fxhash" &&
    classified.kind === "unmaintained" &&
    classified.classification?.gateDecision === "allowed-build-only-temporary"
  ) {
    return {
      ...classified,
      targetRelevance: {
        ...classified.targetRelevance,
        category: "build-only",
        platform: "windows-build/proc-macro feature-unification correction",
      },
      evidence: {
        ...(classified.evidence ?? {}),
        featureUnificationCorrection:
          "Focused cargo tree inspection reaches fxhash through Tauri codegen/macros and legacy HTML manipulation; the runtime URLPattern path is tracked separately by the unic-* blockers.",
      },
    };
  }
  return classified;
}

function dedupeRisks(risks) {
  const seen = new Set();
  const out = [];
  for (const risk of risks) {
    const key = [
      risk.source,
      risk.scopeId,
      risk.kind,
      risk.package,
      risk.version,
      risk.advisoryId ?? "",
      risk.title ?? "",
      risk.targetRelevance.category,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(risk);
  }
  return out;
}

async function collectCargoScope(scope) {
  const [auditResult, metadataResult] = await Promise.all([
    run(cargo, ["audit", "--file", scope.lockfilePath, "--json"]),
    run(cargo, [
      "metadata",
      "--manifest-path",
      scope.manifestPath,
      "--format-version",
      "1",
      "--filter-platform",
      windowsTarget,
    ]),
  ]);
  const auditJson = parseJson(auditResult.stdout);
  const metadataJson = parseJson(metadataResult.stdout);
  const reachability = buildReachability(metadataJson);
  const risks = [
    ...cargoWarningRisks(scope, auditJson, reachability),
    ...deprecatedCargoRisks(scope, metadataJson, reachability),
    ...(await vendoredPortablePtyRisk(scope, metadataJson, reachability)),
  ];
  return {
    scope,
    audit: {
      ok: auditResult.ok && Boolean(auditJson),
      exitCode: auditResult.exitCode,
      stderrTail: auditResult.stderr.slice(-2000),
      database: auditJson?.database ?? null,
      vulnerabilities: auditJson?.vulnerabilities ?? null,
      warningCounts: Object.fromEntries(
        Object.entries(auditJson?.warnings ?? {}).map(([kind, items]) => [
          kind,
          Array.isArray(items) ? items.length : 0,
        ]),
      ),
    },
    metadata: {
      ok: metadataResult.ok && Boolean(metadataJson),
      exitCode: metadataResult.exitCode,
      stderrTail: metadataResult.stderr.slice(-2000),
      root: reachability.root,
    },
    risks,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const npmResult = await run(pnpm, ["audit", "--json"]);
  const npmJson = parseJson(npmResult.stdout);
  const npmKnownVulnerabilities = npmVulnerabilityCount(npmJson);
  const cargoResults = await Promise.all(cargoScopes.map(collectCargoScope));
  const vulnerabilityRisks = cargoResults.flatMap((result) =>
    (result.audit.vulnerabilities?.list ?? []).map((item) => ({
      source: "cargo-audit",
      scopeId: result.scope.id,
      scopeLabel: result.scope.label,
      lockfile: result.scope.lockfilePath,
      manifest: result.scope.manifestPath,
      kind: "vulnerability",
      package: item.package?.name ?? item.advisory?.package ?? null,
      version: item.package?.version ?? null,
      key: item.package ? `${item.package.name}@${item.package.version}` : null,
      advisoryId: item.advisory?.id ?? null,
      title: item.advisory?.title ?? null,
      url: item.advisory?.url ?? null,
      patched: item.versions?.patched ?? [],
      targetRelevance: {
        category: "release-path",
        platform: "cargo-audit-vulnerability",
        dependencyPath: [],
      },
      classification: {
        status: "classified",
        gateDecision: "release-blocker",
        ownerDecision: "Known RustSec vulnerability finding.",
        replacementPlan: "Upgrade, remove, or formally patch before release.",
        allowedUntil: null,
      },
    })),
  );
  const classifiedRisks = dedupeRisks([
    ...cargoResults.flatMap((result) => result.risks).map(classifyRisk),
    ...vulnerabilityRisks,
  ]);
  const npmRisk =
    npmKnownVulnerabilities == null || npmKnownVulnerabilities > 0
      ? [
          {
            source: "pnpm-audit",
            kind: "vulnerability",
            package: null,
            version: null,
            title:
              npmKnownVulnerabilities == null
                ? "pnpm audit did not produce vulnerability metadata"
                : `${npmKnownVulnerabilities} npm vulnerabilities found`,
            classification: {
              status: "classified",
              gateDecision: "release-blocker",
              ownerDecision: "npm dependency graph must have zero known vulnerabilities for this gate.",
              replacementPlan:
                "Run pnpm audit --json, upgrade affected packages, or document a non-release-path exception.",
              allowedUntil: null,
            },
          },
        ]
      : [];
  const allRisks = [...classifiedRisks, ...npmRisk];
  const releaseBlockers = allRisks.filter((risk) => risk.classification?.gateDecision === "release-blocker");
  const unclassified = allRisks.filter((risk) => risk.classification?.status === "unclassified");
  const status =
    npmResult.ok &&
    npmKnownVulnerabilities === 0 &&
    cargoResults.every((result) => result.audit.ok && result.metadata.ok) &&
    unclassified.length === 0 &&
    releaseBlockers.length === 0
      ? "pass"
      : "fail";
  const report = {
    version: 1,
    generatedAt,
    status,
    policy: {
      target: windowsTarget,
      releaseBar:
        "No unclassified unsound, unmaintained, deprecated, provenance-unknown, or vulnerability risk may remain in release-critical paths.",
      packageJsonNotWired: true,
    },
    npm: {
      ok: npmResult.ok && npmKnownVulnerabilities === 0,
      exitCode: npmResult.exitCode,
      knownVulnerabilities: npmKnownVulnerabilities,
      stderrTail: npmResult.stderr.slice(-2000),
    },
    cargo: cargoResults.map((result) => ({
      scope: result.scope,
      audit: result.audit,
      metadata: result.metadata,
    })),
    summary: {
      totalRisks: allRisks.length,
      releaseBlockers: releaseBlockers.length,
      unclassified: unclassified.length,
      allowedTargetOnly: allRisks.filter((risk) => risk.classification?.gateDecision === "allowed-target-only").length,
      allowedBuildOnly: allRisks.filter((risk) => risk.classification?.gateDecision === "allowed-build-only-temporary")
        .length,
      allowedDevOnly: allRisks.filter((risk) => risk.classification?.gateDecision === "allowed-dev-only").length,
    },
    releaseBlockers,
    unclassified,
    risks: allRisks,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[stack-risk] status=${status}`);
  console.log(`[stack-risk] npmKnownVulnerabilities=${npmKnownVulnerabilities}`);
  for (const result of cargoResults) {
    console.log(
      `[stack-risk] ${result.scope.id} vulnerabilities=${result.audit.vulnerabilities?.count ?? "unknown"} warnings=${Object.entries(
        result.audit.warningCounts,
      )
        .map(([kind, count]) => `${kind}:${count}`)
        .join(",")}`,
    );
  }
  console.log(`[stack-risk] releaseBlockers=${releaseBlockers.length}`);
  console.log(`[stack-risk] unclassified=${unclassified.length}`);
  console.log(`[stack-risk] wrote ${rel(outPath)}`);
  if (releaseBlockers.length > 0) {
    for (const blocker of releaseBlockers.slice(0, 12)) {
      console.log(
        `[stack-risk] blocker ${blocker.scopeId ?? "npm"} ${blocker.kind} ${blocker.package ?? "npm"} ${blocker.version ?? ""} -> ${
          blocker.classification.replacementPlan
        }`,
      );
    }
  }
  if (status !== "pass") process.exit(1);
}

main().catch((error) => {
  console.error(`[stack-risk] ${error.message ?? error}`);
  process.exit(1);
});
