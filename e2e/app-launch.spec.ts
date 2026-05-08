import { test, expect } from "@playwright/test";

/**
 * E2E tests for Aether Terminal UI rendering.
 * Runs against Vite dev server (localhost:1420).
 *
 * Without Tauri backend, the app shows WelcomeScreen
 * (no project path in localStorage). These tests verify
 * the frontend renders correctly in both states.
 */

const PROJECT_PATH = "C:/Users/owner/Aether_Terminal";

async function openProjectFixture(page: import("@playwright/test").Page) {
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
}

test.describe("Welcome screen (no project)", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure WelcomeScreen shows
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("renders the welcome screen", async ({ page }) => {
    await expect(page.getByText("Aether Terminal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Project terminal for shells, agents, edits, and review")).toBeVisible();
  });

  test("shows Open Folder button", async ({ page }) => {
    await expect(page.getByText("Open Folder")).toBeVisible({ timeout: 10_000 });
  });

  test("shows recent projects section", async ({ page }) => {
    await expect(page.getByText("RECENT PROJECTS")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Main layout (with project path)", () => {
  test.beforeEach(async ({ page }) => {
    await openProjectFixture(page);
  });

  test("renders the header bar", async ({ page }) => {
    // Header should show project name
    const header = page.locator(".app-container");
    await expect(header).toBeVisible({ timeout: 10_000 });
  });

  test("renders the menu bar", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Open application menu" })).toBeVisible({ timeout: 10_000 });
  });

  test("left panel is visible", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Project sidebar" });
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test("right panel shows agent inspector", async ({ page }) => {
    const inspector = page.getByRole("region", { name: "Agent sessions" });
    await expect(inspector).toBeVisible({ timeout: 10_000 });
  });

  test("workspace tabs are visible", async ({ page }) => {
    await expect(page.getByRole("tablist", { name: "Terminal tabs" })).toBeVisible({ timeout: 10_000 });
  });
});
