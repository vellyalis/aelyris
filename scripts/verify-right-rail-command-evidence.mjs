// Browser smoke for review-rail command evidence jump wiring.
//
// Prerequisite:
//   pnpm.cmd dev -- --host 127.0.0.1 --port 1420
//
// Optional env:
//   AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_URL=http://localhost:1420/
//   AELYRIS_TAURI_PROJECT=C:/repo/aelyris
//   AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_OUT=.codex-auto/production-smoke/right-rail-command-evidence.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const APP_URL = process.env.AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_URL ?? "http://localhost:1420/";
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT =
  process.env.AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_OUT ??
  ".codex-auto/production-smoke/right-rail-command-evidence.json";
const SCREENSHOT =
  process.env.AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_SCREENSHOT ??
  ".codex-auto/visual/right-rail-review-fixture-command-evidence.png";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_RIGHT_RAIL_COMMAND_EVIDENCE_WAIT_MS ?? "30000", 10);

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  appUrl: APP_URL,
  projectPath: PROJECT_PATH,
  checks: {},
  errors: [],
};

function writeArtifact() {
  const outPath = resolve(OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return outPath;
}

function isEnvironmentUnavailable() {
  const messages = [
    ...report.errors,
    ...(Array.isArray(report.checks?.consoleErrors) ? report.checks.consoleErrors : []),
    ...(Array.isArray(report.checks?.pageErrors) ? report.checks.pageErrors : []),
  ];
  return messages.some((error) =>
    /spawn EPERM|Cannot open .*Start the dev server first|ECONNREFUSED|browserType\.launch|504 \(Outdated Optimize Dep\)|Outdated Optimize Dep/i.test(
      String(error),
    ),
  );
}

function writeDiagnosticArtifact() {
  const outPath = resolve(`${OUT}.environment-blocked.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
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
  return outPath;
}

function targetQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "review");
  url.searchParams.set("railState", "review");
  url.searchParams.set("v", "right-rail-command-evidence");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  url.searchParams.delete("aelyrisDashboardStateUrl");
  return url.toString();
}

function attachQualityCollectors(page) {
  const events = {
    consoleErrors: [],
    pageErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    events.consoleErrors.push(message.text().slice(0, 1000));
  });
  page.on("pageerror", (error) => {
    events.pageErrors.push(error.message);
  });
  return events;
}

async function seedQaStorage(page) {
  await page.evaluate((projectPath) => {
    window.localStorage.setItem("aelyris:visualQa", "1");
    window.localStorage.setItem("aelyris:visualQaProject", projectPath);
    window.localStorage.setItem("aelyris:lastProject", projectPath);
    window.localStorage.setItem("aelyris:onboarding-done", "true");
    window.localStorage.removeItem("aelyris:dashboardStateUrl");
  }, PROJECT_PATH);
}

async function readEvidenceButtons(page) {
  return await page.evaluate(() => {
    const accessibleName = (element) => {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (!labelledBy) return "";
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    };
    const buttons = Array.from(
      document.querySelectorAll('button[aria-label="Open terminal evidence for pnpm exec tsc --noEmit"]'),
    );
    return buttons.map((button) => {
      const group = button.closest("fieldset[aria-label], [role='group']");
      const rect = button.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label") ?? "",
        text: button.textContent?.trim() ?? "",
        groupLabel: group ? accessibleName(group) : "",
        visible: rect.width > 0 && rect.height > 0,
      };
    });
  });
}

async function readGoalTrack(page) {
  return await page.evaluate(() => {
    const root = document.querySelector(".right-panel-goal-track");
    if (!root) return { visible: false, percent: null, milestones: [], remaining: [] };
    const rect = root.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      label: root.getAttribute("aria-label"),
      percent: root.querySelector(".right-panel-goal-track-head strong")?.textContent?.trim() ?? null,
      status: root.getAttribute("data-status"),
      qualitySource: {
        status: root.querySelector(".right-panel-goal-track-source")?.getAttribute("data-status") ?? null,
        label: root.querySelector(".right-panel-goal-track-source strong")?.textContent?.trim() ?? null,
        detail: root.querySelector(".right-panel-goal-track-source small")?.textContent?.trim() ?? null,
      },
      residualRisk: {
        state: root.querySelector(".right-panel-goal-track-residual")?.getAttribute("data-state") ?? null,
        label: root.querySelector(".right-panel-goal-track-residual strong")?.textContent?.trim() ?? null,
        detail: root.querySelector(".right-panel-goal-track-residual small")?.textContent?.trim() ?? null,
      },
      consentPacket: {
        status: root.querySelector(".right-panel-goal-track-consent")?.getAttribute("data-status") ?? null,
        label: root.querySelector(".right-panel-goal-track-consent strong")?.textContent?.trim() ?? null,
        detail: root.querySelector(".right-panel-goal-track-consent small")?.textContent?.trim() ?? null,
      },
      boundaryProofs: Array.from(root.querySelectorAll(".right-panel-goal-track-boundaries li")).map((item) => ({
        id: item.getAttribute("data-boundary-id") ?? null,
        status: item.getAttribute("data-boundary-status") ?? null,
        source: item.getAttribute("data-boundary-source") ?? null,
        artifactPath: item.getAttribute("data-boundary-artifact") ?? null,
        refreshCommand: item.getAttribute("data-boundary-refresh-command") ?? null,
        costClass: item.getAttribute("data-boundary-cost-class") ?? null,
        label: item.querySelector("strong")?.textContent?.trim() ?? "",
      })),
      riskEvidence: Array.from(root.querySelectorAll('.right-panel-goal-track-risks[data-source="release"] li')).map(
        (item) => ({
          label: item.querySelector("strong")?.textContent?.trim() ?? "",
          detail: item.querySelector("small")?.textContent?.trim() ?? "",
        }),
      ),
      qaRiskEvidence: Array.from(
        root.querySelectorAll('.right-panel-goal-track-risks[data-source="qa-fixture"] li'),
      ).map((item) => ({
        label: item.querySelector("strong")?.textContent?.trim() ?? "",
        detail: item.querySelector("small")?.textContent?.trim() ?? "",
      })),
      milestones: Array.from(root.querySelectorAll(".right-panel-goal-track-milestone")).map((item) => ({
        label: item.querySelector("strong")?.textContent?.trim() ?? "",
        status: item.getAttribute("data-status"),
      })),
      remaining: Array.from(root.querySelectorAll(".right-panel-goal-track-remaining li")).map(
        (item) => item.textContent?.trim() ?? "",
      ),
    };
  });
}

async function openEvidenceDrawer(page) {
  const drawer = page.locator("details.right-panel-evidence-drawer").first();
  await drawer.waitFor({ state: "attached", timeout: WAIT_MS });
  const alreadyOpen = await drawer.evaluate((element) => element.hasAttribute("open"));
  if (!alreadyOpen) {
    await page.locator("details.right-panel-evidence-drawer > summary").first().click();
  }
  await page.waitForSelector(".right-panel-goal-track", { state: "visible", timeout: WAIT_MS });
}

function isAuthenticatedPromptBlocker(value) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|authenticated AI CLI prompt|token-spend consent/i.test(
    String(value ?? ""),
  );
}

function countAuthenticatedPromptBlockers(items) {
  return items.filter((item) => isAuthenticatedPromptBlocker(item)).length;
}

async function main() {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const quality = attachQualityCollectors(page);

    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch((error) => {
      throw new Error(`Cannot open ${APP_URL}. Start the dev server first. ${error.message}`);
    });
    await seedQaStorage(page);
    await page.goto(targetQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector('[data-widget="review-queue"]', { timeout: WAIT_MS });
    await openEvidenceDrawer(page);
    report.checks.evidenceDrawerOpened = true;
    report.checks.goalTrack = await readGoalTrack(page);

    const provenance = page.getByRole("group", { name: "Provenance for src/App.tsx" });
    const evidenceButton = provenance.getByRole("button", {
      name: "Open terminal evidence for pnpm exec tsc --noEmit",
    });
    await evidenceButton.waitFor({ state: "visible", timeout: WAIT_MS });

    await page.evaluate(() => {
      const target = window;
      target.__aelyrisCommandEvidenceEvents = [];
      target.addEventListener(
        "aelyris:terminal-command-evidence",
        (event) => {
          target.__aelyrisCommandEvidenceEvents.push(event.detail);
        },
        { once: true },
      );
    });

    report.checks.evidenceButtons = await readEvidenceButtons(page);
    await evidenceButton.click();

    await page.waitForFunction(
      () => window.__aelyrisCommandEvidenceEvents?.[0]?.terminalId === "qa-review-shell",
      null,
      { timeout: WAIT_MS },
    );
    report.checks.emittedEvidence = await page.evaluate(() => window.__aelyrisCommandEvidenceEvents?.[0] ?? null);

    const screenshotPath = resolve(SCREENSHOT);
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    report.checks.screenshot = screenshotPath;
    report.checks.consoleErrors = quality.consoleErrors;
    report.checks.pageErrors = quality.pageErrors;

    if (quality.consoleErrors.length > 0 || quality.pageErrors.length > 0) {
      throw new Error(
        `Console or page errors appeared during command evidence smoke: ${[
          ...quality.consoleErrors,
          ...quality.pageErrors,
        ]
          .slice(0, 4)
          .join(" | ")}`,
      );
    }
    if (!report.checks.emittedEvidence || report.checks.emittedEvidence.terminalId !== "qa-review-shell") {
      throw new Error("Command evidence event did not target qa-review-shell");
    }
    if (!report.checks.evidenceButtons.some((button) => button.groupLabel === "Provenance for src/App.tsx")) {
      throw new Error("Command evidence button was not exposed in the src/App.tsx provenance group");
    }
    if (!report.checks.goalTrack?.visible || !String(report.checks.goalTrack.percent ?? "").endsWith("%")) {
      throw new Error("Final goal track was not visible with a percentage in the right rail");
    }
    if (!["fresh", "stale", "unavailable"].includes(report.checks.goalTrack.qualitySource?.status ?? "")) {
      throw new Error("Final goal track did not expose quality proof freshness");
    }
    if (
      !["ready", "missing", "incomplete", "pass", "failed"].includes(
        report.checks.goalTrack.consentPacket?.status ?? "",
      )
    ) {
      throw new Error("Final goal track did not expose authenticated prompt consent packet status");
    }
    if ((report.checks.goalTrack.boundaryProofs ?? []).length < 5) {
      throw new Error("Final goal track did not expose terminal boundary proofs");
    }
    if (
      ![
        "native-input-host",
        "native-hwnd-paste",
        "chunked-osc-inline-image",
        "release-hygiene",
        "safe-proof-chain",
      ].every((id) => report.checks.goalTrack.boundaryProofs.some((item) => item.id === id))
    ) {
      throw new Error("Final goal track terminal boundary proof set is incomplete");
    }
    if (
      !report.checks.goalTrack.boundaryProofs.every(
        (item) =>
          String(item.artifactPath ?? "").startsWith(".codex-auto/") &&
          String(item.refreshCommand ?? "").startsWith("pnpm verify:") &&
          item.costClass === "no-token",
      )
    ) {
      throw new Error(
        "Final goal track terminal boundary proofs did not expose artifact paths and no-token refresh commands",
      );
    }
    const riskRemaining = report.checks.goalTrack.remaining.some((item) => /risk or blocker node/.test(item));
    if (riskRemaining && report.checks.goalTrack.riskEvidence.length === 0) {
      throw new Error("Final goal track listed risk blockers without visible risk evidence labels");
    }
    if (
      report.checks.goalTrack.remaining.some((item) =>
        /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(item),
      )
    ) {
      throw new Error("Final goal track leaked QA fixture risks into release blockers");
    }
    if (
      !report.checks.goalTrack.milestones.some((item) => item.label === "Release proof") ||
      !report.checks.goalTrack.remaining.some((item) => /authenticated.*prompt.*smoke/i.test(item))
    ) {
      throw new Error("Final goal track did not expose the release-proof milestone and remaining prompt-smoke blocker");
    }
    if (countAuthenticatedPromptBlockers(report.checks.goalTrack.remaining) !== 1) {
      throw new Error("Final goal track exposed duplicate authenticated prompt blockers");
    }

    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    const artifact = !report.ok && isEnvironmentUnavailable() ? writeDiagnosticArtifact() : writeArtifact();
    if (report.ok) {
      console.log(`right rail command evidence smoke passed: ${artifact}`);
    } else if (isEnvironmentUnavailable()) {
      console.error(`right rail command evidence smoke environment-blocked; primary artifact preserved: ${artifact}`);
    } else {
      console.error(`right rail command evidence smoke failed: ${artifact}`);
    }
  }
}

await main();
