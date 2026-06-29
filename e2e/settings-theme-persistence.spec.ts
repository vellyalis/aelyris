import { expect, test } from "@playwright/test";

const projectPath = process.env.AELYRIS_E2E_PROJECT_PATH ?? process.cwd().replaceAll("\\", "/");

async function setupProject(page: import("@playwright/test").Page) {
  await page.goto(`/?aelyrisVisualQa=1&projectPath=${encodeURIComponent(projectPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate((path) => {
    localStorage.setItem("aelyris:visualQa", "1");
    localStorage.setItem("aelyris:visualQaProject", path);
    localStorage.setItem("aelyris:onboarding-done", "1");
    localStorage.setItem("aelyris:moodPreset", "aelyris-sky");
    localStorage.setItem("aelyris:theme", "aelyris-dark");
    localStorage.removeItem("aelyris:themeOverrides");
  }, projectPath);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
}

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
}

test.describe("Settings theme controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupProject(page);
  });

  test("mood preset changes from Settings and survives reload", async ({ page }) => {
    await openSettings(page);

    await page.getByRole("radio", { name: /Aelyris Sakura/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mood", "aelyris-sakura");
    await expect(page.getByRole("radio", { name: /Aelyris Sakura/i })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("aelyris:moodPreset"))).toBe("aelyris-sakura");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mood", "aelyris-sakura");
  });

  test("palette override applies and persisted overrides are sanitized", async ({ page }) => {
    await openSettings(page);
    const input = page.getByLabel(/Sapphire hex value/i);
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.fill("#abc");
    await input.press("Enter");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("aelyris:themeOverrides") ?? "{}"));
    expect(stored).toEqual({ "aelyris-dark": { sapphire: "#aabbcc" } });

    await page.evaluate(() => {
      localStorage.setItem(
        "aelyris:themeOverrides",
        JSON.stringify({
          "aelyris-dark": {
            sapphire: "#def",
            red: "url(javascript:alert(1))",
            unknown: "#ffffff",
          },
        }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
    await openSettings(page);

    await expect(page.getByLabel(/Sapphire hex value/i)).toHaveValue("#ddeeff");
    await expect(page.getByLabel(/Red hex value/i)).not.toHaveValue("url(javascript:alert(1))");
  });
});
