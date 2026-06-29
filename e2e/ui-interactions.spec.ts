import { test, expect } from "@playwright/test";

/**
 * E2E tests for UI interactions.
 * Runs against Vite dev server with project path set in localStorage.
 */

function visualQaProjectPath() {
  return process.env.AELYRIS_E2E_PROJECT_PATH ?? process.cwd().replaceAll("\\", "/");
}

const setupProject = async (page: import("@playwright/test").Page) => {
  const projectPath = visualQaProjectPath();
  await page.goto(`/?aelyrisVisualQa=1&projectPath=${encodeURIComponent(projectPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate((path) => {
    localStorage.setItem("aelyris:visualQa", "1");
    localStorage.setItem("aelyris:visualQaProject", path);
    localStorage.setItem("aelyris:onboarding-done", "true");
  }, projectPath);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
};

test.describe("Panel visibility", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("project sidebar is visible", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Project sidebar" })).toBeVisible({ timeout: 10_000 });
  });

  test("sessions tab is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sessions" })).toBeVisible({ timeout: 10_000 });
  });

  test("activity tab is visible", async ({ page }) => {
    await expect(page.getByRole("tab", { name: "Health" })).toBeVisible({ timeout: 10_000 });
  });

  test("menu bar has File menu", async ({ page }) => {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(page.getByRole("menu").first().getByText("File", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("menu bar has Terminal menu", async ({ page }) => {
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(page.getByRole("menu").first().getByText("Terminal", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Theme persistence", () => {
  test("theme value persists in localStorage", async ({ page }) => {
    const projectPath = visualQaProjectPath();
    await page.goto("/");
    await page.evaluate((path) => {
      localStorage.setItem("aelyris:visualQa", "1");
      localStorage.setItem("aelyris:visualQaProject", path);
      localStorage.setItem("aelyris:theme", "catppuccin-latte");
    }, projectPath);
    await page.reload();
    await page.waitForTimeout(1000);

    const theme = await page.evaluate(() => localStorage.getItem("aelyris:theme"));
    expect(theme).toBe("catppuccin-latte");
  });

  test("model selection persists in localStorage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("aelyris:selectedModel", "claude-opus");
    });
    await page.reload();

    const model = await page.evaluate(() => localStorage.getItem("aelyris:selectedModel"));
    expect(model).toBe("claude-opus");
  });
});

test.describe("Welcome screen interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("Open Folder button is clickable", async ({ page }) => {
    const btn = page.getByText("Open Folder");
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toBeEnabled();
  });

  test("title shows Aelyris branding", async ({ page }) => {
    await expect(page.getByText("Aelyris")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Project terminal for shells, agents, edits, and review")).toBeVisible();
  });
});
