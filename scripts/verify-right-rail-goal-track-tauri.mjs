import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AELYRIS_TAURI_APP_URL ?? "http://localhost:1420/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AELYRIS_TAURI_GOAL_TRACK_OUT ?? ".codex-auto/production-smoke/right-rail-goal-track-tauri.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_TAURI_GOAL_TRACK_WAIT_MS ?? "90000", 10);
const RELEASE_QUALITY_PATH = resolve(".codex-auto/quality/release-quality-score.json");
const FINAL_GOAL_AUDIT_PATH = resolve(".codex-auto/quality/final-goal-audit.json");
const FINAL_GOAL_SAFE_PATH = resolve(".codex-auto/quality/final-goal-safe-summary.json");
const SOURCE_CONTRACT_PATHS = [
  "scripts/verify-right-rail-goal-track-tauri.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-goal-completion-matrix.mjs",
  "scripts/verify-goal-external-gate-readiness.mjs",
  "scripts/verify-goal-operator-finish.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-authenticated-ai-cli-consent-packet.mjs",
  "src/App.tsx",
  "src/shared/lib/authenticatedPromptConsent.ts",
  "src/shared/lib/releaseQuality.ts",
  "src/shared/lib/rightRailGoalTrack.ts",
  "src/styles/global.css",
];

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function expectedQualityDetail() {
  const score = readJson(RELEASE_QUALITY_PATH);
  if (!score || typeof score.score !== "number" || typeof score.grade !== "string") return null;
  return [
    `${score.score}% ${score.grade} · ${score.total ?? "?"}/${score.max ?? "?"}`,
    typeof score.localDate === "string" && typeof score.timeZone === "string"
      ? `${score.localDate} ${score.timeZone}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function fileMtimeMs(path) {
  if (!existsSync(path)) return 0;
  return statSync(path).mtimeMs;
}

function sourceArtifact(path) {
  const data = readJson(path);
  const releaseScoreOk =
    typeof data?.score === "number" &&
    typeof data?.grade === "string" &&
    typeof data?.total === "number" &&
    typeof data?.max === "number" &&
    typeof data?.releaseCandidateReady === "boolean";
  return {
    path,
    exists: existsSync(path),
    mtimeMs: fileMtimeMs(path),
    generatedAt: typeof data?.generatedAt === "string" ? data.generatedAt : null,
    ok: data?.ok === true || releaseScoreOk,
    status: typeof data?.status === "string" ? data.status : null,
    localDate: typeof data?.localDate === "string" ? data.localDate : null,
    timeZone: typeof data?.timeZone === "string" ? data.timeZone : null,
  };
}

function sourceContract() {
  const files = SOURCE_CONTRACT_PATHS.map((path) => {
    const resolved = resolve(path);
    return {
      path,
      exists: existsSync(resolved),
      mtimeMs: fileMtimeMs(resolved),
    };
  });
  return {
    cutoffMs: Math.max(0, ...files.map((file) => file.mtimeMs)),
    files,
  };
}

function expectedResidualRisk() {
  const audit = readJson(FINAL_GOAL_AUDIT_PATH);
  const residual = audit?.residualRiskRegister;
  if (!residual || typeof residual !== "object") return null;
  return {
    state: typeof residual.state === "string" ? residual.state : null,
    implementationFixableCount:
      typeof residual.implementationFixableCount === "number" ? residual.implementationFixableCount : null,
    policyBlockedCount: typeof residual.policyBlockedCount === "number" ? residual.policyBlockedCount : null,
    externalBlockedCount: typeof residual.externalBlockedCount === "number" ? residual.externalBlockedCount : 0,
  };
}

function expectedRequirementProofs() {
  const audit = readJson(FINAL_GOAL_AUDIT_PATH);
  if (!Array.isArray(audit?.requirements)) return [];
  return audit.requirements
    .map((requirement) => ({
      id: typeof requirement?.id === "string" ? requirement.id : null,
      label: typeof requirement?.label === "string" ? requirement.label : null,
      status: typeof requirement?.status === "string" ? requirement.status : null,
      evidenceCount: Array.isArray(requirement?.evidence) ? requirement.evidence.length : 0,
    }))
    .filter((requirement) => requirement.id && requirement.label);
}

function expectedSafeGate() {
  const safe = readJson(FINAL_GOAL_SAFE_PATH);
  if (!safe || typeof safe !== "object") return null;
  const coverage = typeof safe.coverage === "object" && safe.coverage !== null ? safe.coverage : null;
  const requirementProof =
    typeof coverage?.provedRequirementCount === "number" && typeof coverage?.totalRequirementCount === "number"
      ? `${coverage.provedRequirementCount}/${coverage.totalRequirementCount} requirements`
      : null;
  const artifactProof =
    typeof coverage?.proofArtifactPassCount === "number" && typeof coverage?.proofArtifactCount === "number"
      ? `${coverage.proofArtifactPassCount}/${coverage.proofArtifactCount} artifacts`
      : null;
  const coreProofs = [
    safe.invariants?.releaseHygieneClean === true ? "hygiene" : "",
    safe.invariants?.supplyChainAuditClean === true ? "supply chain" : "",
    safe.invariants?.terminalChunkedOscLivePassed === true ? "inline image" : "",
    safe.invariants?.nativeTerminalInputHostPassed === true ? "native input" : "",
    safe.invariants?.nativeHwndPasteLivePassed === true ? "native paste" : "",
  ].filter(Boolean);
  const coreProofDetail = coreProofs.length > 0 ? `core: ${coreProofs.join("/")}` : "";
  const safeProofDetail =
    [requirementProof, artifactProof, coreProofDetail].filter(Boolean).join(" · ") || "prompt not sent";
  const localFreshnessDetail =
    typeof safe.localDate === "string" && typeof safe.timeZone === "string" ? `${safe.localDate} ${safe.timeZone}` : "";
  const stepCount = Array.isArray(safe.steps) ? safe.steps.length : null;
  return {
    status: typeof safe.status === "string" ? safe.status : null,
    ok: safe.ok === true,
    stepCount,
    failedStepCount: Array.isArray(safe.failedSteps) ? safe.failedSteps.length : null,
    proofRequirementPassCount:
      typeof coverage?.provedRequirementCount === "number" ? coverage.provedRequirementCount : null,
    proofRequirementCount: typeof coverage?.totalRequirementCount === "number" ? coverage.totalRequirementCount : null,
    proofArtifactPassCount:
      typeof coverage?.proofArtifactPassCount === "number" ? coverage.proofArtifactPassCount : null,
    proofArtifactCount: typeof coverage?.proofArtifactCount === "number" ? coverage.proofArtifactCount : null,
    consentBlockerCount: typeof coverage?.consentBlockerCount === "number" ? coverage.consentBlockerCount : null,
    nonConsentBlockerCount:
      typeof coverage?.nonConsentBlockerCount === "number" ? coverage.nonConsentBlockerCount : null,
    noTokenPromptSent: safe.invariants?.noTokenPromptSent === true,
    tokenSpendingPromptExecuted: safe.tokenSpendingPromptExecuted === true,
    releaseHygieneClean: safe.invariants?.releaseHygieneClean === true,
    supplyChainAuditClean: safe.invariants?.supplyChainAuditClean === true,
    terminalChunkedOscLivePassed: safe.invariants?.terminalChunkedOscLivePassed === true,
    nativeTerminalInputHostPassed: safe.invariants?.nativeTerminalInputHostPassed === true,
    nativeHwndPasteLivePassed: safe.invariants?.nativeHwndPasteLivePassed === true,
    semanticFreshness:
      safe.invariants?.rightRailGoalTrackSemanticFreshness === true ? "current-contract" : "stale-or-incomplete",
    cycleBoundary:
      safe.invariants?.rightRailGoalTrackCycleBoundaryExplained === true ? "right-rail-safe-gate-mutual-proof" : "none",
    detail:
      (safe.status === "blocked-by-explicit-consent" || safe.status === "blocked-by-external-gates") &&
      stepCount != null
        ? [`${stepCount} checks green · ${safeProofDetail}`, localFreshnessDetail].filter(Boolean).join(" · ")
        : null,
    localDate: typeof safe.localDate === "string" ? safe.localDate : null,
    timeZone: typeof safe.timeZone === "string" ? safe.timeZone : null,
  };
}

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return path;
}

function isEnvironmentUnavailable(report) {
  return report.errors.some((error) =>
    /spawn EPERM|Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|browserType\.launch|connectOverCDP/i.test(
      String(error),
    ),
  );
}

function writeDiagnosticArtifact(report) {
  const path = resolve(`${OUT}.environment-blocked.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...report,
        status: "environment-blocked",
        preservesPrimaryArtifact: true,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

function probeCdpTcp(timeoutMs = 750) {
  return new Promise((resolveProbe, rejectProbe) => {
    const url = new URL(CDP);
    const host = url.hostname || "127.0.0.1";
    const port = Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`TCP timeout ${host}:${port}`)));
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

async function connectWithWait() {
  const startedAt = Date.now();
  let lastError = null;
  do {
    try {
      await probeCdpTcp();
      const browser = await chromium.connectOverCDP(CDP);
      return { browser, waitedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } while (Date.now() - startedAt < WAIT_MS);
  throw new Error(`Cannot attach to WebView2 CDP at ${CDP}. Last error: ${lastError?.message ?? "unknown"}`);
}

function targetUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "tauri-goal-track-proof");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  return url.toString();
}

function isAelyrisPage(page) {
  const url = page.url();
  return (
    url.startsWith(APP_ORIGIN) ||
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

async function waitForAelyrisPage(browser) {
  const deadline = Date.now() + WAIT_MS;
  let pages = [];
  while (Date.now() < deadline) {
    pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find(isAelyrisPage);
    if (page) return { page, pages };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`CDP attached, but no Aelyris page was exposed. Pages: ${pages.map((page) => page.url()).join(", ")}`);
}

function isAuthenticatedPromptBlocker(value) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|authenticated AI CLI prompt|token-spend consent/i.test(
    String(value ?? ""),
  );
}

function countAuthenticatedPromptBlockers(items) {
  return items.filter((item) => isAuthenticatedPromptBlocker(item)).length;
}

async function readGoalTrack(page) {
  await page.waitForSelector(".right-panel-goal-track", { timeout: WAIT_MS });
  return await page.evaluate(() => {
    const root = document.querySelector(".right-panel-goal-track");
    const quality = root?.querySelector(".right-panel-goal-track-source");
    const residual = root?.querySelector(".right-panel-goal-track-residual");
    const safeGate = root?.querySelector(".right-panel-goal-track-safe");
    const consent = root?.querySelector(".right-panel-goal-track-consent");
    const consentRun = consent?.querySelector(".right-panel-goal-track-consent-copy");
    const consentRuns = Array.from(consent?.querySelectorAll(".right-panel-goal-track-consent-copy") ?? []);
    const freshness = consent?.querySelector(".right-panel-goal-track-freshness-radar");
    const refreshActions = Array.from(
      consent?.querySelectorAll(".right-panel-goal-track-artifact-refresh button") ?? [],
    );
    const externalActions = Array.from(root?.querySelectorAll(".right-panel-goal-track-external-actions button") ?? []);
    return {
      visible: Boolean(root),
      status: root?.getAttribute("data-status") ?? null,
      percent: root?.querySelector(".right-panel-goal-track-head strong")?.textContent?.trim() ?? null,
      qualitySource: {
        status: quality?.getAttribute("data-status") ?? null,
        localDate: quality?.getAttribute("data-local-date") ?? null,
        timeZone: quality?.getAttribute("data-time-zone") ?? null,
        label: quality?.querySelector("strong")?.textContent?.trim() ?? null,
        detail: quality?.querySelector("small")?.textContent?.trim() ?? null,
      },
      residualRisk: {
        state: residual?.getAttribute("data-state") ?? null,
        source: residual?.getAttribute("data-source") ?? null,
        label: residual?.querySelector("strong")?.textContent?.trim() ?? null,
        detail: residual?.querySelector("small")?.textContent?.trim() ?? null,
        implementationFixableCount: Number(residual?.getAttribute("data-implementation-fixable-count") ?? "NaN"),
        policyBlockedCount: Number(residual?.getAttribute("data-policy-blocked-count") ?? "NaN"),
        externalBlockedCount: Number(residual?.getAttribute("data-external-blocked-count") ?? "NaN"),
      },
      safeGate: {
        status: safeGate?.getAttribute("data-status") ?? null,
        source: safeGate?.getAttribute("data-source") ?? null,
        label: safeGate?.querySelector("strong")?.textContent?.trim() ?? null,
        detail: safeGate?.querySelector("small")?.textContent?.trim() ?? null,
        proofRequirementPassCount: Number(safeGate?.getAttribute("data-proof-requirement-pass-count") ?? "NaN"),
        proofRequirementCount: Number(safeGate?.getAttribute("data-proof-requirement-count") ?? "NaN"),
        proofArtifactPassCount: Number(safeGate?.getAttribute("data-proof-artifact-pass-count") ?? "NaN"),
        proofArtifactCount: Number(safeGate?.getAttribute("data-proof-artifact-count") ?? "NaN"),
        consentBlockerCount: Number(safeGate?.getAttribute("data-consent-blocker-count") ?? "NaN"),
        nonConsentBlockerCount: Number(safeGate?.getAttribute("data-non-consent-blocker-count") ?? "NaN"),
        noTokenPromptSent: safeGate?.getAttribute("data-no-token-prompt-sent") ?? null,
        tokenSpendingPromptExecuted: safeGate?.getAttribute("data-token-spending-prompt-executed") ?? null,
        releaseHygieneClean: safeGate?.getAttribute("data-release-hygiene-clean") ?? null,
        supplyChainAuditClean: safeGate?.getAttribute("data-supply-chain-audit-clean") ?? null,
        terminalChunkedOscLivePassed: safeGate?.getAttribute("data-terminal-chunked-osc-live-passed") ?? null,
        nativeTerminalInputHostPassed: safeGate?.getAttribute("data-native-terminal-input-host-passed") ?? null,
        nativeHwndPasteLivePassed: safeGate?.getAttribute("data-native-hwnd-paste-live-passed") ?? null,
        semanticFreshness: safeGate?.getAttribute("data-semantic-freshness") ?? null,
        cycleBoundary: safeGate?.getAttribute("data-cycle-boundary") ?? null,
        localDate: safeGate?.getAttribute("data-local-date") ?? null,
        timeZone: safeGate?.getAttribute("data-time-zone") ?? null,
      },
      requirementProofs: Array.from(root?.querySelectorAll(".right-panel-goal-track-requirements li") ?? []).map(
        (item) => ({
          id: item.getAttribute("data-requirement-id") ?? null,
          status: item.getAttribute("data-proof-status") ?? null,
          evidenceCount: Number(item.getAttribute("data-evidence-count") ?? "NaN"),
          label: item.querySelector("strong")?.textContent?.trim() ?? "",
          detail: item.querySelector("small")?.textContent?.trim() ?? "",
        }),
      ),
      boundaryProofs: Array.from(root?.querySelectorAll(".right-panel-goal-track-boundaries li") ?? []).map(
        (item) => ({
          id: item.getAttribute("data-boundary-id") ?? null,
          status: item.getAttribute("data-boundary-status") ?? null,
          source: item.getAttribute("data-boundary-source") ?? null,
          artifactPath: item.getAttribute("data-boundary-artifact") ?? null,
          refreshCommand: item.getAttribute("data-boundary-refresh-command") ?? null,
          costClass: item.getAttribute("data-boundary-cost-class") ?? null,
          label: item.querySelector("strong")?.textContent?.trim() ?? "",
          detail: item.querySelector("small")?.textContent?.trim() ?? "",
        }),
      ),
      consentPacket: {
        status: consent?.getAttribute("data-status") ?? null,
        label: consent?.querySelector("strong")?.textContent?.trim() ?? null,
        detail: consent?.querySelector("small")?.textContent?.trim() ?? null,
        command:
          consent?.querySelector(".right-panel-goal-track-consent-command div:nth-child(1) dd")?.textContent?.trim() ??
          null,
        requiredEnv:
          consent?.querySelector(".right-panel-goal-track-consent-command div:nth-child(2) dd")?.textContent?.trim() ??
          null,
        tokenGate:
          consent?.querySelector(".right-panel-goal-track-consent-command div:nth-child(3) dd")?.textContent?.trim() ??
          null,
        providerEnvRequirement:
          consent?.getAttribute("data-provider-env") ??
          consent?.querySelector(".right-panel-goal-track-consent-command div:nth-child(4) dd")?.textContent?.trim() ??
          null,
        providers: Array.from(consent?.querySelectorAll(".right-panel-goal-track-provider-matrix li") ?? []).map(
          (item) => ({
            label: item.textContent?.trim() ?? "",
            status: item.getAttribute("data-status") ?? null,
          }),
        ),
        artifactFreshness: {
          status: freshness?.getAttribute("data-status") ?? null,
          freshCount: Number(freshness?.getAttribute("data-fresh-count") ?? "NaN"),
          staleCount: Number(freshness?.getAttribute("data-stale-count") ?? "NaN"),
          totalCount: Number(freshness?.getAttribute("data-total-count") ?? "NaN"),
          nextRefreshId: freshness?.getAttribute("data-next-refresh-id") ?? null,
          nextRefreshCommand: freshness?.getAttribute("data-next-refresh-command") ?? null,
          nextRefreshExpiresAt: freshness?.getAttribute("data-next-refresh-expires-at") ?? null,
          label: freshness?.querySelector("strong")?.textContent?.trim() ?? null,
          detail: freshness?.querySelector("small")?.textContent?.trim() ?? null,
        },
        refreshActions: refreshActions.map((item) => ({
          id: item.getAttribute("data-goal-refresh-id") ?? null,
          label: item.querySelector("span")?.textContent?.trim() ?? null,
          command: item.getAttribute("data-goal-refresh-command") ?? null,
          path: item.getAttribute("data-goal-refresh-path") ?? null,
          costClass: item.getAttribute("data-goal-refresh-cost-class") ?? null,
          fresh: item.getAttribute("data-goal-refresh-fresh") ?? null,
          requiresExplicitConsent: item.getAttribute("data-goal-refresh-requires-explicit-consent") ?? null,
          title: item.getAttribute("title") ?? null,
        })),
        runAction: {
          label: consentRun?.querySelector("span")?.textContent?.trim() ?? null,
          detail: consentRun?.querySelector("small")?.textContent?.trim() ?? null,
          provider: consentRun?.getAttribute("data-consent-run-provider") ?? null,
          command: consentRun?.getAttribute("data-consent-run-command") ?? null,
          providerEnv: consentRun?.getAttribute("data-consent-run-provider-env") ?? null,
          defaultProvider: consentRun?.getAttribute("data-consent-run-default-provider") ?? null,
          requiresExplicitConsent: consentRun?.getAttribute("data-consent-run-requires-explicit-consent") ?? null,
          snippet: consentRun?.getAttribute("title") ?? null,
        },
        runActions: consentRuns.map((item) => ({
          label: item.querySelector("span")?.textContent?.trim() ?? null,
          detail: item.querySelector("small")?.textContent?.trim() ?? null,
          provider: item.getAttribute("data-consent-run-provider") ?? null,
          command: item.getAttribute("data-consent-run-command") ?? null,
          providerEnv: item.getAttribute("data-consent-run-provider-env") ?? null,
          defaultProvider: item.getAttribute("data-consent-run-default-provider") ?? null,
          requiresExplicitConsent: item.getAttribute("data-consent-run-requires-explicit-consent") ?? null,
          snippet: item.getAttribute("title") ?? null,
        })),
      },
      externalGateActions: externalActions.map((item) => ({
        id: item.getAttribute("data-external-gate-id") ?? null,
        label: item.querySelector("span")?.textContent?.trim() ?? null,
        detail: item.querySelector("small")?.textContent?.trim() ?? null,
        command: item.getAttribute("data-external-gate-command") ?? null,
        followUp: item.getAttribute("data-external-gate-follow-up") ?? null,
        requiresUserAction: item.getAttribute("data-external-gate-requires-user-action") ?? null,
        requiresExplicitConsent: item.getAttribute("data-external-gate-requires-explicit-consent") ?? null,
        costClass: item.getAttribute("data-external-gate-cost-class") ?? null,
        snippet: item.getAttribute("title") ?? null,
      })),
      riskEvidence: Array.from(
        root?.querySelectorAll('.right-panel-goal-track-risks[data-source="release"] li') ?? [],
      ).map((item) => ({
        label: item.querySelector("strong")?.textContent?.trim() ?? "",
        detail: item.querySelector("small")?.textContent?.trim() ?? "",
      })),
      qaRiskEvidence: Array.from(
        root?.querySelectorAll('.right-panel-goal-track-risks[data-source="qa-fixture"] li') ?? [],
      ).map((item) => ({
        label: item.querySelector("strong")?.textContent?.trim() ?? "",
        detail: item.querySelector("small")?.textContent?.trim() ?? "",
      })),
      remaining: Array.from(root?.querySelectorAll(".right-panel-goal-track-remaining li") ?? []).map(
        (item) => item.textContent?.trim() ?? "",
      ),
    };
  });
}

async function waitForGoalTrackProof(page) {
  const deadline = Date.now() + WAIT_MS;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readGoalTrack(page);
    if (
      latest.qualitySource.status === "fresh" &&
      latest.consentPacket.status === "ready" &&
      latest.safeGate.status != null &&
      latest.residualRisk.state != null &&
      latest.requirementProofs.length >= 8 &&
      latest.boundaryProofs.length >= 5
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return latest ?? (await readGoalTrack(page));
}

async function main() {
  const report = {
    version: 1,
    ok: false,
    status: "running",
    startedAt: new Date().toISOString(),
    cdp: CDP,
    appUrl: APP_URL,
    projectPath: PROJECT_PATH,
    expectedQualityDetail: expectedQualityDetail(),
    expectedResidualRisk: expectedResidualRisk(),
    expectedRequirementProofs: expectedRequirementProofs(),
    expectedSafeGate: expectedSafeGate(),
    sourceArtifacts: {
      releaseQualityScore: sourceArtifact(RELEASE_QUALITY_PATH),
      finalGoalAudit: sourceArtifact(FINAL_GOAL_AUDIT_PATH),
      finalGoalSafe: sourceArtifact(FINAL_GOAL_SAFE_PATH),
    },
    sourceContract: sourceContract(),
    checks: {},
    errors: [],
  };
  let browser;
  try {
    const connected = await connectWithWait();
    browser = connected.browser;
    report.cdpWaitedMs = connected.waitedMs;
    const { page, pages } = await waitForAelyrisPage(browser);
    report.pages = pages.map((candidate) => candidate.url());
    await page.bringToFront().catch(() => {});
    await page.goto(targetUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".app-container", { timeout: WAIT_MS });
    await page.waitForFunction(
      () =>
        typeof window.__TAURI_INTERNALS__?.invoke === "function" &&
        typeof window.__TAURI_INTERNALS__?.transformCallback === "function",
      null,
      { timeout: WAIT_MS },
    );
    report.checks.goalTrack = await waitForGoalTrackProof(page);
    const goalTrack = report.checks.goalTrack;
    const failures = [];
    if (goalTrack.qualitySource.status !== "fresh") failures.push("quality proof is not fresh in Tauri runtime");
    if (!report.expectedQualityDetail) {
      failures.push("latest release-quality-score artifact is missing before Tauri goal-track verification");
    }
    if (report.expectedQualityDetail && goalTrack.qualitySource.detail !== report.expectedQualityDetail) {
      failures.push(
        `quality proof detail is stale in Tauri runtime: expected "${report.expectedQualityDetail}", saw "${goalTrack.qualitySource.detail}"`,
      );
    }
    if (
      report.sourceArtifacts.releaseQualityScore.localDate &&
      goalTrack.qualitySource.localDate !== report.sourceArtifacts.releaseQualityScore.localDate
    ) {
      failures.push("quality proof local date is not visible in Tauri runtime");
    }
    if (
      report.sourceArtifacts.releaseQualityScore.timeZone &&
      goalTrack.qualitySource.timeZone !== report.sourceArtifacts.releaseQualityScore.timeZone
    ) {
      failures.push("quality proof time zone is not visible in Tauri runtime");
    }
    if (goalTrack.consentPacket.status !== "ready") failures.push("consent packet is not ready in Tauri runtime");
    if (goalTrack.consentPacket.command !== "pnpm verify:terminal:authenticated-ai-cli-prompt") {
      failures.push("consent packet command is not visible in Tauri runtime");
    }
    if (!String(goalTrack.consentPacket.requiredEnv ?? "").includes("AELYRIS_AUTH_PROMPT_CONSENT=")) {
      failures.push("consent packet required environment is not visible in Tauri runtime");
    }
    if (
      !String(goalTrack.consentPacket.providerEnvRequirement ?? "").includes(
        "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      )
    ) {
      failures.push("consent packet provider environment is not visible in Tauri runtime");
    }
    if (goalTrack.consentPacket.tokenGate !== "explicit consent") {
      failures.push("consent packet token gate is not visible in Tauri runtime");
    }
    if (goalTrack.consentPacket.runAction.label !== "Copy verified run command") {
      failures.push("consent packet verified run action is not visible in Tauri runtime");
    }
    if (goalTrack.consentPacket.runAction.provider !== "codex") {
      failures.push("consent packet default verified run action does not expose the default provider");
    }
    if (goalTrack.consentPacket.runAction.command !== "pnpm verify:terminal:authenticated-ai-cli-prompt") {
      failures.push("consent packet verified run action does not expose the exact prompt smoke command");
    }
    if (
      !String(goalTrack.consentPacket.runAction.providerEnv ?? "").includes(
        "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      )
    ) {
      failures.push("consent packet verified run action does not expose provider selection");
    }
    if (goalTrack.consentPacket.runAction.requiresExplicitConsent !== "true") {
      failures.push("consent packet verified run action does not mark explicit consent requirement");
    }
    if (
      !String(goalTrack.consentPacket.runAction.snippet ?? "").includes(
        '$env:AELYRIS_AUTH_PROMPT_CONSENT="I_UNDERSTAND_THIS_MAY_SPEND_TOKENS"',
      )
    ) {
      failures.push("consent packet verified run action does not expose a PowerShell consent snippet");
    }
    const runActionProviders = (goalTrack.consentPacket.runActions ?? []).map((action) => action.provider);
    for (const provider of ["codex", "claude", "gemini"]) {
      const action = (goalTrack.consentPacket.runActions ?? []).find((item) => item.provider === provider);
      if (!runActionProviders.includes(provider) || !action) {
        failures.push(`consent packet verified run action matrix does not expose ${provider}`);
        continue;
      }
      if (action.command !== "pnpm verify:terminal:authenticated-ai-cli-prompt") {
        failures.push(`consent packet ${provider} action does not expose the exact prompt smoke command`);
      }
      if (action.requiresExplicitConsent !== "true") {
        failures.push(`consent packet ${provider} action does not mark explicit consent requirement`);
      }
      if (!String(action.snippet ?? "").includes(`$env:AELYRIS_AUTH_PROMPT_PROVIDER="${provider}"`)) {
        failures.push(`consent packet ${provider} action does not expose a provider-specific PowerShell snippet`);
      }
    }
    if (goalTrack.consentPacket.artifactFreshness.status !== "green") {
      failures.push("consent packet proof freshness radar is not green in Tauri runtime");
    }
    if (!(goalTrack.consentPacket.artifactFreshness.totalCount > 0)) {
      failures.push("consent packet proof freshness radar does not expose source artifact count");
    }
    if (goalTrack.consentPacket.artifactFreshness.staleCount !== 0) {
      failures.push("consent packet proof freshness radar reports stale no-token artifacts");
    }
    if (!goalTrack.consentPacket.artifactFreshness.nextRefreshId) {
      failures.push("consent packet proof freshness radar does not expose next refresh proof id");
    }
    if (!String(goalTrack.consentPacket.artifactFreshness.nextRefreshCommand ?? "").length) {
      failures.push("consent packet proof freshness radar does not expose next refresh command");
    }
    const nextRefreshAction = (goalTrack.consentPacket.refreshActions ?? []).find(
      (action) => action.id === goalTrack.consentPacket.artifactFreshness.nextRefreshId,
    );
    if (!nextRefreshAction) {
      failures.push("consent packet proof refresh action is not clickable in Tauri runtime");
    } else {
      if (nextRefreshAction.command !== goalTrack.consentPacket.artifactFreshness.nextRefreshCommand) {
        failures.push("consent packet proof refresh action command is stale in Tauri runtime");
      }
      if (!nextRefreshAction.path || !String(nextRefreshAction.title ?? "").includes(nextRefreshAction.command ?? "")) {
        failures.push("consent packet proof refresh action does not expose path/title evidence");
      }
      if (nextRefreshAction.requiresExplicitConsent !== "false") {
        failures.push("non-token proof refresh action is incorrectly marked as token consent-gated");
      }
    }
    if (!report.expectedResidualRisk?.state) {
      failures.push("latest final-goal-audit residual risk artifact is missing before Tauri goal-track verification");
    }
    if (report.expectedRequirementProofs.length < 8) {
      failures.push(
        "latest final-goal-audit requirement proof artifact is missing before Tauri goal-track verification",
      );
    }
    if (report.expectedRequirementProofs.length >= 8 && goalTrack.requirementProofs.length < 8) {
      failures.push("final goal requirement proofs are not visible in Tauri runtime");
    }
    if (goalTrack.boundaryProofs.length < 6) {
      failures.push("terminal boundary proofs are not visible in Tauri runtime");
    }
    for (const id of [
      "native-input-host",
      "native-hwnd-paste",
      "chunked-osc-inline-image",
      "release-hygiene",
      "supply-chain-audit",
      "safe-proof-chain",
    ]) {
      const proof = goalTrack.boundaryProofs.find((item) => item.id === id);
      if (!proof) {
        failures.push(`terminal boundary proof ${id} is missing`);
      } else if (proof.status !== "proved") {
        failures.push(`terminal boundary proof ${id} is not proved`);
      } else if (!String(proof.artifactPath ?? "").startsWith(".codex-auto/")) {
        failures.push(`terminal boundary proof ${id} does not expose an artifact path`);
      } else if (!String(proof.refreshCommand ?? "").startsWith("pnpm verify:")) {
        failures.push(`terminal boundary proof ${id} does not expose a refresh command`);
      } else if (proof.costClass !== "no-token") {
        failures.push(`terminal boundary proof ${id} is not marked no-token`);
      }
    }
    for (const expected of report.expectedRequirementProofs) {
      const actual = goalTrack.requirementProofs.find((item) => item.id === expected.id);
      if (!actual) {
        failures.push(`final goal requirement proof is missing in Tauri runtime: ${expected.id}`);
        continue;
      }
      if (actual.status !== expected.status) {
        failures.push(`final goal requirement proof status is stale in Tauri runtime: ${expected.id}`);
      }
      if (actual.label !== expected.label) {
        failures.push(`final goal requirement proof label is stale in Tauri runtime: ${expected.id}`);
      }
      if (expected.evidenceCount > 0 && actual.evidenceCount !== expected.evidenceCount) {
        failures.push(`final goal requirement proof evidence count is stale in Tauri runtime: ${expected.id}`);
      }
    }
    if (report.expectedResidualRisk?.state && goalTrack.residualRisk.state !== report.expectedResidualRisk.state) {
      failures.push("final audit residual risk state is stale in Tauri runtime");
    }
    if (!report.expectedSafeGate?.status) {
      failures.push("latest final-goal-safe summary artifact is missing before Tauri goal-track verification");
    }
    if (report.expectedSafeGate?.status && goalTrack.safeGate.status !== report.expectedSafeGate.status) {
      failures.push(
        `final safe gate state is stale in Tauri runtime: expected "${report.expectedSafeGate.status}", saw "${goalTrack.safeGate.status}"`,
      );
    }
    if (report.expectedSafeGate?.detail && goalTrack.safeGate.detail !== report.expectedSafeGate.detail) {
      failures.push(
        `final safe gate detail is stale in Tauri runtime: expected "${report.expectedSafeGate.detail}", saw "${goalTrack.safeGate.detail}"`,
      );
    }
    if (report.expectedSafeGate?.localDate && goalTrack.safeGate.localDate !== report.expectedSafeGate.localDate) {
      failures.push("final safe gate local date is not visible in Tauri runtime");
    }
    if (report.expectedSafeGate?.timeZone && goalTrack.safeGate.timeZone !== report.expectedSafeGate.timeZone) {
      failures.push("final safe gate time zone is not visible in Tauri runtime");
    }
    if (goalTrack.safeGate.source !== "final-goal-safe-summary") {
      failures.push("final safe gate source is not visible in Tauri runtime");
    }
    for (const [field, label] of [
      ["proofRequirementPassCount", "requirement proof pass count"],
      ["proofRequirementCount", "requirement proof total count"],
      ["proofArtifactPassCount", "artifact proof pass count"],
      ["proofArtifactCount", "artifact proof total count"],
      ["consentBlockerCount", "consent blocker count"],
      ["nonConsentBlockerCount", "non-consent blocker count"],
    ]) {
      if (
        typeof report.expectedSafeGate?.[field] === "number" &&
        goalTrack.safeGate[field] !== report.expectedSafeGate[field]
      ) {
        failures.push(`final safe gate ${label} is stale in Tauri runtime`);
      }
    }
    if (report.expectedSafeGate?.noTokenPromptSent === true && goalTrack.safeGate.noTokenPromptSent !== "true") {
      failures.push("final safe gate does not expose no-token-prompt-sent proof in Tauri runtime");
    }
    if (goalTrack.safeGate.tokenSpendingPromptExecuted !== "false") {
      failures.push("final safe gate does not prove the token-spending prompt was not executed");
    }
    for (const [field, message] of [
      ["releaseHygieneClean", "final safe gate does not expose release hygiene core proof in Tauri runtime"],
      ["supplyChainAuditClean", "final safe gate does not expose supply-chain audit core proof in Tauri runtime"],
      [
        "terminalChunkedOscLivePassed",
        "final safe gate does not expose inline image terminal core proof in Tauri runtime",
      ],
      [
        "nativeTerminalInputHostPassed",
        "final safe gate does not expose native input host core proof in Tauri runtime",
      ],
      ["nativeHwndPasteLivePassed", "final safe gate does not expose native HWND paste core proof in Tauri runtime"],
    ]) {
      if (report.expectedSafeGate?.[field] === true && goalTrack.safeGate[field] !== "true") {
        failures.push(message);
      }
    }
    if (
      report.expectedSafeGate?.nativeHwndPasteLivePassed === true &&
      !String(goalTrack.safeGate.detail ?? "").includes(
        "core: hygiene/supply chain/inline image/native input/native paste",
      )
    ) {
      failures.push("final safe gate detail does not list the native core proof bundle in Tauri runtime");
    }
    if (
      report.expectedSafeGate?.semanticFreshness &&
      goalTrack.safeGate.semanticFreshness !== report.expectedSafeGate.semanticFreshness
    ) {
      failures.push("final safe gate semantic freshness is stale in Tauri runtime");
    }
    if (
      report.expectedSafeGate?.cycleBoundary &&
      goalTrack.safeGate.cycleBoundary !== report.expectedSafeGate.cycleBoundary
    ) {
      failures.push("final safe gate cycle boundary is not visible in Tauri runtime");
    }
    if (report.expectedResidualRisk?.state === "blocked-by-external-gates") {
      const nativeSleepAction = (goalTrack.externalGateActions ?? []).find(
        (action) => action.id === "native-user-sleep-cycle",
      );
      if (!nativeSleepAction) {
        failures.push("external native sleep proof action is not visible in Goal Track");
      } else {
        if (nativeSleepAction.command !== "pnpm verify:production:suspend:native-user-cycle") {
          failures.push("external native sleep proof action command is stale in Tauri runtime");
        }
        if (nativeSleepAction.requiresUserAction !== "true") {
          failures.push("external native sleep proof action does not mark the manual sleep/wake requirement");
        }
        if (nativeSleepAction.requiresExplicitConsent !== "false") {
          failures.push("external native sleep proof action is incorrectly marked as token-consent gated");
        }
        if (nativeSleepAction.costClass !== "no-token-user-host-action") {
          failures.push("external native sleep proof action does not expose the no-token user-host cost class");
        }
        if (!String(nativeSleepAction.snippet ?? "").includes("pnpm verify:quality-score")) {
          failures.push("external native sleep proof action does not include quality-score follow-up");
        }
        if (!String(nativeSleepAction.snippet ?? "").includes("manually sleep and wake Windows")) {
          failures.push("external native sleep proof action does not explain the manual sleep/wake step");
        }
      }
    }
    if (
      report.expectedResidualRisk?.state === "blocked-only-by-explicit-token-consent" &&
      goalTrack.percent !== "99%"
    ) {
      failures.push("consent-gated final goal progress did not show 99% in Tauri runtime");
    }
    if (
      typeof report.expectedResidualRisk?.implementationFixableCount === "number" &&
      goalTrack.residualRisk.implementationFixableCount !== report.expectedResidualRisk.implementationFixableCount
    ) {
      failures.push("final audit residual risk implementation-fixable count is stale in Tauri runtime");
    }
    if (
      typeof report.expectedResidualRisk?.policyBlockedCount === "number" &&
      goalTrack.residualRisk.policyBlockedCount !== report.expectedResidualRisk.policyBlockedCount
    ) {
      failures.push("final audit residual risk policy-blocked count is stale in Tauri runtime");
    }
    const providers = goalTrack.consentPacket.providers ?? [];
    const readyProviders = providers
      .filter((provider) => provider.status === "ready")
      .map((provider) => provider.label);
    for (const provider of ["codex", "claude", "gemini"]) {
      if (!readyProviders.includes(provider)) {
        failures.push(`consent provider matrix does not show ${provider} as ready`);
      }
    }
    if (!goalTrack.remaining.some((item) => /authenticated.*prompt.*smoke/i.test(item))) {
      failures.push("remaining blocker does not name authenticated prompt smoke");
    }
    if (countAuthenticatedPromptBlockers(goalTrack.remaining) !== 1) {
      failures.push("duplicate authenticated prompt blockers are visible in Goal Track remaining items");
    }
    const riskRemaining = goalTrack.remaining.some((item) => /risk or blocker node/.test(item));
    if (riskRemaining && goalTrack.riskEvidence.length === 0) {
      failures.push("risk blockers are listed without visible risk evidence labels");
    }
    if (
      goalTrack.remaining.some((item) =>
        /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(item),
      )
    ) {
      failures.push("QA fixture risks leaked into release blockers");
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
    report.ok = true;
    report.status = "pass";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    const cdpShutdown = {
      browserCloseRequested: process.env.AELYRIS_TAURI_GOAL_TRACK_CLOSE_BROWSER === "1",
      cdpDetached: false,
      browserClosed: false,
      error: null,
    };
    if (browser) {
      try {
        if (cdpShutdown.browserCloseRequested) {
          await browser.close();
          cdpShutdown.browserClosed = true;
        } else if (typeof browser.disconnect === "function") {
          await browser.disconnect();
          cdpShutdown.cdpDetached = true;
        }
      } catch (error) {
        cdpShutdown.error = error instanceof Error ? error.message : String(error);
      }
    }
    report.cdpShutdown = cdpShutdown;
    const environmentBlocked = !report.ok && isEnvironmentUnavailable(report);
    const artifact = environmentBlocked ? writeDiagnosticArtifact(report) : writeArtifact(report);
    if (report.ok) {
      console.log(`right rail Tauri goal track smoke passed: ${artifact}`);
    } else if (environmentBlocked) {
      console.error(`right rail Tauri goal track smoke environment-blocked; primary artifact preserved: ${artifact}`);
    } else {
      console.error(`right rail Tauri goal track smoke failed: ${artifact}`);
    }
    process.exit(report.ok ? 0 : 1);
  }
}

await main();
