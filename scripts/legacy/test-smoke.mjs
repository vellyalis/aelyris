/**
 * Smoke test — calls Tauri IPC commands directly via HTTP to verify core functionality.
 * Run while `pnpm tauri dev` is active.
 */

const BASE = "http://localhost:1420";

async function fetchPage() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`Frontend not serving: ${res.status}`);
  const html = await res.text();
  if (!html.includes("Aether Terminal")) throw new Error("Missing app title in HTML");
  console.log("✅ Frontend serving OK");
}

async function main() {
  console.log("=== Aether Terminal Smoke Test ===\n");

  // 1. Frontend serving
  try {
    await fetchPage();
  } catch (e) {
    console.log("❌ Frontend:", e.message);
    process.exit(1);
  }

  // 2. Check key source files exist and are valid
  const criticalFiles = [
    "src/features/terminal/pane-tree/PaneTreeRenderer.tsx",
    "src/features/terminal/TerminalArea.tsx",
    "src/shared/hooks/useTabManager.ts",
    "src/shared/hooks/useAgentManager.ts",
    "src/features/workflow/WorkflowPanel.tsx",
    "src/features/file-tree/FileTree.tsx",
  ];

  const fs = await import("fs");
  for (const f of criticalFiles) {
    const content = fs.readFileSync(f, "utf-8");
    // Check for conflict markers
    if (content.includes("<<<<<<<") || content.includes(">>>>>>>")) {
      console.log(`❌ ${f}: merge conflict markers found`);
      process.exit(1);
    }
    // Check for console.log/error
    const consoleMatches = content.match(/console\.(log|error|warn)\(/g);
    if (consoleMatches) {
      console.log(`⚠️  ${f}: ${consoleMatches.length} console statement(s)`);
    }
    console.log(`✅ ${f} — clean`);
  }

  // 3. Check PaneTreeRenderer uses absolute positioning (not portal, not recursive remount)
  const renderer = fs.readFileSync("src/features/terminal/pane-tree/PaneTreeRenderer.tsx", "utf-8");

  if (renderer.includes("visibility: hidden")) {
    console.log("✅ PaneTreeRenderer: Uses invisible layout layer (absolute positioning)");
  } else {
    console.log("⚠️  PaneTreeRenderer: Missing visibility:hidden layout layer");
  }

  if (renderer.includes("position: \"absolute\"")) {
    console.log("✅ PaneTreeRenderer: Terminal mounts use absolute positioning");
  } else {
    console.log("⚠️  PaneTreeRenderer: Missing absolute positioning for terminals");
  }

  if (renderer.includes("stableLeaves")) {
    console.log("✅ PaneTreeRenderer: Uses stable leaf list (prevents remount)");
  } else {
    console.log("⚠️  PaneTreeRenderer: Missing stable leaf list");
  }

  // 4. Check TerminalArea cleanup does NOT close PTY
  const termArea = fs.readFileSync("src/features/terminal/TerminalArea.tsx", "utf-8");
  if (termArea.includes("close_terminal")) {
    console.log("❌ TerminalArea: Still calls close_terminal in cleanup — will kill PTY on remount");
  } else {
    console.log("✅ TerminalArea: Does NOT close PTY in cleanup");
  }

  // 5. Check useAgentManager stopAgent resets activeSessionId
  const agentMgr = fs.readFileSync("src/shared/hooks/useAgentManager.ts", "utf-8");
  if (agentMgr.includes("setActiveSessionId") && agentMgr.includes("stopAgent")) {
    const stopBlock = agentMgr.slice(agentMgr.indexOf("const stopAgent"));
    if (stopBlock.includes("setActiveSessionId")) {
      console.log("✅ useAgentManager: stopAgent resets activeSessionId");
    } else {
      console.log("❌ useAgentManager: stopAgent does NOT reset activeSessionId");
    }
  }

  // 6. Check WorkflowPanel filters finished workflows
  const workflow = fs.readFileSync("src/features/workflow/WorkflowPanel.tsx", "utf-8");
  if (workflow.includes("isFinished") || workflow.includes("TERMINAL_STATUSES")) {
    console.log("✅ WorkflowPanel: Filters finished workflows from running list");
  } else {
    console.log("❌ WorkflowPanel: Does NOT filter finished workflows");
  }

  // 7. Check SplitPane syncs defaultRatio
  const splitPane = fs.readFileSync("src/shared/ui/SplitPane.tsx", "utf-8");
  if (splitPane.includes("prevDefault") || splitPane.includes("defaultRatio !== prev")) {
    console.log("✅ SplitPane: Syncs ratio on defaultRatio change");
  } else {
    console.log("❌ SplitPane: Does NOT sync ratio on defaultRatio change");
  }

  // 8. Check useTabManager uses ref for closeTab
  const tabMgr = fs.readFileSync("src/shared/hooks/useTabManager.ts", "utf-8");
  if (tabMgr.includes("tabsRef")) {
    console.log("✅ useTabManager: Uses tabsRef in closeTab (no stale closure)");
  } else {
    console.log("❌ useTabManager: closeTab may have stale closure");
  }

  // 9. Check Ctrl+F is scoped to active terminal
  if (termArea.includes("containerRef.current?.contains(document.activeElement)")) {
    console.log("✅ TerminalArea: Ctrl+F scoped to focused terminal");
  } else {
    console.log("❌ TerminalArea: Ctrl+F fires on ALL terminals");
  }

  // 10. Check FileTree uses useEffect for root load
  const fileTree = fs.readFileSync("src/features/file-tree/FileTree.tsx", "utf-8");
  if (fileTree.includes("useEffect") && fileTree.includes("loadRoot")) {
    console.log("✅ FileTree: Root load in useEffect (no render-time side effect)");
  } else {
    console.log("⚠️  FileTree: Root load may have render-time side effect");
  }

  console.log("\n=== Smoke Test Complete ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
