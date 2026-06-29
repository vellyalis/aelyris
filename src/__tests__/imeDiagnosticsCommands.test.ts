import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../features/app/useAppMenus.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("IME diagnostics command surface", () => {
  it("exposes enable/copy/disable actions in the terminal command set and menu", () => {
    const src = getSrc();

    expect(src).toContain("enableImeDiagnostics");
    expect(src).toContain("copyImeDiagnostics");
    expect(src).toContain("disableImeDiagnostics");
    expect(src).toContain('id: "enable-ime-diagnostics"');
    expect(src).toContain('id: "copy-ime-diagnostics"');
    expect(src).toContain('id: "disable-ime-diagnostics"');
    expect(src).toContain("Enable IME Diagnostics");
    expect(src).toContain("Copy IME Diagnostic Trace");
    expect(src).toContain("Disable IME Diagnostics");
    expect(src).toContain("No IME trace yet");
    expect(src).toContain("Reproduce the terminal input bug");
  });

  it("exposes mux-style broadcast as a deliberate command palette and menu action", () => {
    const src = getSrc();

    expect(src).toContain('id: "broadcast-to-all-panes"');
    expect(src).toContain("Broadcast Command to All Panes...");
    expect(src).toContain('invoke<unknown[]>("list_panes_info")');
    expect(src).toContain("Broadcast unavailable");
    expect(src).toContain("showConfirm");
    expect(src).toContain("Review first");
    expect(src).toContain("refreshedPanes");
    expect(src).toContain("Broadcast target changed");
    expect(src).toContain('"broadcast_keys"');
    expect(src).toContain("RadioTower");
    expect(src).toContain('"tmux"');
    expect(src).toContain('"synchronize"');
  });

  it("exposes a tmux choose-tree style terminal tab switcher", () => {
    const src = getSrc();

    expect(src).toContain('id: "switch-terminal-tab"');
    expect(src).toContain("Switch Terminal Tab...");
    expect(src).toContain("resolveTabChoice");
    expect(src).toContain('"choose-tree"');
    expect(src).toContain('"session"');
    expect(src).toContain('"window"');
  });

  it("exposes a tmux choose-tree style terminal pane switcher", () => {
    const src = getSrc();

    expect(src).toContain('id: "switch-terminal-pane"');
    expect(src).toContain("Switch Terminal Pane...");
    expect(src).toContain("openPaneSwitcher");
    expect(src).toContain("resolveOperationalPaneChoice");
    expect(src).toContain("formatOperationalPaneChoice");
    expect(src).toContain('"pane"');
    expect(src).toContain('"focus"');
  });
});
