import { describe, expect, it } from "vitest";
// Vitest runs this source-contract test in Node. The app tsconfig does not
// include @types/node, so keep the Node-only imports scoped and ignored here.
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join, relative } from "node:path";

declare const process: { cwd(): string };

function collectCssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir) as string[]) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...collectCssFiles(absolute));
    } else if (absolute.endsWith(".css")) {
      files.push(absolute);
    }
  }
  return files;
}

const srcDir = join(process.cwd(), "src");

const cssSources = Object.fromEntries(
  collectCssFiles(srcDir).map((file) => [
    `../${relative(srcDir, file).replace(/\\/g, "/")}`,
    readFileSync(file, "utf8"),
  ]),
) as Record<string, string>;

describe("design token usage", () => {
  it("does not use transparent surface tokens as foreground colors", () => {
    const offenders = Object.entries(cssSources)
      .map(([file, source]) => ({
        file,
        matches: source.match(/color\s*:\s*var\(--aether-bg\)/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps terminal chrome integrated without hard horizontal separator borders", () => {
    const terminalChromeFileSuffixes = [
      "features/terminal/TerminalInfoBar.module.css",
      "features/timeline/TimelineBar.module.css",
      "features/terminal/IMEInputBar.module.css",
    ];

    const sources = terminalChromeFileSuffixes.map((suffix) => {
      const entry = Object.entries(cssSources).find(([file]) => file.includes(suffix));
      expect(entry, suffix).toBeDefined();
      return { file: entry?.[0] ?? suffix, source: entry?.[1] ?? "" };
    });

    const offenders = sources
      .map(({ file, source }) => ({
        file,
        matches: source.match(/border-(?:top|bottom)\s*:\s*1px\s+solid/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps the OS title chrome stronger than workspace navigation rails", () => {
    const header = Object.entries(cssSources).find(([file]) =>
      file.includes("features/header/ProjectHeaderBar.module.css"),
    )?.[1] ?? "";
    const workspaceTabs = Object.entries(cssSources).find(([file]) =>
      file.includes("features/workspace-tabs/WorkspaceTabs.module.css"),
    )?.[1] ?? "";
    const statusbar = Object.entries(cssSources).find(([file]) =>
      file.includes("features/statusbar/StatusBar.module.css"),
    )?.[1] ?? "";
    const editorTabs = Object.entries(cssSources).find(([file]) => file.includes("App.module.css"))?.[1] ?? "";

    expect(header).toContain("var(--chrome-frame-bg)");
    expect(header).toContain("var(--chrome-frame-filter)");
    expect(workspaceTabs).not.toContain("var(--chrome-frame-shadow)");
    expect(statusbar).not.toContain("var(--chrome-frame-bg)");
    expect(statusbar).not.toContain("var(--chrome-frame-filter)");
    expect(editorTabs).not.toContain("var(--chrome-frame-shadow)");
  });

  it("keeps the terminal canvas recessed instead of drawing an outer card shadow", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/TerminalArea.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).not.toContain("0 16px 34px");
    expect(source).toContain("var(--terminal-viewport-shadow)");
  });

  it("uses the terminal shell as the single textured acrylic layer", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/pane-tree/PaneTreeRenderer.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain("var(--terminal-shell-filter)");
    expect(source).toContain("var(--terminal-shell-depth)");
    expect(source).not.toContain("var(--terminal-shell-shadow)");
  });

  it("keeps the workspace stage transparent so native Acrylic remains visible", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const appMainRule = source.match(/\.app-main\s*{[\s\S]*?}/)?.[0] ?? "";
    const rootGlowRule = source.match(/#root::before\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(appMainRule).toContain("background: transparent");
    expect(rootGlowRule).toContain("opacity: var(--mood-root-glow-opacity)");
  });

  it("keeps localhost preview and native Tauri backplanes separated", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain('html[data-aether-host="browser"]');
    expect(source).toContain('html[data-aether-host="browser"] body');
    expect(source).toContain('html[data-aether-host="tauri"] #root');
    expect(source).toContain("--native-backdrop-veil");
    expect(source).toContain("background: var(--native-backdrop-veil), var(--mood-root-glow)");
    expect(source).not.toContain('html[data-aether-host="tauri"] body');
  });

  it("keeps inactive-window glass below opaque-card territory", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const inactiveRule = source.match(/body\[data-window-focused="false"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(inactiveRule).toContain("--glass-thick: rgba(7, 16, 24, 0.195)");
    expect(inactiveRule).not.toContain("0.4");
    expect(inactiveRule).not.toContain("0.46");
    expect(inactiveRule).not.toContain("0.48");
  });

  it("keeps nested bento veils below dashboard-card opacity", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const veilRule = source.match(/\.bento-widget::before\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(veilRule).toContain("opacity: 0.028");
    expect(veilRule).not.toContain("opacity: 0.78");
  });

  it("keeps right-panel widgets as sections inside one inspector material", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const widgetRule = source.match(/\.bento-widget\s*{[\s\S]*?}/)?.[0] ?? "";
    const siblingRule = source.match(/\.bento-widget \+ \.bento-widget\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(widgetRule).toContain("background: transparent");
    expect(widgetRule).toContain("box-shadow: none");
    expect(siblingRule).toContain("box-shadow: inset 0 1px 0");
  });

  it("keeps collapsed right-panel widgets from stretching into empty slabs", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const bottomGridRule = source.match(/\.right-panel-bottom-grid\s*{[\s\S]*?}/)?.[0] ?? "";
    const logsRule = source.match(/\.bento-widget\[data-widget="logs"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(bottomGridRule).toContain("align-items: start");
    expect(logsRule).toContain("align-self: start");
  });

  it("keeps panel filtering clear instead of milky", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain("--material-panel-filter: blur(10px) saturate(1.08) contrast(1.01)");
    expect(source).not.toContain("saturate(1.18) contrast(1.04)");
  });

  it("routes floating inspector panels through the clear panel filter", () => {
    const toolkit = Object.entries(cssSources).find(([file]) =>
      file.includes("features/toolkit/ToolkitPanel.module.css"),
    )?.[1] ?? "";
    const inspector = Object.entries(cssSources).find(([file]) =>
      file.includes("features/agent-inspector/AgentInspector.module.css"),
    )?.[1] ?? "";

    expect(toolkit).toContain("backdrop-filter: var(--material-panel-filter)");
    expect(inspector).toContain("backdrop-filter: var(--material-panel-filter)");
    expect(`${toolkit}\n${inspector}`).not.toContain("saturate(1.18) contrast(1.04)");
  });

  it("does not suppress focus rings on div role buttons", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain('div:focus-visible:not([role="button"])');
    expect(source).not.toContain("div:focus-visible,\nsection:focus-visible");
  });

  it("keeps expanded logs from becoming a dark slab inside the right rail", () => {
    const logs = Object.entries(cssSources).find(([file]) =>
      file.includes("features/logs/LogsPanel.module.css"),
    )?.[1] ?? "";
    const listRule = logs.match(/\.list\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(listRule).toContain("rgba(3, 9, 16, 0.18)");
    expect(listRule).not.toContain("0.34");
    expect(listRule).not.toContain("0.42");
  });

  it("keeps log severity readable without badge-like colored slabs", () => {
    const logs = Object.entries(cssSources).find(([file]) =>
      file.includes("features/logs/LogsPanel.module.css"),
    )?.[1] ?? "";
    const rowRule = logs.match(/\.row\s*{[\s\S]*?}/)?.[0] ?? "";
    const levelRule = logs.match(/\.level\s*{[\s\S]*?}/)?.[0] ?? "";
    const severityRules = logs
      .match(/\.level(?:TRACE|DEBUG|INFO|WARN|ERROR)\s*{[\s\S]*?}/g)
      ?.join("\n") ?? "";

    expect(rowRule).toContain("grid-template-columns: 54px 42px minmax(0, 1fr)");
    expect(rowRule).toContain("border-left: 1px solid transparent");
    expect(levelRule).not.toContain("border-radius");
    expect(severityRules).not.toContain("background:");
  });

  it("keeps sidebar sections flat inside the parent glass panel", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("shared/ui/CollapsibleSection.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const rootRule = source.match(/\.root\s*{[\s\S]*?}/)?.[0] ?? "";
    const hoverRule = source.match(/\.root:hover\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(rootRule).toContain("background: transparent");
    expect(rootRule).toContain("box-shadow: none");
    expect(hoverRule).toContain("transform: none");
  });

  it("keeps browser previews from calling Tauri event listeners", () => {
    const sources = import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const guardedFiles = [
      "../main.tsx",
      "../shared/hooks/useAgentManager.ts",
      "../shared/hooks/useInteractiveAgent.ts",
      "../shared/hooks/useGitStatus.ts",
      "../features/terminal/NativeTerminalArea.tsx",
    ];

    for (const file of guardedFiles) {
      expect(sources[file], file).toContain("isTauriRuntime");
    }
  });

  it("keeps header branch metadata quiet instead of decorative telemetry", () => {
    const sources = import.meta.glob("../features/header/ProjectHeaderBar.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(sources)[0] ?? "";

    expect(src).not.toContain("⚡");
    expect(src).toContain("<span className={styles.branch}>{branch}</span>");
  });

  it("defines dark foreground aliases used on accent fills", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain("--ctp-base: var(--aether-ink)");
  });

  it("does not use negative tracking in UI chrome", () => {
    const offenders = Object.entries(cssSources)
      .map(([file, source]) => ({
        file,
        matches: source.match(/letter-spacing\s*:\s*-[^;]+|--tracking-[\w-]+\s*:\s*-[^;]+/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps workspace tab chrome quiet and branch metadata compact", () => {
    const source = Object.entries(cssSources).find(([file]) =>
      file.includes("features/workspace-tabs/WorkspaceTabs.module.css"),
    )?.[1] ?? "";
    const branchRule = source.match(/\.branchBadge\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(branchRule).toContain("display: inline-flex");
    expect(branchRule).toContain("border-radius: var(--radius-pill)");
    expect(source).not.toContain(".tabWrap[data-active] .tabClose");
  });

  it("keeps inspector prompt focus visible on glass surfaces", () => {
    const inspector = Object.entries(cssSources).find(([file]) =>
      file.includes("features/agent-inspector/AgentInspector.module.css"),
    )?.[1] ?? "";
    const modelFocus = inspector.match(/\.modelSelect:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const promptFocus = inspector.match(/\.promptField:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(modelFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(promptFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(`${modelFocus}\n${promptFocus}`).not.toContain("outline: none !important");
  });
});
