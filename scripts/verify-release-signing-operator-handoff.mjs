import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "release-signing-operator-handoff.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  releaseDoctor: ".codex-auto/release-doctor/p2-08-release-doctor.json",
  releaseScore: ".codex-auto/quality/release-quality-score.json",
  distConfig: "src-tauri/tauri.dist.conf.json",
  baseConfig: "src-tauri/tauri.conf.json",
  buildWrapper: "scripts/build-dist-windows.ps1",
  packageJson: "package.json",
};

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readText(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { exists: false, data: null, parseError: null, mtimeMs: 0, size: 0 };
  const stats = statSync(full);
  try {
    return {
      exists: true,
      data: JSON.parse(readFileSync(full, "utf8")),
      parseError: null,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      parseError: error instanceof Error ? error.message : String(error),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }
}

function checkById(report, id) {
  return Array.isArray(report?.checks) ? report.checks.find((check) => check?.id === id) : null;
}

function scoreEntry(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((entry) => entry?.id === id) : null;
}

function isReleaseSigningBlocker(blocker) {
  return /release[-\s]?doctor.*signing\/updater|signing\/updater warnings|regenerate signatures\/latest\.json|updater signatures|latest\.json/i.test(
    `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`,
  );
}

function artifactFreshFor(signature, artifact) {
  const signatureTime = signature?.modifiedAt ? Date.parse(signature.modifiedAt) : NaN;
  const artifactTime = artifact?.modifiedAt ? Date.parse(artifact.modifiedAt) : NaN;
  return Boolean(signature?.exists && artifact?.exists && Number.isFinite(signatureTime) && Number.isFinite(artifactTime) && signatureTime >= artifactTime);
}

function artifactSummary(path, artifact) {
  return {
    path,
    exists: artifact.exists,
    parseError: artifact.parseError,
    ok: artifact.data?.ok ?? null,
    status: artifact.data?.status ?? artifact.data?.overallStatus ?? null,
    generatedAt: artifact.data?.generatedAt ?? null,
    mtimeMs: artifact.mtimeMs,
    size: artifact.size,
  };
}

const releaseDoctorArtifact = readJson(paths.releaseDoctor);
const releaseScoreArtifact = readJson(paths.releaseScore);
const distConfig = readJson(paths.distConfig);
const baseConfig = readJson(paths.baseConfig);
const packageJson = readText(paths.packageJson);
const buildWrapper = readText(paths.buildWrapper);

const releaseDoctor = releaseDoctorArtifact.data;
const releaseScore = releaseScoreArtifact.data;
const distArtifacts = checkById(releaseDoctor, "dist-artifacts");
const tauriBuild = checkById(releaseDoctor, "tauri-build");
const signingState = checkById(releaseDoctor, "signing-state");
const updaterLatest = checkById(releaseDoctor, "updater-latest-release");
const releaseDoctorScore = scoreEntry(releaseScore, "release-doctor");
const releaseBlockers = Array.isArray(releaseScore?.blockers) ? releaseScore.blockers : [];
const releaseSigningBlockers = releaseBlockers.filter(isReleaseSigningBlocker);
const nsis = signingState?.details?.artifacts?.nsis ?? updaterLatest?.details?.nsis ?? null;
const msi = signingState?.details?.artifacts?.msi ?? null;
const nsisSig = signingState?.details?.signatures?.nsis ?? updaterLatest?.details?.nsisSig ?? null;
const msiSig = signingState?.details?.signatures?.msi ?? null;
const latest = updaterLatest?.details?.latest ?? null;
const latestIntegrity = updaterLatest?.details?.latestIntegrity ?? {};
const signingComplete =
  releaseDoctor?.overallStatus === "pass" &&
  signingState?.status === "pass" &&
  updaterLatest?.status === "pass" &&
  Object.values(latestIntegrity).every((value) => value === true) &&
  artifactFreshFor(nsisSig, nsis) &&
  artifactFreshFor(msiSig, msi);
const hasSigningMaterialEnv = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());

