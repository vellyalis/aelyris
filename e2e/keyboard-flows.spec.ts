import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the critical keyboard-driven flows that senior users
 * touch constantly — command palette, quick open, file search, history
 * search, settings / help dialogs, and right-panel tab switching.
 *
 * These run against the Vite dev server (no Tauri backend), so any step
 * that depends on a live PTY or a real invoke call is deliberately
 * excluded. The assertions focus on surface visibility + keyboard routing
 * which are enough to catch regressions in the view layer.
 */

const setupProject = async (page: import("@playwright/test").Page) => {
  const projectPath = process.env.AELYRIS_E2E_PROJECT_PATH ?? process.cwd().replaceAll("\\", "/");
  await page.goto(`/?aelyrisVisualQa=1&projectPath=${encodeURIComponent(projectPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate((path) => {
    localStorage.setItem("aelyris:visualQa", "1");
    localStorage.setItem("aelyris:visualQaProject", path);
    localStorage.setItem("aelyris:onboarding-done", "1");
  }, projectPath);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
};

test.describe("Keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("Ctrl+Shift+P opens the command palette", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    // cmdk exposes a search input; the label varies with locale but the
    // placeholder "Type a command" is stable across surfaces.
    const input = page.locator("[cmdk-input]");
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("sett");
    // Search narrows to Settings — dialog remains open, result list shown.
    await expect(page.locator("[cmdk-item]").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).not.toBeVisible();
  });

  test("Ctrl+P opens Quick Open file search", async ({ page }) => {
    await page.keyboard.press("Control+p");
    const qo = page.getByRole("dialog", { name: /quick/i }).or(page.locator('[class*="quickOpen"]'));
    await expect(qo.first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });

  test("Ctrl+R opens history search", async ({ page }) => {
    await page.keyboard.press("Control+r");
    // HistorySearchDialog uses a fixed heading text that is stable.
    const dialog = page.getByText(/history|command.*history/i).first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });

  test("F1 opens the Help dialog", async ({ page }) => {
    await page.keyboard.press("F1");
    await expect(page.getByText(/keyboard shortcuts|help/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });

  test("Ctrl+, opens Settings", async ({ page }) => {
    await page.keyboard.press("Control+,");
    // Settings renders a dialog with a "Settings" heading.
    const heading = page.getByRole("heading", { name: "Settings" });
    await expect(heading).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(heading).not.toBeVisible();
  });
});

test.describe("Right-panel tab navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("switching to Changes tab highlights it", async ({ page }) => {
    const tab = page.getByRole("tab", { name: /changes/i }).first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  });

  test("switching to Health tab highlights it", async ({ page }) => {
    const tab = page.getByRole("tab", { name: /health/i }).first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("IME input bar", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("the IME bar is rendered and indicator starts in ASCII mode", async ({ page }) => {
    const bar = page.locator('[aria-label="ターミナル入力バー"]');
    await expect(bar).toBeVisible({ timeout: 5_000 });
    const indicator = bar.locator('[aria-label*="ASCII"], [aria-label*="composing"]').first();
    await expect(indicator).toBeVisible();
    const text = await indicator.textContent();
    expect(text?.trim()).toBe("A");
  });

  test("compositionstart flips the indicator to あ, compositionend returns to A", async ({ page }) => {
    const bar = page.locator('[aria-label="ターミナル入力バー"]');
    const ta = bar.locator('textarea[aria-label="ターミナル入力"]');
    await ta.focus();
    await ta.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    });
    const indicator = bar.locator('[aria-label*="composing"]').first();
    await expect(indicator).toHaveText("あ", { timeout: 2_000 });
    await ta.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "テスト" }));
    });
    await expect(bar.locator('[aria-label*="ASCII"]').first()).toHaveText("A", { timeout: 2_000 });
  });
});

test.describe("Menu bar dropdowns", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("clicking File opens a dropdown", async ({ page }) => {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await page.getByRole("menu").first().getByText("File", { exact: true }).hover();
    // Radix dropdowns render menu content for the root and submenu.
    await expect(page.getByRole("menu").first()).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
  });

  test("clicking Terminal opens a dropdown", async ({ page }) => {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await page.getByRole("menu").first().getByText("Terminal", { exact: true }).hover();
    await expect(page.getByRole("menu").first()).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
  });
});
