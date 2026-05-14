// Close the remaining production risk-register items after evidence exists.
//
// This script is intentionally conservative: live risks require a passing
// production smoke artifact, release risks require local custody/install
// evidence, and host-only checks are marked "accepted" with an explicit
// operational control instead of being misrepresented as fully automated.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = resolve(process.env.AETHER_PRODUCTION_ROOT ?? process.cwd());
const LOG_DIR = join(ROOT, ".codex-auto");
const OUT_DIR = join(LOG_DIR, "production-smoke");
const RELEASE_DIR = join(LOG_DIR, "release-doctor");
const RISK_REGISTER = join(LOG_DIR, "risk-register.json");
const LIVE_SMOKE = join(OUT_DIR, "live-tauri-workstation-surfaces.json");
const IME_SMOKE = join(OUT_DIR, "verify-ime.json");
const CHAOS_LIVE = join(LOG_DIR, "chaos-recovery", "p2-07-live-tauri-pty-ai-cli-chaos.json");
const SLEEP_CHAOS = join(LOG_DIR, "chaos-recovery", "p2-07-sleep-resume-db-lock-chaos.json");
const REAL_OS_SUSPEND = join(OUT_DIR, "real-os-suspend-resume.json");
const RELEASE_DOCTOR = join(RELEASE_DIR, "p2-08-release-doctor.json");
const MSI_EXTRACT = join(RELEASE_DIR, "p2-08-msi-admin-extract-production.json");
const KEY_CUSTODY = join(RELEASE_DIR, "p2-08-key-custody.json");
const ACCEPTANCE = join(OUT_DIR, "production-risk-acceptance.json");

const LIVE_RISKS = [
  "1777959386787-browser-denied-visual-pass",
  "risk-p0-12-live-webview-smoke-gap",
  "risk-ai-cli-screen-heuristic",
  "risk-p0-15-live-tauri-overlay-smoke-gap",
  "risk-p1-01-live-tauri-attach-smoke-gap",
  "risk-p1-02-intent-provider-gap",
  "risk-p1-03-live-tauri-fanout-smoke-gap",
  "risk-p1-03-sync-input-dormant-prop",
  "risk-p1-05-live-tauri-right-rail-smoke-gap",
  "risk-p1-06-live-tauri-mission-control-smoke-gap",
  "risk-p1-07-live-tauri-context-pack-copy-smoke-gap",
  "risk-p1-07-backend-diff-hunk-provider-gap",
  "risk-p1-08-live-tauri-agent-run-graph-smoke-gap",
  "risk-p1-08-backend-subagent-metadata-provider-gap",
  "risk-p1-10-git-status-diffstat-test-timeout",
  "risk-p1-10-live-tauri-review-smoke-gap",
  "risk-p1-11-live-tauri-workflow-smoke-gap",
  "risk-p2-01-live-tauri-command-risk-smoke-gap",
  "risk-p2-02-live-tauri-decision-inbox-smoke-gap",
  "risk-p2-03-live-tauri-profile-smoke-gap",
  "risk-p2-03-profile-source-alignment-gap",
];

const LIVE_RISK_ALIASES = {
  "risk-p1-06-live-tauri-mission-control-smoke-gap": ["risk-p1-06-live-tauri-right-rail-smoke-gap"],
};

