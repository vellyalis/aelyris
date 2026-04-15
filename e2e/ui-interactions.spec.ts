import { test, expect } from "@playwright/test";

/**
 * E2E tests for UI interactions.
 * Runs against Vite dev server with project path set in localStorage.
 */

const setupProject = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("aether:lastProject", "C:/Users/owner/Aether_Terminal");
  });
  await page.reload();
  await page.waitForTimeout(2000);
};

test.describe("Panel visibility", () => {
  test.beforeEach(async ({ page }) => { await setupProject(page); });

  test("toolkit panel is visible", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Toolkit" })).toBeVisible({ timeout: 10_000 });
  });

  test("sessions tab is visible", async ({ page }) => {
    await expect(page.getByText("Sessions")).toBeVisible({ timeout: 10_000 });
  });

  test("activity tab is visible", async ({ page }) => {
    await expect(page.getByText("Activity")).toBeVisible({ timeout: 10_000 });
  });

  test("menu bar has File menu", async ({ page }) => {
    await expect(page.getByRole("menubar").getByText("File")).toBeVisible({ timeout: 10_000 });
  });

  test("menu bar has Terminal menu", async ({ page }) => {
    await expect(page.getByRole("menubar").getByText("Terminal")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Theme persistence", () => {
  test("theme value persists in localStorage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("aether:lastProject", "C:/Users/owner/Aether_Terminal");
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
