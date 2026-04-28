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

  it("routes top and bottom chrome through one acrylic frame material", () => {
    const chromeFileSuffixes = [
      "features/header/ProjectHeaderBar.module.css",
      "features/workspace-tabs/WorkspaceTabs.module.css",
      "features/statusbar/StatusBar.module.css",
    ];

    for (const suffix of chromeFileSuffixes) {
      const entry = Object.entries(cssSources).find(([file]) => file.includes(suffix));
      expect(entry, suffix).toBeDefined();
      const source = entry?.[1] ?? "";
      expect(source, suffix).toContain("var(--chrome-frame-bg)");
      expect(source, suffix).toContain("var(--chrome-frame-filter)");
    }
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

  it("keeps localhost preview backplane scoped away from the Tauri host", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain('html[data-aether-host="browser"]');
    expect(source).toContain('html[data-aether-host="browser"] body');
    expect(source).not.toContain('html[data-aether-host="tauri"]');
  });

  it("keeps inactive-window glass below opaque-card territory", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const inactiveRule = source.match(/body\[data-window-focused="false"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(inactiveRule).toContain("--glass-thick: rgba(36, 36, 44, 0.27)");
    expect(inactiveRule).not.toContain("0.4");
    expect(inactiveRule).not.toContain("0.46");
    expect(inactiveRule).not.toContain("0.48");
  });

  it("keeps nested bento veils below dashboard-card opacity", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const veilRule = source.match(/\.bento-widget::before\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(veilRule).toContain("opacity: 0.24");
    expect(veilRule).not.toContain("opacity: 0.78");
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
});
