import { test, expect } from "@playwright/test";

/**
 * E2E tests for UI interactions.
 * Runs against Vite dev server with project path set in localStorage.
 */

const setupProject = async (page: import("@playwright/test").Page) => {
  const projectPath = "C:/Users/owner/Aether_Terminal";
  await page.goto(`/?aetherVisualQa=1&projectPath=${encodeURIComponent(projectPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate((path) => {
    localStorage.setItem("aether:visualQa", "1");
    localStorage.setItem("aether:visualQaProject", path);
    localStorage.setItem("aether:onboarding-done", "true");
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
    await expect(page.getByRole("tab", { name: "Observe" })).toBeVisible({ timeout: 10_000 });
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
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", "C:/Users/owner/Aether_Terminal");
      localStorage.setItem("aether:theme", "catppuccin-latte");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    const theme = await page.evaluate(() => localStorage.getItem("aether:theme"));
    expect(theme).toBe("catppuccin-latte");
  });

  test("model selection persists in localStorage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("aether:selectedModel", "claude-opus");
    });
    await page.reload();

    const model = await page.evaluate(() => localStorage.getItem("aether:selectedModel"));
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

  test("title shows Aether Terminal branding", async ({ page }) => {
    await expect(page.getByText("Aether Terminal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("AI Workspace for Windows")).toBeVisible();
  });
});