const CLOSABLE_STATUSES = new Set(["closed", "mitigated", "accepted", "resolved"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function git(args) {
  return run("git", args);
}

function gitOutput(args) {
  const result = git(args);
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function assertPass(name, condition, detail) {
  if (!condition) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ""}`);
  }
}

function fileInfo(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256(path),
  };
}

function verifyLiveSmoke() {
  assertPass("live smoke artifact exists", existsSync(LIVE_SMOKE), LIVE_SMOKE);
  const live = readJson(LIVE_SMOKE);
  assertPass("live smoke status", live.status === "pass", live.status);
  for (const riskId of LIVE_RISKS) {
    const aliases = LIVE_RISK_ALIASES[riskId] ?? [];
    const covered = [riskId, ...aliases].some((candidate) => live.riskCoverage?.[candidate]?.status === "pass");
    assertPass(`live smoke coverage ${riskId}`, covered, JSON.stringify(live.riskCoverage?.[riskId]));
  }
  return {
    status: "pass",
    artifact: LIVE_SMOKE,
    completedAt: live.completedAt,
    coveredRisks: LIVE_RISKS.length,
  };
}

function verifyImeSmoke() {
  assertPass("IME smoke artifact exists", existsSync(IME_SMOKE), IME_SMOKE);
  const ime = readJson(IME_SMOKE);
  assertPass("IME smoke status", ime.status === "pass", ime.status);
  return {
    status: "pass",
    artifact: IME_SMOKE,
    completedAt: ime.completedAt,
    command: ime.command,
  };
}

function writeKeyCustodyEvidence() {
  const keyPath = join(ROOT, ".aether-updater", "aether-updater.key");
  const pubPath = join(ROOT, ".aether-updater", "aether-updater.key.pub");
  const passwordPath = join(ROOT, ".aether-updater", "aether-updater.password.txt");
  const tauriConfig = join(ROOT, "src-tauri", "tauri.conf.json");
  for (const path of [keyPath, pubPath, passwordPath, tauriConfig]) {
    assertPass("key custody input exists", existsSync(path), path);
  }
  const tracked = gitOutput(["ls-files", "--", ".aether-updater"]);
  const ignored = gitOutput(["check-ignore", "-q", ".aether-updater/aether-updater.key"]);
  const config = readJson(tauriConfig);
  const pubkey = config?.plugins?.updater?.pubkey ?? "";
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: "pass",
    secretMaterialPolicy: "hash-only",
    inputs: {
      privateKey: fileInfo(keyPath),
      publicKeyFile: fileInfo(pubPath),
      passwordFile: fileInfo(passwordPath),
      tauriConfig: fileInfo(tauriConfig),
    },
    git: {
      updaterDirIgnored: ignored.status === 0,
      updaterFilesTracked: tracked.stdout ? tracked.stdout.split(/\r?\n/).filter(Boolean) : [],
    },
    tauriUpdater: {
      pubkeyConfigured: typeof pubkey === "string" && pubkey.length > 64 && !/CHANGE_ME|placeholder/i.test(pubkey),
      pubkeySha256: typeof pubkey === "string" ? createHash("sha256").update(pubkey).digest("hex") : null,
    },
    custodyControls: [
      ".aether-updater is ignored and not tracked.",
      "Only SHA-256 hashes are written to the evidence artifact.",
      "Before public release, rotate or escrow the updater key if the local key cannot be preserved.",
    ],
  };
  report.status =
    report.git.updaterDirIgnored && report.git.updaterFilesTracked.length === 0 && report.tauriUpdater.pubkeyConfigured
      ? "pass"
      : "failed";
  writeJson(KEY_CUSTODY, report);
  assertPass("key custody", report.status === "pass", JSON.stringify(report.git));
  return report;
}

function findMsiArtifact() {
  const dir = join(ROOT, "src-tauri", "target", "release", "bundle", "msi");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".msi"))
    .map((name) => join(dir, name))
    .sort();
  return files.at(-1) ?? null;
}

function verifyMsiAdminExtract() {
  const msi = findMsiArtifact();
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: "running",
    msi,
    targetDir: join(RELEASE_DIR, "msi-admin-extract"),
    timeoutMs: 180000,
  };
  try {
    assertPass("MSI artifact exists", !!msi, "src-tauri/target/release/bundle/msi/*.msi");
    mkdirSync(report.targetDir, { recursive: true });
    const result = run("msiexec.exe", ["/a", msi, "/qn", `TARGETDIR=${report.targetDir}`], {
      timeout: report.timeoutMs,
    });
    report.exitCode = result.status;
    report.signal = result.signal ?? null;
    report.timedOut = result.error?.code === "ETIMEDOUT";
    report.stdout = result.stdout?.slice(-2000) ?? "";
    report.stderr = result.stderr?.slice(-2000) ?? "";
    report.extractedFileCount = countFiles(report.targetDir);
    report.status = result.status === 0 && !report.timedOut && report.extractedFileCount > 0 ? "pass" : "failed";
  } catch (error) {
    report.status = "failed";
    report.error = error?.message ?? String(error);
  }
  writeJson(MSI_EXTRACT, report);
  assertPass("MSI admin extraction", report.status === "pass", JSON.stringify(report));
  return report;
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else count += 1;
    }
  }
  return count;
}

function verifyChaosAcceptance() {
  const suspendVerification = run("node", ["scripts/verify-real-os-suspend-evidence.mjs"]);
  const liveChaos = existsSync(CHAOS_LIVE) ? readJson(CHAOS_LIVE) : null;
  const sleepChaos = existsSync(SLEEP_CHAOS) ? readJson(SLEEP_CHAOS) : null;
  const realOsSuspend = existsSync(REAL_OS_SUSPEND) ? readJson(REAL_OS_SUSPEND) : null;
  const realOsSuspendPass =
    realOsSuspend?.status === "pass" &&
    realOsSuspend?.checks?.appResponsive === true &&
    realOsSuspend?.checks?.terminalResponsive === true &&
    realOsSuspend?.checks?.sqliteWritable === true &&
    realOsSuspend?.checks?.paneStatePreserved === true &&
    realOsSuspend?.validation?.windowsPowerEvents?.suspendEventFound === true &&
    realOsSuspend?.validation?.windowsPowerEvents?.resumeEventFound === true;
  const acceptance = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: "pass",
    controls: {
      realAiCliKill: {
        status: liveChaos?.status === "pass" ? "mitigated" : "accepted",
        artifact: CHAOS_LIVE,
        observedStatus: liveChaos?.status ?? "missing",
        control:
          liveChaos?.status === "pass"
            ? "Live authenticated AI CLI kill/recovery passed."
            : "Host CLI executable/auth is an external dependency; live PTY restart/recovery is automated, and release checklist must run AI CLI kill on a machine with a valid CLI.",
      },
      realOsSuspend: {
        status: sleepChaos?.status === "pass" && realOsSuspendPass ? "mitigated" : "blocked",
        artifact: REAL_OS_SUSPEND,
        injectedChaosArtifact: SLEEP_CHAOS,
        observedStatus: sleepChaos?.status ?? "missing",
        manualObservedStatus: realOsSuspend?.status ?? "missing",
        verifierExitCode: suspendVerification.status,
        verifierStdout: suspendVerification.stdout?.slice(-1200) ?? "",
        verifierStderr: suspendVerification.stderr?.slice(-1200) ?? "",
        control: realOsSuspendPass
          ? "Injected sleep/resume chaos, manual real OS suspend/resume soak, and Windows power event-log validation all passed."
          : "Manual real OS suspend/resume evidence plus Windows System event-log validation is required before production release.",
      },
    },
  };
  if (acceptance.controls.realOsSuspend.status === "blocked") acceptance.status = "failed";
  writeJson(ACCEPTANCE, acceptance);
  assertPass("chaos acceptance", acceptance.status === "pass", JSON.stringify(acceptance.controls));
  return acceptance;
}

function verifyReleaseDoctor() {
  assertPass("release doctor artifact exists", existsSync(RELEASE_DOCTOR), RELEASE_DOCTOR);
  const doctor = readJson(RELEASE_DOCTOR);
  assertPass("release doctor status", ["pass", "pass_with_warnings"].includes(doctor.overallStatus ?? doctor.status), doctor.overallStatus ?? doctor.status);
  return doctor;
}

function closeRisk(risk, { status, evidence, reason, validation }) {
  const now = new Date().toISOString();
  risk.status = status;
  risk.updatedAt = now;
  risk.closedAt = now;
  risk.closureReason = reason;
  risk.evidence = evidence;
  risk.validation = validation;
  return risk;
}

function main() {
  assertPass("risk register exists", existsSync(RISK_REGISTER), RISK_REGISTER);
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RELEASE_DIR, { recursive: true });

  const evidence = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    live: verifyLiveSmoke(),
    ime: verifyImeSmoke(),
    releaseDoctor: verifyReleaseDoctor(),
    keyCustody: writeKeyCustodyEvidence(),
    msiAdminExtract: verifyMsiAdminExtract(),
    chaosAcceptance: verifyChaosAcceptance(),
  };

  const register = readJson(RISK_REGISTER);
  const risks = Array.isArray(register.risks) ? register.risks : [];
  const backup = join(LOG_DIR, `risk-register.before-production-closure-${Date.now()}.json`);
  writeJson(backup, register);

  const closureById = new Map();
  for (const riskId of LIVE_RISKS) {
    closureById.set(riskId, {
      status: "mitigated",
      evidence: "production-live-tauri-workstation-surfaces",
      reason:
        "Live Tauri/WebView2 production smoke passed and covered this surface with native Tauri invoke, visual QA rail checks, PTY routing, workflow, profile, context, review, and command-risk evidence.",
      validation: { artifact: LIVE_SMOKE, completedAt: evidence.live.completedAt },
    });
  }
  closureById.set("risk-live-ime-env", {
    status: "mitigated",
    evidence: "production-verify-ime",
    reason: "Full native IME/CDP verification passed against the live Tauri/WebView2 session.",
    validation: { artifact: IME_SMOKE, completedAt: evidence.ime.completedAt },
  });
  closureById.set("risk-p2-07-real-ai-cli-kill-gap", {
    status: evidence.chaosAcceptance.controls.realAiCliKill.status,
    evidence: "production-chaos-ai-cli-acceptance",
    reason: evidence.chaosAcceptance.controls.realAiCliKill.control,
    validation: {
      artifact: ACCEPTANCE,
      liveChaosArtifact: CHAOS_LIVE,
      observedStatus: evidence.chaosAcceptance.controls.realAiCliKill.observedStatus,
    },
  });
  closureById.set("risk-p2-07-injected-sleep-resume-not-real-os-suspend", {
    status: evidence.chaosAcceptance.controls.realOsSuspend.status,
    evidence: "production-chaos-sleep-resume-acceptance",
    reason: evidence.chaosAcceptance.controls.realOsSuspend.control,
    validation: {
      artifact: ACCEPTANCE,
      sleepChaosArtifact: SLEEP_CHAOS,
      realOsSuspendArtifact: REAL_OS_SUSPEND,
      manualObservedStatus: evidence.chaosAcceptance.controls.realOsSuspend.manualObservedStatus,
    },
  });
  closureById.set("risk-p2-08-release-key-custody", {
    status: "mitigated",
    evidence: "production-release-key-custody",
    reason: "Updater signing material is present, ignored by git, not tracked, and matched to a configured non-placeholder updater pubkey.",
    validation: { artifact: KEY_CUSTODY },
  });
  closureById.set("risk-p2-08-msi-admin-extract-timeout", {
    status: "mitigated",
    evidence: "production-msi-admin-extract",
    reason: "MSI administrative extraction completed within the production timeout and produced extracted files.",
    validation: { artifact: MSI_EXTRACT, extractedFileCount: evidence.msiAdminExtract.extractedFileCount },
  });

  const touched = [];
  for (const risk of risks) {
    const closure = closureById.get(risk.id);
    if (!closure) continue;
    closeRisk(risk, closure);
    touched.push(risk.id);
  }

  const stillOpen = risks.filter((risk) => !CLOSABLE_STATUSES.has(String(risk.status ?? "").toLowerCase()));
  const report = {
    version: 1,
    generatedAt: evidence.generatedAt,
    status: stillOpen.length === 0 ? "pass" : "failed",
    backup,
    closedRiskCount: touched.length,
    closedRisks: touched,
    openRiskCount: stillOpen.length,
    openRisks: stillOpen.map((risk) => ({ id: risk.id, status: risk.status, severity: risk.severity, title: risk.title })),
    evidence,
  };

  register.updatedAt = new Date().toISOString();
  register.productionClosure = report;
  writeJson(RISK_REGISTER, register);
  const reportPath = join(OUT_DIR, "production-risk-closure.json");
  writeJson(reportPath, report);

  assertPass("production risk closure", report.status === "pass", JSON.stringify(report.openRisks));
  console.log(`[risk-closure] pass: ${reportPath}`);
  console.log(`[risk-closure] closed=${report.closedRiskCount} open=${report.openRiskCount}`);
}

main();
