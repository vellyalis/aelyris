import { test, expect } from "@playwright/test";

/**
 * Phase 1 visual regression baselines.
 *
 * Source of truth: `docs/ui/PHASE_1_BENTO_SPEC.md` §7.1.
 * Baseline established at master `b0b9362` (round 9 close, 2026-04-28).
 * Each Step's commit re-runs this suite against the baseline; threshold
 * varies by step (see spec):
 *   Step 1 (token add)        ≤ 0.1%
 *   Step 2 (mechanical)       ≤ 2%
 *   Step 3-4 (visual/semantic)≤ 10% + manual review
 *   Step 5 (Bento per panel)  per-panel threshold, set in this file
 *
 * Runs against Vite dev server (localhost:1420). The Vite-only path
 * gives us deterministic frames without Tauri's window-focused state
 * variance — for OS-Mica integration we do a separate manual pass per
 * spec §7.2.
 *
 * Threshold mechanics: Playwright's `toHaveScreenshot` compares pixel
 * diff via SSIM-like RGB delta. Default `maxDiffPixelRatio: 0.02` ≈ 2%.
 * We override per-test where the spec demands a tighter or looser
 * tolerance.
 */

const PROJECT_PATH = process.env.AETHER_E2E_PROJECT_PATH ?? process.cwd().replaceAll("\\", "/");

test.describe("Phase 1 visual regression — chrome cluster", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?aetherVisualQa=1&projectPath=${encodeURIComponent(PROJECT_PATH)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", path);
      localStorage.setItem("aether:onboarding-done", "true");
    }, PROJECT_PATH);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
  });

  test("welcome screen baseline", async ({ page }) => {
    // Reset to welcome state for this single test.
    await page.evaluate(() => localStorage.clear());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Quorum")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("welcome.png", {
      maxDiffPixelRatio: 0.02,
      fullPage: true,
    });
  });

  test("header bar baseline", async ({ page }) => {
    const header = page.locator(".app-container > :first-child");
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header).toHaveScreenshot("header.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("menu bar baseline", async ({ page }) => {
    const menuButton = page.getByRole("button", { name: "Open application menu" });
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await expect(menuButton).toHaveScreenshot("menubar.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("status bar baseline", async ({ page }) => {
    // StatusBar is the last child of the app container.
    const statusBar = page.locator(".app-container > :last-child");
    await expect(statusBar).toBeVisible({ timeout: 10_000 });
    await expect(statusBar).toHaveScreenshot("statusbar.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe("Phase 1 visual regression — left panel surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?aetherVisualQa=1&projectPath=${encodeURIComponent(PROJECT_PATH)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", path);
      localStorage.setItem("aether:onboarding-done", "true");
    }, PROJECT_PATH);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
  });

  test("file tree baseline", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Project sidebar" });
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).toHaveScreenshot("file-tree.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe("Phase 1 visual regression — right panel surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?aetherVisualQa=1&projectPath=${encodeURIComponent(PROJECT_PATH)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", path);
      localStorage.setItem("aether:onboarding-done", "true");
    }, PROJECT_PATH);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
  });

  test("agent inspector baseline", async ({ page }) => {
    const inspector = page.getByRole("region", { name: "Agent sessions" });
    await expect(inspector).toBeVisible({ timeout: 10_000 });
    await expect(inspector).toHaveScreenshot("agent-inspector.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe("Phase 1 visual regression — overlays", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?aetherVisualQa=1&projectPath=${encodeURIComponent(PROJECT_PATH)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", path);
      localStorage.setItem("aether:onboarding-done", "true");
    }, PROJECT_PATH);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
  });

  test("command palette baseline", async ({ page }) => {
    // Open palette via keyboard shortcut.
    await page.keyboard.press("Control+Shift+P");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await expect(palette).toHaveScreenshot("command-palette.png", {
      maxDiffPixelRatio: 0.02,
    });
    await page.keyboard.press("Escape");
  });

  test("settings dialog baseline", async ({ page }) => {
    await page.keyboard.press("Control+,");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toHaveScreenshot("settings.png", {
      maxDiffPixelRatio: 0.02,
    });
    await page.keyboard.press("Escape");
  });
});

/**
 * IMPORTANT (spec §7.2): The Tauri-only surfaces (Mica wallpaper
 * pass-through, native window chrome rounded corners, OS-level focus
 * ring) cannot be exercised by this Vite-only suite. Those go through
 * a manual checklist documented in the spec.
 */
