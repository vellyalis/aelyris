import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const railModes = ["command", "review", "observe"] as const;
const matrixWidths = [584, 960, 1440, 1920] as const;
const densityModes = ["focus", "balanced", "dense"] as const;
const projectPath = process.env.AELYRIS_E2E_PROJECT_PATH ?? process.cwd().replaceAll("\\", "/");
const externalDashboardEnabled = process.env.AELYRIS_E2E_EXTERNAL_DASHBOARD === "1";
const workspaceProfileStorageKey = "aelyris:workspaceProfiles";
const visualQaArtifactDir = ".codex-auto/visual-qa/p2-05";

type RailMode = (typeof railModes)[number];
type DensityMode = (typeof densityModes)[number];

async function seedVisualQaStorage(page: Page, density: DensityMode = "balanced") {
  await page.evaluate(
    ({ density, projectPath, workspaceProfileStorageKey }) => {
      const workspaceKey = projectPath.toLowerCase();
      localStorage.setItem("aelyris:visualQa", "1");
      localStorage.setItem("aelyris:visualQaProject", projectPath);
      localStorage.setItem("aelyris:lastProject", projectPath);
      localStorage.setItem("aelyris:onboarding-done", "true");
      localStorage.setItem(
        workspaceProfileStorageKey,
        JSON.stringify({
          version: 1,
          workspaceOverrides: {
            [workspaceKey]: {
              visualDensity: density,
              paneLayout: { density },
            },
          },
          threadRunState: {},
        }),
      );
    },
    { density, projectPath, workspaceProfileStorageKey },
  );
}

