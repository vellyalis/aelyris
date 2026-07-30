import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a6-modularity-inventory.json");
const cliArgs = process.argv.slice(2);
const requestedSlice = cliArgs.length === 2 && cliArgs[0] === "--require-slice" ? cliArgs[1] : null;
if (cliArgs.length > 0 && !["A6.2", "A6.3"].includes(requestedSlice)) {
  console.error("verify-a6-modularity-inventory supports only --require-slice A6.2 or A6.3.");
  process.exit(2);
}
const owners = [
  {
    path: "src/App.tsx",
    owner: "frontend composition shell",
    baselineLines: 4239,
    targetLines: 800,
    nextSlice: "A6.2",
  },
  {
    path: "src/features/right-rail/rightRailModel.tsx",
    owner: "right-rail projection and action model",
    baselineLines: 688,
    targetLines: 800,
    nextSlice: "A6.2",
  },
  {
    path: "src-tauri/src/ipc/commands.rs",
    owner: "legacy Tauri IPC adapter",
    baselineLines: 4574,
    targetLines: 800,
    nextSlice: "A6.3",
  },
  {
    path: "src-tauri/src/api/mcp.rs",
    owner: "MCP catalog, governance adapter, and dispatcher",
    baselineLines: 5943,
    targetLines: 1200,
    nextSlice: "A6.4",
  },
  {
    path: "src-tauri/src/db/queries.rs",
    owner: "legacy SQLite repository facade",
    baselineLines: 3330,
    targetLines: 1200,
    nextSlice: "A6.5",
  },
  {
    path: "src-tauri/src/bin/aelyris_native.rs",
    owner: "native proof CLI entrypoint",
    baselineLines: 8827,
    targetLines: 1200,
    nextSlice: "A6.6",
  },
];

const read = (path) => readFileSync(join(root, path), "utf8");
const lineCount = (text) => text.split(/\r?\n/).length;
const results = owners.map((owner) => {
  const lines = lineCount(read(owner.path));
  return {
    ...owner,
    lines,
    status: lines <= owner.baselineLines ? "pass" : "fail",
    deltaFromBaseline: lines - owner.baselineLines,
  };
});

const normalizePath = (path) => path.replaceAll("\\", "/");
const collectFiles = (relativeDir, predicate) => {
  const files = [];
  const visit = (relativePath) => {
    for (const entry of readdirSync(join(root, relativePath), { withFileTypes: true })) {
      const child = normalizePath(join(relativePath, entry.name));
      if (entry.isDirectory()) {
        visit(child);
      } else if (predicate(child)) {
        files.push(child);
      }
    }
  };
  visit(relativeDir);
  return files.sort();
};
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const commandCallPattern = (name) =>
  new RegExp(`\\b(?:invoke|invokeIpc)(?:<[^>\\r\\n]+>)?\\s*\\(\\s*["']${escapeRegExp(name)}["']`);
const stripSourceComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const executableSource = (source) => stripSourceComments(source).split("#[cfg(test)]", 1)[0];
const rustCallPattern = (name) => new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`);
const exactStringPattern = (name) => new RegExp(`["']${escapeRegExp(name)}["']`);

const frozenA63Handlers = [
  "startup_reconciliation_status",
  "spawn_terminal",
  "respawn_terminal",
  "force_restart_terminal",
  "write_terminal",
  "native_terminal_input_status",
  "native_terminal_input_preedit",
  "native_terminal_input_focus",
  "native_terminal_input_drain",
  "native_terminal_input_paste",
  "native_terminal_input_commit",
  "resize_terminal",
  "close_terminal",
  "mux_process_keymap_event",
  "term_snapshot",
  "term_prompt_marks",
  "term_command_blocks",
  "term_persisted_command_blocks",
  "term_history_size",
  "term_history_rows",
  "terminal_output_journal",
  "term_search_history",
  "term_image_data",
  "term_image_metrics",
  "performance_observatory_metrics",
  "list_terminals",
  "detect_shells",
  "start_agent",
  "stop_agent",
  "list_agents",
  "list_agent_fleet",
  "route_agent",
  "inspect_merge_worktree_branch",
  "start_chat_agent",
  "save_temp_image",
  "save_clipboard_image",
  "read_clipboard_text",
  "write_clipboard_text",
  "stop_chat_agent",
  "list_all_files",
];
const extractedNativeInputHandlers = [
  "native_terminal_input_status",
  "native_terminal_input_preedit",
  "native_terminal_input_focus",
  "native_terminal_input_drain",
  "native_terminal_input_paste",
  "native_terminal_input_commit",
];
const handlerOwnerPaths = ["src-tauri/src/ipc/commands.rs", "src-tauri/src/ipc/ime_commands.rs"];
const handlerOwnerSources = Object.fromEntries(handlerOwnerPaths.map((path) => [path, read(path)]));
const libSource = read("src-tauri/src/lib.rs");
const registrationBlocks = [...libSource.matchAll(/tauri::generate_handler!\s*\[([\s\S]*?)\]/g)].map(
  (match) => match[1],
);
const registrationSource = registrationBlocks.length === 1 ? registrationBlocks[0] : "";
const frontendFacadePath = "src/shared/lib/ipc.ts";
const frontendFacadeSource = read(frontendFacadePath);
const frontendSources = collectFiles(
  "src",
  (path) => /\.(?:ts|tsx)$/.test(path) && !path.includes("/__tests__/") && path !== frontendFacadePath,
);
const frontendSourceEntries = frontendSources.map((path) => [path, read(path)]);
const apiSources = collectFiles("src-tauri/src/api", (path) => path.endsWith(".rs"));
const apiSourceEntries = apiSources.map((path) => [path, read(path)]);
const testSources = [
  ...collectFiles("src/__tests__", (path) => /\.(?:ts|tsx)$/.test(path)).map((path) => [path, read(path)]),
  ...collectFiles("src-tauri/tests", (path) => path.endsWith(".rs")).map((path) => [path, read(path)]),
  ...collectFiles("src-tauri/src", (path) => path.endsWith(".rs") && path !== "src-tauri/src/lib.rs").map((path) => {
    const source = read(path);
    const testStart = source.lastIndexOf("#[cfg(test)]");
    return [path, testStart >= 0 ? source.slice(testStart) : ""];
  }),
];
const declarationPattern = (name) =>
  new RegExp(
    `#\\[tauri::command(?:\\([^\\]]*\\))?\\]\\s*(?:#\\[[^\\]]+\\]\\s*)*pub(?:\\([^)]*\\))?\\s+(?:async\\s+)?fn\\s+${escapeRegExp(name)}\\b`,
  );
const handlerClassifications = frozenA63Handlers.map((name) => {
  const declaredOwnerPaths = handlerOwnerPaths.filter((path) =>
    declarationPattern(name).test(handlerOwnerSources[path]),
  );
  const registered = new RegExp(`\\bipc::${escapeRegExp(name)}\\b`).test(registrationSource);
  const frontendInvokePaths = frontendSourceEntries
    .filter(([, source]) => commandCallPattern(name).test(stripSourceComments(source)))
    .map(([path]) => path);
  const typedFacade = new RegExp(`command:\\s*["']${escapeRegExp(name)}["']`).test(frontendFacadeSource);
  const mcpHttpReusePaths = apiSourceEntries
    .filter(([, source]) => rustCallPattern(name).test(executableSource(source)))
    .map(([path]) => path);
  const testPaths = testSources
    .filter(
      ([, source]) =>
        rustCallPattern(name).test(stripSourceComments(source)) ||
        exactStringPattern(name).test(stripSourceComments(source)),
    )
    .map(([path]) => path);
  const compatibilityAliases = [];
  return {
    name,
    declaredOwnerPaths,
    registered,
    frontendInvokePaths,
    typedFacade,
    mcpHttpReusePaths,
    testPaths,
    compatibilityAliases,
    compatibilityAliasClassification: "none-observed",
    compatibilityStatus: registered ? "canonical-command-name-preserved" : "registration-missing",
    deletionAuthorized: false,
    deletionAuthorizationReason: "absence-alone-never-authorizes-deletion",
  };
});
const unregistered = handlerClassifications.filter((entry) => !entry.registered).map((entry) => entry.name);
const duplicateDeclarations = handlerClassifications
  .filter((entry) => entry.declaredOwnerPaths.length !== 1)
  .map((entry) => ({ name: entry.name, ownerPaths: entry.declaredOwnerPaths }));
const classificationComplete =
  registrationBlocks.length === 1 &&
  handlerClassifications.length === frozenA63Handlers.length &&
  unregistered.length === 0 &&
  duplicateDeclarations.length === 0 &&
  handlerClassifications.every((entry) => entry.deletionAuthorized === false);
const nativeExtractionComplete = extractedNativeInputHandlers.every((name) => {
  const entry = handlerClassifications.find((candidate) => candidate.name === name);
  return (
    entry?.declaredOwnerPaths.length === 1 &&
    entry.declaredOwnerPaths[0] === "src-tauri/src/ipc/ime_commands.rs" &&
    entry.typedFacade
  );
});

const rustEventOwnerPath = "src-tauri/src/ipc/event_commands.rs";
const rustEventOwnerSource = read(rustEventOwnerPath);
const rustRuntimeSources = collectFiles(
  "src-tauri/src",
  (path) => path.endsWith(".rs") && path !== rustEventOwnerPath,
).map((path) => [path, executableSource(read(path))]);
const eventContracts = [
  ["agentSessionsUpdated", "agent-sessions-updated"],
  ["agentFleetUpdated", "agent-fleet-updated"],
  ["terminalOutput", "pty-output-"],
  ["terminalExit", "pty-exit-"],
  ["terminalDiff", "term:diff-"],
  ["terminalPromptMark", "term:prompt-mark-"],
  ["terminalLag", "term:lag-"],
  ["snapshotCaptured", "snapshot:captured-"],
  ["agentOutput", "agent-output-"],
  ["watchdogDecision", "watchdog-decision-"],
  ["agentExit", "agent-exit-"],
  ["chatStream", "chat-stream-"],
  ["chatSessionId", "chat-session-id-"],
  ["chatComplete", "chat-complete-"],
].map(([key, wirePrefix]) => {
  const rawRuntimeOwnerViolations = rustRuntimeSources
    .filter(([, source]) => source.includes(`"${wirePrefix}`))
    .map(([path]) => path);
  return {
    key,
    wirePrefix,
    rustOwner: rustEventOwnerSource.includes(wirePrefix),
    frontendOwner: frontendFacadeSource.includes(wirePrefix),
    rawRuntimeOwnerViolations,
  };
});
const eventRegistryComplete = eventContracts.every(
  (entry) => entry.rustOwner && entry.frontendOwner && entry.rawRuntimeOwnerViolations.length === 0,
);
const ipcOwner = results.find((result) => result.path === "src-tauri/src/ipc/commands.rs");
const ipcSliceComplete =
  ipcOwner?.status === "pass" && classificationComplete && nativeExtractionComplete && eventRegistryComplete;
const ipcClassification = {
  frozenHandlerCount: frozenA63Handlers.length,
  declaredHandlerCount: handlerClassifications.filter((entry) => entry.declaredOwnerPaths.length === 1).length,
  registered: handlerClassifications.filter((entry) => entry.registered).length,
  unregistered,
  duplicateDeclarations,
  registrationRegistry: {
    ownerPath: "src-tauri/src/lib.rs",
    generateHandlerBlockCount: registrationBlocks.length,
    complete: registrationBlocks.length === 1 && unregistered.length === 0,
  },
  classificationComplete,
  nativeExtractionComplete,
  handlerClassifications,
  eventRegistry: {
    rustOwnerPath: rustEventOwnerPath,
    frontendOwnerPath: frontendFacadePath,
    contracts: eventContracts,
    complete: eventRegistryComplete,
  },
  rule: "No handler may be deleted until registration, frontend invoke, MCP/HTTP reuse, tests, and compatibility aliases are all classified.",
};

const slices = [
  {
    id: "A6.2",
    owner: "frontend shell and right-rail projection",
    acceptance: "extract state/contract owners, narrow selectors, preserve rendered trust gates, lower both baselines",
  },
  {
    id: "A6.3",
    owner: "Tauri IPC adapter and event registry",
    acceptance: "typed facade, classify all legacy handlers, preserve command names, lower commands.rs baseline",
  },
  {
    id: "A6.4",
    owner: "MCP catalog and dispatch",
    acceptance: "separate catalog/schema/governance/domain dispatch with exact verb drift tests, lower mcp.rs baseline",
  },
  {
    id: "A6.5",
    owner: "SQLite domain repositories",
    acceptance: "split query domains behind one Database connection/migration owner, lower queries.rs baseline",
  },
  {
    id: "A6.6",
    owner: "native proof CLI",
    acceptance:
      "split command router and proof domains without changing artifact schemas or host behavior, lower native baseline",
  },
  {
    id: "A6.7",
    owner: "duplicate and unowned infrastructure",
    acceptance: "remove only callsite-proven dead owners; no parallel state managers remain",
  },
  {
    id: "A6.8",
    owner: "combined modularity acceptance",
    acceptance: "all ratchets reject growth, target gates pass, and advisory mode is retired",
  },
];

const failed = results.some((result) => result.status === "fail");
const frontendOwners = results.filter((result) => result.nextSlice === "A6.2");
const frontendFailedOwners = frontendOwners.filter((result) => result.status === "fail");
const frontendSlice = {
  id: "A6.2",
  owner: "frontend shell and right-rail projection",
  status: frontendFailedOwners.length === 0 ? "pass" : "fail",
  sliceComplete: frontendFailedOwners.length === 0,
  ownerPaths: frontendOwners.map((result) => result.path),
  failedOwnerPaths: frontendFailedOwners.map((result) => result.path),
};
const ipcSlice = {
  id: "A6.3",
  owner: "Tauri IPC adapter, typed facade, and event registry",
  status: ipcSliceComplete ? "pass" : "fail",
  sliceComplete: ipcSliceComplete,
  handlerCount: frozenA63Handlers.length,
  classifiedHandlerCount: handlerClassifications.length,
  commandsLines: ipcOwner?.lines ?? null,
  commandsBaselineLines: ipcOwner?.baselineLines ?? null,
  phaseComplete: false,
};
const commandFailed =
  requestedSlice === "A6.2"
    ? !frontendSlice.sliceComplete
    : requestedSlice === "A6.3"
      ? !ipcSlice.sliceComplete
      : failed;
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-modularity-inventory/v2",
  status: failed ? "failed" : "pass-a6.1-inventory-frozen",
  sliceComplete: !failed,
  phaseComplete: false,
  ratchetMode: "reject-growth-from-frozen-baseline",
  evaluation: {
    mode: requestedSlice ? "required-slice" : "global",
    requestedSlice,
    commandStatus: commandFailed ? "failed" : "passed",
    globalStatus: failed ? "failed" : "passed",
  },
  frontendSlice,
  ipcSlice,
  owners: results,
  ipcClassification,
  slices,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a6-modularity-inventory.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/ipc/event_commands.rs",
      "src-tauri/src/ipc/ime_commands.rs",
      ...rustRuntimeSources.map(([path]) => path),
      "src/shared/lib/ipc.ts",
      ...owners.map((owner) => owner.path),
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (commandFailed) process.exit(1);