const checks = {
  noSigningMaterialEnvPresent: !hasSigningMaterialEnv,
  releaseDoctorArtifactPresent:
    releaseDoctorArtifact.exists === true && releaseDoctorArtifact.parseError == null && releaseDoctor?.overallStatus != null,
  releaseScoreExternalGateShape:
    releaseScore?.releaseCandidateReady === false &&
    releaseDoctorScore?.points >= 14 &&
    releaseDoctorScore?.detail?.includes("signing/updater") === true &&
    releaseSigningBlockers.length >= 1,
  localUnsignedDistReady:
    releaseDoctor?.localUnsignedSmokeReady === true &&
    distArtifacts?.status === "pass" &&
    tauriBuild?.status === "pass" &&
    nsis?.exists === true &&
    msi?.exists === true,
  signingWarningClassified:
    signingComplete ||
    (signingState?.status === "warn" &&
      (signingState?.details?.freshness?.nsis === false || signingState?.details?.freshness?.msi === false)),
  updaterWarningClassified:
    signingComplete ||
    // A stale-but-PRESENT latest.json after a no-sign build is a classified
    // operator handoff. A MISSING manifest is not: with no file at all, every
    // latestIntegrity field computes to false, so without the exists check
    // "zero evidence" and "some evidence" become indistinguishable.
    (updaterLatest?.status === "warn" &&
      updaterLatest?.details?.invalidEndpoints?.length === 0 &&
      latest?.exists === true &&
      Object.values(latestIntegrity).some((value) => value === false)),
  updaterEndpointConfigured:
    signingComplete ||
    (Array.isArray(updaterLatest?.details?.endpoints) &&
      updaterLatest.details.endpoints.some((endpoint) => /^https:\/\//i.test(String(endpoint)))),
  distConfigCreatesUpdaterArtifacts: distConfig.data?.bundle?.createUpdaterArtifacts === true,
  updaterPubkeyConfigured:
    !String(baseConfig.data?.plugins?.updater?.pubkey ?? "").includes("REPLACE_") &&
    String(baseConfig.data?.plugins?.updater?.pubkey ?? "").length > 0,
  packageScriptsCloseLoop:
    packageJson.includes('"tauri:build:dist"') &&
    packageJson.includes('"verify:release:doctor"') &&
    packageJson.includes('"verify:quality-score"') &&
    packageJson.includes('"verify:goal:finalize"') &&
    packageJson.includes('"verify:goal:safe"') &&
    packageJson.includes('"verify:goal:closeout"'),
  buildWrapperUsesDistConfig:
    (buildWrapper.includes("src-tauri/tauri.dist.conf.json") ||
      buildWrapper.includes("src-tauri\\tauri.dist.conf.json")) &&
    (buildWrapper.includes("scripts/build-pty-sidecar.ps1") ||
      buildWrapper.includes("scripts\\build-pty-sidecar.ps1")) &&
    buildWrapper.includes("--bundles"),
};

const failedChecks = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([id]) => id);
const readyForSigningOperator = failedChecks.length === 0 && !signingComplete;
const ok = signingComplete || readyForSigningOperator;
const status = signingComplete ? "release-signing-complete" : readyForSigningOperator ? "ready-for-release-signing-operator" : "failed";

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status,
  releaseSigningComplete: signingComplete,
  signingMaterialProvidedToThisRun: hasSigningMaterialEnv,
  noSecretMaterialPersisted: true,
  checks,
  failedChecks,
  blocker: releaseSigningBlockers[0]?.blocker ?? null,
  currentArtifacts: {
    nsis,
    msi,
    nsisSig,
    msiSig,
    latest,
    latestIntegrity,
  },
  runbook: {
    signingAndUpdater: {
      command: "pnpm tauri:build:dist",
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "<operator-provided>",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "<operator-provided-if-key-is-encrypted>",
      },
      requires:
        "Run only in a secure operator shell with the current Tauri signing key. Do not persist private keys in the repo or artifacts.",
      expectedOutputs: [
        "src-tauri/target/release/bundle/nsis/Aelyris_0.2.3_x64-setup.exe.sig",
        "src-tauri/target/release/bundle/msi/Aelyris_0.2.3_x64_en-US.msi.sig",
        "src-tauri/target/release/bundle/latest.json",
      ],
    },
    verification: [
      "pnpm verify:release:doctor",
      "pnpm verify:quality-score",
      "pnpm verify:goal:finalize",
      "pnpm verify:goal:safe",
      "pnpm verify:goal:closeout",
    ],
    safety:
      "This handoff never signs artifacts, never reads signing private key values, and only reports whether current signatures/latest.json are fresh.",
  },
  nextRequiredAction: signingComplete
    ? "Rerun pnpm verify:quality-score, pnpm verify:goal:finalize, pnpm verify:goal:safe, and pnpm verify:goal:closeout to close the release evidence loop."
    : "Run pnpm tauri:build:dist in a secure shell with TAURI signing material, then rerun pnpm verify:release:doctor, pnpm verify:quality-score, pnpm verify:goal:finalize, pnpm verify:goal:safe, and pnpm verify:goal:closeout.",
  artifacts: {
    releaseDoctor: artifactSummary(paths.releaseDoctor, releaseDoctorArtifact),
    releaseScore: artifactSummary(paths.releaseScore, releaseScoreArtifact),
    distConfig: artifactSummary(paths.distConfig, distConfig),
    baseConfig: artifactSummary(paths.baseConfig, baseConfig),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