async function openVisualQaApp(
  page: Page,
  options: {
    rail?: RailMode;
    density?: DensityMode;
    diagnostics?: boolean;
    incidents?: boolean;
    attachFixture?: boolean;
    railState?: "idle" | "review" | "blocked" | "unhealthy" | "conductor";
  } = {},
) {
  const params = new URLSearchParams({
    aelyrisVisualQa: "1",
    rail: options.rail ?? "observe",
    projectPath,
  });
  if (options.diagnostics) params.set("diagnostics", "1");
  if (options.incidents) params.set("incidents", "1");
  if (options.attachFixture) params.set("attachFixture", "1");
  if (options.railState) params.set("railState", options.railState);

  await page.goto(`/?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await seedVisualQaStorage(page, options.density ?? "balanced");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".app-container")).toHaveAttribute("data-density", options.density ?? "balanced");
}

async function readSurfaceLayout(page: Page, selector: string) {
  return page.locator(selector).evaluate((surface) => {
    const element = surface as HTMLElement;
    const box = element.getBoundingClientRect();
    const children = [...element.querySelectorAll<HTMLElement>("*")];
    const overflowingChildren = children
      .filter((child) => {
        const childBox = child.getBoundingClientRect();
        const style = window.getComputedStyle(child);
        if (childBox.width <= 2 || childBox.height <= 2) return false;
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        if (child.closest(".sr-only")) return false;
        const clipsOverflow =
          ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflow);
        if (clipsOverflow && style.textOverflow === "ellipsis") return false;
        return child.scrollWidth - child.clientWidth > 2;
      })
      .map((child) => ({
        tag: child.tagName.toLowerCase(),
        text: child.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
        className: String(child.className),
      }));

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflowingChildren,
    };
  });
}

function expectSurfaceInsideViewport(layout: Awaited<ReturnType<typeof readSurfaceLayout>>, margin = 12) {
  expect(layout.left).toBeGreaterThanOrEqual(margin);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth - margin);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.overflowingChildren).toEqual([]);
}

async function readRightRailLayout(page: Page) {
  return page.evaluate(() => {
    const rightPanel = document.querySelector<HTMLElement>(".right-panel");
    const rightPanelContent = document.querySelector<HTMLElement>(".right-panel-content");
    const rightStack = document.querySelector<HTMLElement>(".right-panel-stack");
    const centerPanel = document.querySelector<HTMLElement>(".center-panel");
    const widgets = [...document.querySelectorAll<HTMLElement>(".right-panel .bento-widget")];
    const overflowingWidgets = widgets
      .filter((widget) => widget.scrollWidth - widget.clientWidth > 2)
      .map((widget) => widget.dataset.widget ?? widget.className);

    return {
      centerWidth: centerPanel?.getBoundingClientRect().width ?? 0,
      rightWidth: rightPanel?.getBoundingClientRect().width ?? 0,
      stackClientWidth: rightStack?.clientWidth ?? 0,
      stackScrollWidth: rightStack?.scrollWidth ?? 0,
      stackLeft: rightStack?.getBoundingClientRect().left ?? 0,
      stackRight: rightStack?.getBoundingClientRect().right ?? 0,
      stackClientHeight: rightPanelContent?.clientHeight ?? rightStack?.clientHeight ?? 0,
      stackScrollHeight: rightPanelContent?.scrollHeight ?? rightStack?.scrollHeight ?? 0,
      stackScrollbarGutter: rightPanelContent
        ? window.getComputedStyle(rightPanelContent).scrollbarGutter
        : rightStack
          ? window.getComputedStyle(rightStack).scrollbarGutter
          : "",
      overflowingWidgets,
    };
  });
}

async function readAppShellLayout(page: Page) {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>(".app-container");
    const left = document.querySelector<HTMLElement>(".left-panel");
    const center = document.querySelector<HTMLElement>(".center-panel");
    const right = document.querySelector<HTMLElement>(".right-panel");
    const main = document.querySelector<HTMLElement>(".app-main");
    const terminal = document.querySelector<HTMLElement>(
      '[class*="terminalArea"], [class*="terminalContainer"], [data-preview="true"], canvas, [data-testid="terminal-canvas"]',
    );
    const boxOf = (element: HTMLElement | null) => {
      const box = element?.getBoundingClientRect();
      return box
        ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
        : null;
    };
    const visibleHorizontalBounds = (element: HTMLElement) => {
      let { left, right } = element.getBoundingClientRect();
      let parent = element.parentElement;
      while (parent && parent !== app) {
        const style = window.getComputedStyle(parent);
        const clipsInline = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
        if (clipsInline) {
          const parentBox = parent.getBoundingClientRect();
          left = Math.max(left, parentBox.left);
          right = Math.min(right, parentBox.right);
        }
        parent = parent.parentElement;
      }
      return { left, right };
    };
    const visibleHorizontalOverflow = [...document.querySelectorAll<HTMLElement>(".app-container *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (box.width <= 2 || box.height <= 2) return false;
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        if (element.closest('[role="dialog"], .sr-only')) return false;
        const visibleBounds = visibleHorizontalBounds(element);
        return visibleBounds.left < -1 || visibleBounds.right > window.innerWidth + 1;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className).slice(0, 120),
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
      }));

    return {
      density: app?.dataset.density ?? "",
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      main: boxOf(main),
      left: boxOf(left),
      center: boxOf(center),
      right: boxOf(right),
      terminal: boxOf(terminal),
      visibleHorizontalOverflow,
    };
  });
}

function expectAppShellLayout(
  layout: Awaited<ReturnType<typeof readAppShellLayout>>,
  expected: { density: DensityMode; minCenterWidth: number },
) {
  expect(layout.density).toBe(expected.density);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1);
  expect(layout.visibleHorizontalOverflow).toEqual([]);
  expect(layout.main?.width ?? 0).toBeGreaterThan(0);
  expect(layout.center?.width ?? 0).toBeGreaterThanOrEqual(expected.minCenterWidth);
  expect(layout.right?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.terminal?.width ?? 0).toBeGreaterThanOrEqual(Math.min(260, expected.minCenterWidth));
  if ((layout.left?.width ?? 0) > 1) {
    expect(layout.left?.right ?? 0).toBeLessThanOrEqual((layout.center?.left ?? 0) + 1);
  }
  expect(layout.center?.right ?? 0).toBeLessThanOrEqual((layout.right?.left ?? layout.viewportWidth) + 1);
}

async function expectCurrentAppShellStable(page: Page, density: DensityMode, width: number) {
  const layout = await readAppShellLayout(page);
  expectAppShellLayout(layout, {
    density,
    minCenterWidth: width <= 584 ? 260 : 320,
  });

  const rail = await readRightRailLayout(page);
  expect(rail.stackScrollWidth).toBeLessThanOrEqual(rail.stackClientWidth + 1);
  expect(rail.overflowingWidgets).toEqual([]);
  expect(rail.stackScrollbarGutter).toContain("stable");
}

async function ensureVisualQaArtifactDir() {
  mkdirSync(visualQaArtifactDir, { recursive: true });
}

test.describe("Visual QA layout guard", () => {
  test("keeps the terminal well visible below the native Tauri minWidth", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });

    const center = await page.locator(".center-panel").boundingBox();
    const right = await page.locator(".right-panel").boundingBox();
    const left = await page.locator(".left-panel").boundingBox();

    expect(center?.width ?? 0).toBeGreaterThanOrEqual(260);
    expect(right?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(280);
    expect(left?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);

    const collapsedSidebarChildren = await page.locator(".left-panel-collapsed > *").evaluateAll((children) =>
      children
        .filter((child) => {
          const element = child as HTMLElement;
          const box = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return box.width > 2 && box.height > 2 && style.visibility !== "hidden" && style.display !== "none";
        })
        .map((child) => (child as HTMLElement).textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ?? ""),
    );
    expect(collapsedSidebarChildren).toEqual([]);
  });

  test("keeps production-width desktop chrome balanced", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });

    const center = await page.locator(".center-panel").boundingBox();
    const right = await page.locator(".right-panel").boundingBox();
    const left = await page.locator(".left-panel").boundingBox();

    expect(center?.width ?? 0).toBeGreaterThanOrEqual(320);
    expect(right?.width ?? 0).toBeGreaterThanOrEqual(320);
    expect(left?.width ?? 0).toBeGreaterThanOrEqual(200);
  });

  for (const deviceScaleFactor of [1, 1.25, 1.5] as const) {
    test.describe(`P2-05 app shell DPR ${deviceScaleFactor}`, () => {
      test.use({ deviceScaleFactor });

      for (const density of densityModes) {
        for (const width of matrixWidths) {
          test(`covers ${width}px at DPR ${deviceScaleFactor} in ${density} density`, async ({ page }) => {
            test.setTimeout(75_000);

            await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
            await openVisualQaApp(page, { rail: "observe", density });

            const layout = await readAppShellLayout(page);
            expect(Math.round(layout.devicePixelRatio * 100)).toBe(Math.round(deviceScaleFactor * 100));
            expectAppShellLayout(layout, {
              density,
              minCenterWidth: width <= 584 ? 260 : 320,
            });

            const rail = await readRightRailLayout(page);
            expect(rail.stackScrollWidth).toBeLessThanOrEqual(rail.stackClientWidth + 1);
            expect(rail.overflowingWidgets).toEqual([]);
          });
        }
      }
    });
  }

  const expectedRailWidgets: Record<RailMode, string> = {
    command: "toolkit",
    review: "review-queue",
    observe: "processes",
  };

  for (const width of matrixWidths) {
    for (const railMode of railModes) {
      test(`covers ${railMode} rail at ${width}px`, async ({ page }) => {
        test.setTimeout(45_000);

        await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
        await openVisualQaApp(page, { rail: railMode, density: "balanced", attachFixture: railMode === "observe" });
        await expect(page.locator(`.right-panel-stack[data-mode="${railMode}"]`)).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(`[data-widget="${expectedRailWidgets[railMode]}"]`)).toBeVisible({ timeout: 10_000 });
        await expectCurrentAppShellStable(page, "balanced", width);
      });
    }
  }

  test("keeps right rail scrollbar gutter stable with overflowing and non-overflowing surfaces", async ({ page }) => {
    test.setTimeout(60_000);

    await page.setViewportSize({ width: 584, height: 460 });
    await openVisualQaApp(page, { rail: "observe", density: "dense", diagnostics: true, incidents: true });
    await expect(page.locator(".right-panel-stack")).toBeVisible({ timeout: 10_000 });
    await page.locator(".right-panel-stack").evaluate((stack) => {
      const sentinel = document.createElement("div");
      sentinel.dataset.visualQaScrollbarSentinel = "present";
      sentinel.style.cssText = "flex: 0 0 720px; height: 720px; min-height: 720px; pointer-events: none;";
      stack.appendChild(sentinel);
    });
    const overflowing = await readRightRailLayout(page);
    expect(overflowing.stackScrollHeight).toBeGreaterThan(overflowing.stackClientHeight);
    expect(overflowing.stackScrollbarGutter).toContain("stable");
    expect(overflowing.stackScrollWidth).toBeLessThanOrEqual(overflowing.stackClientWidth + 1);
    expect(overflowing.overflowingWidgets).toEqual([]);

    await page.setViewportSize({ width: 1920, height: 1200 });
    await openVisualQaApp(page, { rail: "review", density: "focus" });
    await expect(page.locator('[data-widget="review-queue"]')).toBeVisible({ timeout: 10_000 });
    const roomy = await readRightRailLayout(page);
    expect(roomy.stackScrollbarGutter).toContain("stable");
    expect(roomy.stackScrollWidth).toBeLessThanOrEqual(roomy.stackClientWidth + 1);
    expect(roomy.overflowingWidgets).toEqual([]);
  });

  test("keeps the health rail compact without Mission Control home", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });
    await expect(page.getByLabel("Mission Control home")).toHaveCount(0);
    const healthRail = page.locator('.right-panel-stack[data-mode="observe"]');
    await expect(healthRail).toBeVisible({ timeout: 10_000 });

    const layout = await healthRail.evaluate((surface) => {
      const element = surface as HTMLElement;
      const box = element.getBoundingClientRect();
      const visibleOverflow = [...element.querySelectorAll<HTMLElement>("*")]
        .filter((child) => {
          const childBox = child.getBoundingClientRect();
          const style = window.getComputedStyle(child);
          if (childBox.width <= 2 || childBox.height <= 2) return false;
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          return childBox.left < box.left - 1 || childBox.right > box.right + 1;
        })
        .map((child) => child.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? child.tagName);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: box.height,
        bottom: box.bottom,
        viewportHeight: window.innerHeight,
        visibleOverflow,
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.visibleOverflow).toEqual([]);
    expect(layout.height).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.viewportHeight - layout.bottom).toBeGreaterThanOrEqual(0);
  });

  for (const railMode of railModes) {
    test(`keeps ${railMode} rail surfaces inside their panel`, async ({ page }) => {
      await page.setViewportSize({ width: 584, height: 800 });
      await openVisualQaApp(page, { rail: railMode, density: "balanced", attachFixture: railMode === "observe" });
      await expect(page.locator(".right-panel-stack")).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(async () => (await readRightRailLayout(page)).overflowingWidgets, { timeout: 5_000 })
        .toEqual([]);

      const layout = await readRightRailLayout(page);
      expect(layout.centerWidth).toBeGreaterThanOrEqual(260);
      expect(layout.rightWidth).toBeLessThanOrEqual(280);
      expect(layout.stackScrollWidth).toBeLessThanOrEqual(layout.stackClientWidth + 1);
      expect(layout.overflowingWidgets).toEqual([]);
    });
  }

  test("keeps right rail content width stable while switching modes", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "command", density: "balanced" });
    await expect(page.locator(".right-panel-stack")).toBeVisible({ timeout: 10_000 });

    const widths: number[] = [];
    for (const mode of railModes) {
      await page.locator(`#right-rail-tab-${mode}`).click();
      await expect(page.locator(`.right-panel-stack[data-mode="${mode}"]`)).toBeVisible();
      const layout = await readRightRailLayout(page);
      widths.push(layout.stackClientWidth);
      expect(layout.stackScrollWidth).toBeLessThanOrEqual(layout.stackClientWidth + 1);
    }

    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  test("exposes command evidence actions in the review rail fixture", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "review", density: "balanced", railState: "review" });
    await expect(page.locator('[data-widget="review-queue"]')).toBeVisible({ timeout: 10_000 });

    const provenance = page.getByRole("group", { name: "Provenance for src/App.tsx" });
    const evidenceButton = provenance.getByRole("button", {
      name: "Open terminal evidence for pnpm exec tsc --noEmit",
    });
    await expect(evidenceButton).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      (window as Window & { __aelyrisCommandEvidenceEvents?: unknown[] }).__aelyrisCommandEvidenceEvents = [];
      window.addEventListener(
        "aelyris:terminal-command-evidence",
        (event) => {
          (window as Window & { __aelyrisCommandEvidenceEvents?: unknown[] }).__aelyrisCommandEvidenceEvents?.push(
            (event as CustomEvent).detail,
          );
        },
        { once: true },
      );
    });
    await evidenceButton.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __aelyrisCommandEvidenceEvents?: Array<{ terminalId?: string }> })
              .__aelyrisCommandEvidenceEvents?.[0]?.terminalId,
        ),
      )
      .toBe("qa-review-shell");
  });

  test("supports keyboard traversal across right rail tabs and command dialogs", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "command", density: "balanced" });

    const commandTab = page.locator("#right-rail-tab-command");
    const reviewTab = page.locator("#right-rail-tab-review");
    const observeTab = page.locator("#right-rail-tab-observe");
    const railPanel = page.locator("#right-rail-panel");

    await commandTab.focus();
    await expect(commandTab).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(reviewTab).toBeFocused();
    await expect(reviewTab).toHaveAttribute("aria-selected", "true");
    await expect(railPanel).toHaveAttribute("aria-labelledby", "right-rail-tab-review");

    await page.keyboard.press("End");
    await expect(observeTab).toBeFocused();
    await expect(observeTab).toHaveAttribute("aria-selected", "true");
    await expect(railPanel).toHaveAttribute("aria-labelledby", "right-rail-tab-observe");

    await page.keyboard.press("Home");
    await expect(commandTab).toBeFocused();
    await expect(commandTab).toHaveAttribute("aria-selected", "true");
    await expect(railPanel).toHaveAttribute("aria-labelledby", "right-rail-tab-command");

    await page.keyboard.press("Control+Shift+P");
    const commandPalette = page.getByRole("dialog", { name: "Command Palette" });
    await expect(commandPalette).toBeVisible({ timeout: 10_000 });
    const commandDescriptionId = await commandPalette.getAttribute("aria-describedby");
    expect(commandDescriptionId).toBeTruthy();
    await expect
      .poll(() => page.evaluate((id) => document.getElementById(id ?? "")?.textContent ?? "", commandDescriptionId))
      .toContain("Search commands by name");
    await expect(page.getByRole("combobox", { name: /Command palette/i })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.keyboard.press("Control+Shift+`");
    const paneSwitcher = page.getByRole("dialog", { name: "Switch Terminal Pane" });
    await expect(paneSwitcher).toBeVisible({ timeout: 10_000 });
    const paneDescriptionId = await paneSwitcher.getAttribute("aria-describedby");
    expect(paneDescriptionId).toBeTruthy();
    await expect
      .poll(() => page.evaluate((id) => document.getElementById(id ?? "")?.textContent ?? "", paneDescriptionId))
      .toContain("Filter panes by tab");
    await expect(page.getByRole("combobox", { name: /Switch terminal pane/i })).toBeFocused();
  });

  test("keeps diagnostic logs out of the default observe rail", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });
    await expect(page.locator('[data-widget="reliability"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-widget="logs"]')).toHaveCount(0);

    await openVisualQaApp(page, { rail: "observe", density: "balanced", diagnostics: true });
    await expect(page.locator('[data-widget="logs"]')).toBeVisible({ timeout: 10_000 });
  });

  test("keeps reliability incidents compact in the observe rail", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced", incidents: true });
    await expect(page.getByLabel("Recent reliability incidents")).toBeVisible({ timeout: 10_000 });

    const layout = await readRightRailLayout(page);
    expect(layout.stackScrollWidth).toBeLessThanOrEqual(layout.stackClientWidth + 1);
    expect(layout.overflowingWidgets).toEqual([]);

    const incidentRows = await page.locator('[aria-label="Recent reliability incidents"] > li').evaluateAll((rows) =>
      rows.map((row) => {
        const element = row as HTMLElement;
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      }),
    );
    expect(incidentRows.length).toBeGreaterThan(0);
    for (const row of incidentRows) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
  });

  test("keeps ambiguous process attach selectors compact in the narrow observe rail", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced", attachFixture: true });
    await expect(page.locator('[data-widget="processes"]')).toBeVisible({ timeout: 10_000 });

    const destinationSelect = page.getByLabel("Attach destination for Orphaned Agent PTY").first();
    await expect(destinationSelect).toBeVisible({ timeout: 10_000 });

    const layout = await readRightRailLayout(page);
    expect(layout.rightWidth).toBeLessThanOrEqual(280);
    expect(layout.stackScrollWidth).toBeLessThanOrEqual(layout.stackClientWidth + 1);
    expect(layout.overflowingWidgets).toEqual([]);

    const selectorLayout = await destinationSelect.evaluate((select) => {
      const element = select as HTMLElement;
      const widget = element.closest<HTMLElement>('[data-widget="processes"]');
      const label = element.closest<HTMLElement>("label");
      const elementBox = element.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect();
      const widgetBox = widget?.getBoundingClientRect();
      return {
        selectClientWidth: element.clientWidth,
        selectScrollWidth: element.scrollWidth,
        labelClientWidth: label?.clientWidth ?? 0,
        labelScrollWidth: label?.scrollWidth ?? 0,
        selectLeft: elementBox.left,
        selectRight: elementBox.right,
        labelLeft: labelBox?.left ?? 0,
        labelRight: labelBox?.right ?? 0,
        widgetLeft: widgetBox?.left ?? 0,
        widgetRight: widgetBox?.right ?? 0,
      };
    });

    expect(selectorLayout.selectScrollWidth).toBeLessThanOrEqual(selectorLayout.selectClientWidth + 1);
    expect(selectorLayout.labelScrollWidth).toBeLessThanOrEqual(selectorLayout.labelClientWidth + 1);
    expect(selectorLayout.selectLeft).toBeGreaterThanOrEqual(selectorLayout.widgetLeft);
    expect(selectorLayout.selectRight).toBeLessThanOrEqual(selectorLayout.widgetRight);
    expect(selectorLayout.labelLeft).toBeGreaterThanOrEqual(selectorLayout.widgetLeft);
    expect(selectorLayout.labelRight).toBeLessThanOrEqual(selectorLayout.widgetRight);
  });

  test("keeps the pane switcher modal compact and non-overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });
    await expect(page.locator(".app-main")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Control+Shift+`");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Switch Terminal Pane" })).toBeVisible({
      timeout: 10_000,
    });

    const modalLayout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const rows = [...document.querySelectorAll<HTMLElement>("[cmdk-item]")];
      const dialogBox = dialog?.getBoundingClientRect();
      return {
        dialogClientWidth: dialog?.clientWidth ?? 0,
        dialogScrollWidth: dialog?.scrollWidth ?? 0,
        dialogLeft: dialogBox?.left ?? 0,
        dialogRight: dialogBox?.right ?? 0,
        viewportWidth: window.innerWidth,
        overflowingRows: rows
          .filter((row) => row.scrollWidth - row.clientWidth > 1)
          .map((row) => row.textContent?.trim() ?? ""),
      };
    });

    expect(modalLayout.dialogLeft).toBeGreaterThanOrEqual(12);
    expect(modalLayout.dialogRight).toBeLessThanOrEqual(modalLayout.viewportWidth - 12);
    expect(modalLayout.dialogScrollWidth).toBeLessThanOrEqual(modalLayout.dialogClientWidth + 1);
    expect(modalLayout.overflowingRows).toEqual([]);
  });

  test("keeps the command palette compact and centered", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });
    await page.keyboard.press("Control+Shift+P");
    await expect(page.getByRole("dialog").getByLabel("Command palette")).toBeVisible({ timeout: 10_000 });

    const layout = await readSurfaceLayout(page, '[role="dialog"]');
    expectSurfaceInsideViewport(layout);
  });

  for (const width of matrixWidths) {
    test(`covers command palette, settings, pane switcher, prompt, and confirm dialogs at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(60_000);

      await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
      await openVisualQaApp(page, { rail: "observe", density: width === 584 ? "dense" : "balanced" });

      await page.keyboard.press("Control+Shift+P");
      await expect(page.getByRole("dialog").getByLabel("Command palette")).toBeVisible({ timeout: 10_000 });
      expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]'));
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.keyboard.press("Control+,");
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Settings" })).toBeVisible({
        timeout: 10_000,
      });
      expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]'));
      await page.getByRole("button", { name: "Close settings" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.keyboard.press("Control+Shift+`");
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Switch Terminal Pane" })).toBeVisible({
        timeout: 10_000,
      });
      expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]'));

      await page
        .getByRole("button", { name: /^Send command to / })
        .first()
        .click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: /^Send to / })).toBeVisible({
        timeout: 10_000,
      });
      expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]:not([aria-hidden="true"])'));

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Switch Terminal Pane" })).toBeVisible({
        timeout: 10_000,
      });

      await page
        .getByRole("button", { name: /^Close / })
        .first()
        .click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Close terminal pane" })).toBeVisible({
        timeout: 10_000,
      });
      expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]:not([aria-hidden="true"])'));
      await page.keyboard.press("Escape");
    });
  }

  test("keeps settings compact in narrow and desktop viewports", async ({ page }) => {
    for (const viewport of [
      { width: 584, height: 800 },
      { width: 960, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await openVisualQaApp(page, { rail: "observe", density: viewport.width === 584 ? "dense" : "balanced" });
      await page.keyboard.press("Control+,");
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Settings" })).toBeVisible({
        timeout: 10_000,
      });

      const layout = await readSurfaceLayout(page, '[role="dialog"]');
      expectSurfaceInsideViewport(layout);
      await page.getByRole("button", { name: "Close settings" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("keeps prompt and confirm dialogs compact from pane actions", async ({ page }) => {
    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "balanced" });
    await page.keyboard.press("Control+Shift+`");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Switch Terminal Pane" })).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByRole("button", { name: /^Send command to / })
      .first()
      .click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /^Send to / })).toBeVisible({ timeout: 10_000 });
    expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]:not([aria-hidden="true"])'));

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Switch Terminal Pane" })).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByRole("button", { name: /^Close / })
      .first()
      .click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Close terminal pane" })).toBeVisible({
      timeout: 10_000,
    });
    expectSurfaceInsideViewport(await readSurfaceLayout(page, '[role="dialog"]:not([aria-hidden="true"])'));
  });

  for (const width of matrixWidths) {
    test(`covers canonical dashboard kanban and gantt at ${width}px`, async ({ page }) => {
      test.skip(!externalDashboardEnabled, "External roadmap dashboard is an operator-owned visual gate.");
      test.setTimeout(45_000);

      await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
      await page.goto("http://127.0.0.1:48371/");
      await expect(page.getByRole("heading", { name: "Wizard Roadmap Kanban" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("heading", { name: "Gantt Timeline" })).toBeVisible({ timeout: 10_000 });

      const layout = await page.evaluate(() => {
        const kanban = document.querySelector<HTMLElement>(".kanban");
        const gantt = document.querySelector<HTMLElement>(".gantt");
        const overflowingSections = [...document.querySelectorAll<HTMLElement>("section, table, pre")]
          .filter((element) => {
            if (element.closest(".kanban, .gantt")) return false;
            const box = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            if (box.width <= 2 || box.height <= 2) return false;
            if (style.display === "none" || style.visibility === "hidden") return false;
            return box.left < -1 || box.right > window.innerWidth + 1;
          })
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: String(element.className),
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          }));

        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          kanbanClientWidth: kanban?.clientWidth ?? 0,
          kanbanScrollWidth: kanban?.scrollWidth ?? 0,
          kanbanGutter: kanban ? window.getComputedStyle(kanban).scrollbarGutter : "",
          ganttClientWidth: gantt?.clientWidth ?? 0,
          ganttScrollWidth: gantt?.scrollWidth ?? 0,
          ganttGutter: gantt ? window.getComputedStyle(gantt).scrollbarGutter : "",
          overflowingSections,
        };
      });

      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1);
      expect(layout.overflowingSections).toEqual([]);
      expect(layout.kanbanScrollWidth).toBeGreaterThanOrEqual(layout.kanbanClientWidth);
      expect(layout.ganttScrollWidth).toBeGreaterThanOrEqual(layout.ganttClientWidth);
    });
  }

  test("captures representative P2-05 visual QA screenshots", async ({ page }) => {
    test.setTimeout(90_000);

    await ensureVisualQaArtifactDir();

    await page.setViewportSize({ width: 584, height: 800 });
    await openVisualQaApp(page, { rail: "observe", density: "dense", attachFixture: true });
    await page.screenshot({ path: `${visualQaArtifactDir}/app-584-dense-observe.png`, fullPage: true });

    await page.setViewportSize({ width: 960, height: 800 });
    await openVisualQaApp(page, { rail: "command", density: "focus" });
    await page.keyboard.press("Control+,");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: `${visualQaArtifactDir}/settings-960-focus.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await openVisualQaApp(page, { rail: "review", density: "balanced" });
    await page.screenshot({ path: `${visualQaArtifactDir}/review-rail-1440-balanced.png`, fullPage: true });

    if (externalDashboardEnabled) {
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.goto("http://127.0.0.1:48371/");
      await expect(page.getByRole("heading", { name: "Gantt Timeline" })).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: `${visualQaArtifactDir}/dashboard-1920.png`, fullPage: true });
    }
  });

  test("keeps the welcome screen centered without horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("aelyris:visualQa");
      localStorage.removeItem("aelyris:visualQaProject");
      localStorage.removeItem("aelyris:lastProject");
      localStorage.setItem("aelyris:onboarding-done", "true");
    });
    await page.reload();
    await page.setViewportSize({ width: 584, height: 800 });
    await expect(page.getByRole("heading", { name: "Aelyris" })).toBeVisible({ timeout: 10_000 });

    const layout = await readSurfaceLayout(page, "body");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.overflowingChildren).toEqual([]);
    const recentHeader = await page.locator("#welcome-recent-projects").boundingBox();
    const openButton = await page.getByRole("button", { name: /Open Folder/i }).boundingBox();
    expect(recentHeader?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect(openButton?.x ?? 0).toBeGreaterThanOrEqual(0);
  });
});
