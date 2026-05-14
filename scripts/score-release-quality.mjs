import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "release-quality-score.json");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileFresh(path, minBytes = 1) {
  if (!existsSync(path)) return false;
  return statSync(path).size >= minBytes;
}

function mtimeMs(path) {
  if (!existsSync(path)) return 0;
  return statSync(path).mtimeMs;
}

function isoMs(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

function add(scores, id, label, points, max, detail, blockers = []) {
  scores.push({ id, label, points, max, detail, blockers });
}

const releaseDoctor = readJson(join(ROOT, ".codex-auto", "release-doctor", "p2-08-release-doctor.json"));
const muxPerf = readJson(join(ROOT, ".codex-auto", "performance", "mux-performance-smoke.json"));
const muxLive = readJson(join(ROOT, ".codex-auto", "performance", "mux-live-restore-smoke.json"));
const scrollback = readJson(join(ROOT, ".codex-auto", "performance", "scrollback-gates.json"));
const riskRegister = readJson(join(ROOT, ".codex-auto", "risk-register.json"));
const realSuspend = readJson(join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-resume.json"));
const imeSmoke = readJson(join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json"));

const scores = [];
const nsis = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis", `Aether Terminal_${VERSION}_x64-setup.exe`);
const msi = join(ROOT, "src-tauri", "target", "release", "bundle", "msi", `Aether Terminal_${VERSION}_x64_en-US.msi`);
const appExe = join(ROOT, "src-tauri", "target", "release", "Aether.exe");
const newestDistArtifactMs = Math.max(mtimeMs(appExe), mtimeMs(nsis), mtimeMs(msi), mtimeMs(`${nsis}.sig`), mtimeMs(`${msi}.sig`));
const releaseDoctorFresh = releaseDoctor?.overallStatus === "pass" && isoMs(releaseDoctor.generatedAt) + 5_000 >= newestDistArtifactMs;

add(
  scores,
  "release-doctor",
  "Release doctor",
  releaseDoctorFresh ? 18 : releaseDoctor?.overallStatus === "pass" || releaseDoctor?.overallStatus === "pass_with_warnings" ? 14 : 0,
  18,
  releaseDoctorFresh ? "pass" : releaseDoctor?.overallStatus ? `${releaseDoctor.overallStatus} (stale)` : "missing",
  releaseDoctorFresh ? [] : ["release doctor evidence is missing, failing, or older than current dist artifacts"],
);

const artifactsReady =
  fileFresh(appExe, 10 * 1024 * 1024) &&
  fileFresh(nsis, 4 * 1024 * 1024) &&
  fileFresh(msi, 4 * 1024 * 1024) &&
  fileFresh(`${nsis}.sig`) &&
  fileFresh(`${msi}.sig`);
add(scores, "distribution", "Signed distribution artifacts", artifactsReady ? 14 : 0, 14, artifactsReady ? "ready" : "missing/stale", artifactsReady ? [] : ["signed exe/installer artifacts are incomplete"]);

const muxSummary = muxPerf?.summary ?? muxPerf;
const muxPass = muxLive?.status === "passed" && muxPerf?.status === "passed" && muxSummary?.split?.p95 <= 250 && muxSummary?.create?.p95 <= 250;
add(
  scores,
  "mux-performance",
  "Mux restore and performance",
  muxPass ? 14 : 8,
  14,
  muxPass ? `split p95 ${muxSummary?.split?.p95}ms, create p95 ${muxSummary?.create?.p95}ms` : "missing or slow",
  muxPass ? [] : ["mux performance evidence is missing or over budget"],
);

add(
  scores,
  "scrollback",
  "Persistent scrollback",
  scrollback?.status === "passed" ? 8 : 0,
  8,
  scrollback?.status ?? "missing",
  scrollback?.status === "passed" ? [] : ["scrollback capture/search smoke is not passing"],
);

const imeChecks = Array.isArray(imeSmoke?.checks) ? imeSmoke.checks : [];
const imePass =
  imeSmoke?.status === "pass" &&
  imeChecks.some((check) => /Long Japanese preedit|late marker survived/i.test(check)) &&
  imeChecks.some((check) => /overlay geometry inside canvas/i.test(check)) &&
  imeChecks.some((check) => /LF paste submitted/i.test(check));
add(
  scores,
  "native-ime",
  "Native IME live verification",
  imePass ? 6 : 0,
  6,
  imePass ? `${imeChecks.length} live IME checks passed` : "missing",
  imePass ? [] : ["native IME live CDP verification is missing or incomplete"],
);

const risks = Array.isArray(riskRegister?.risks) ? riskRegister.risks : [];
const openRisks = risks.filter((risk) => !["closed", "mitigated", "resolved", "accepted"].includes(String(risk.status ?? "").toLowerCase()));
const acceptedReleaseRisks = risks.filter((risk) => {
  const status = String(risk.status ?? "").toLowerCase();
  if (status !== "accepted") return false;
  return /release|dist|sign|installer|updater|crash|rollback|tauri|webview|ime|sleep|resume/i.test(
    `${risk.key ?? ""} ${risk.title ?? ""} ${risk.mitigation ?? ""} ${risk.closureReason ?? ""}`,
  );
});
const riskPoints = openRisks.length === 0 ? (acceptedReleaseRisks.length === 0 ? 18 : 12) : 4;
add(
  scores,
  "risk-register",
  "Risk register",
  riskPoints,
  18,
  `${openRisks.length} open, ${acceptedReleaseRisks.length} accepted release`,
  [
    ...openRisks.slice(0, 6).map((risk) => `open: ${risk.id}`),
    ...acceptedReleaseRisks.slice(0, 6).map((risk) => `accepted release: ${risk.id}`),
  ],
);

const realSuspendPass =
  realSuspend?.status === "pass" &&
  realSuspend?.checks?.appResponsive === true &&
  realSuspend?.checks?.terminalResponsive === true &&
  realSuspend?.checks?.sqliteWritable === true &&
  realSuspend?.checks?.paneStatePreserved === true &&
  realSuspend?.validation?.windowsPowerEvents?.suspendEventFound === true &&
  realSuspend?.validation?.windowsPowerEvents?.resumeEventFound === true;
add(
  scores,
  "real-os-soak",
  "Real OS sleep/resume soak",
  realSuspendPass ? 14 : 0,
  14,
  realSuspendPass ? "passed with Windows power events" : "missing",
  realSuspendPass ? [] : ["real OS sleep/resume evidence with Windows power events is missing"],
);

const rightRailAdvisor = join(ROOT, "src", "shared", "lib", "rightRailAdvisor.ts");
const rightRailTests = join(ROOT, "src", "__tests__", "rightRailAdvisor.test.ts");
const rightRailVisual = join(ROOT, ".codex-auto", "visual", "right-rail-next-action-qa.png");
const rightRailSource = existsSync(rightRailAdvisor) ? readFileSync(rightRailAdvisor, "utf8") : "";
const rightRailTestSource = existsSync(rightRailTests) ? readFileSync(rightRailTests, "utf8") : "";
const rightRailSourceHasExplanations = /\bwhy:\s*"/.test(rightRailSource) && /\bnextStep:\s*"/.test(rightRailSource);
const rightRailTestsCoverExplanations =
  rightRailTestSource.includes("why") && rightRailTestSource.includes("nextStep") && rightRailTestSource.includes("deriveRightRailActions");
const rightRailVisualFresh = fileFresh(rightRailVisual, 100 * 1024) && mtimeMs(rightRailVisual) + 5_000 >= Math.max(mtimeMs(rightRailAdvisor), mtimeMs(rightRailTests));
const rightRailPass = rightRailSourceHasExplanations && rightRailTestsCoverExplanations && rightRailVisualFresh;
add(
  scores,
  "right-rail-edge",
  "Right rail action clarity",
  rightRailPass ? 8 : 0,
  8,
  rightRailPass ? "ranked actions include why/nextStep and fresh visual QA evidence" : "missing or stale",
  rightRailPass
    ? []
    : [
        "right rail action explanations, test coverage, or fresh visual QA evidence are missing",
      ],
);

const total = scores.reduce((sum, item) => sum + item.points, 0);
const max = scores.reduce((sum, item) => sum + item.max, 0);
const percent = Math.round((total / max) * 100);
const blockers = scores.flatMap((item) => item.blockers.map((blocker) => ({ area: item.id, blocker })));
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  score: percent,
  total,
  max,
  grade: percent >= 97 ? "S" : percent >= 92 ? "A" : percent >= 85 ? "B" : percent >= 75 ? "C" : "D",
  releaseCandidateReady: percent >= 92 && blockers.length === 0,
  scores,
  blockers,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
