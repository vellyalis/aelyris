import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a6-modularity-inventory.json");
const cliArgs = process.argv.slice(2);
const requestedSlice = cliArgs.length === 2 && cliArgs[0] === "--require-slice" ? cliArgs[1] : null;
if (cliArgs.length > 0 && !["A6.2", "A6.3", "A6.4", "A6.5", "A6.6"].includes(requestedSlice)) {
  console.error("verify-a6-modularity-inventory supports only --require-slice A6.2, A6.3, A6.4, A6.5, or A6.6.");
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
    owner: "MCP transport, governance, and composition gateway",
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

const mcpTransportOwnerPath = "src-tauri/src/api/mcp.rs";
const mcpCatalogOwnerPath = "src-tauri/src/api/mcp/catalog.rs";
const mcpDispatcherOwnerPath = "src-tauri/src/api/mcp/dispatch.rs";
const mcpTransportSource = read(mcpTransportOwnerPath);
const mcpCatalogSource = read(mcpCatalogOwnerPath);
const mcpDispatcherSource = read(mcpDispatcherOwnerPath);
const FROZEN_A64_SCHEMA_DIGEST = "7e5a99274a83c58d7068f3cdaa3af2d007e87fe827a1c80bddc68a4b59e2daf7";
const catalogBuilderStart = mcpCatalogSource.indexOf("fn build_tools_list_value()");
const catalogBuilderEnd = mcpCatalogSource.indexOf("pub(super) fn tools_list_value()", catalogBuilderStart);
const catalogBuilderSource =
  catalogBuilderStart >= 0 && catalogBuilderEnd > catalogBuilderStart
    ? mcpCatalogSource.slice(catalogBuilderStart, catalogBuilderEnd)
    : "";

const findBalancedObjectEnd = (source, start) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const extractCatalogSchemaEntries = (source) => {
  const entries = [];
  let cursor = 0;
  while (true) {
    const schemaLabelIndex = source.indexOf('"inputSchema"', cursor);
    if (schemaLabelIndex < 0) return { entries, error: null };
    const prefix = source.slice(cursor, schemaLabelIndex);
    const names = [...prefix.matchAll(/"name":\s*"([A-Za-z0-9_.-]+)"/g)];
    const name = names.at(-1)?.[1];
    const objectStart = source.indexOf("{", schemaLabelIndex + '"inputSchema"'.length);
    const objectEnd = objectStart >= 0 ? findBalancedObjectEnd(source, objectStart) : -1;
    if (!name || objectEnd < 0) {
      return { entries: [], error: `could not parse inputSchema at offset ${schemaLabelIndex}` };
    }
    const schemaSource = source.slice(objectStart, objectEnd + 1).replace(/,\s*([}\]])/g, "$1");
    try {
      entries.push([name, JSON.parse(schemaSource)]);
    } catch (error) {
      return {
        entries: [],
        error: `invalid inputSchema JSON for ${name}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    cursor = objectEnd + 1;
  }
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
};

const schemaContractDigest = (entries) =>
  createHash("sha256")
    .update(JSON.stringify(entries.map(([name, schema]) => [name, canonicalJson(schema)])))
    .digest("hex");

const frozenA64Match = mcpTransportSource.match(/const FROZEN_A64_VERBS:\s*\[&str;\s*83\]\s*=\s*\[([\s\S]*?)\];/);
const frozenA64Verbs = frozenA64Match
  ? [...frozenA64Match[1].matchAll(/"([A-Za-z0-9_.-]+)"/g)].map((match) => match[1])
  : [];
const catalogVerbs = [...mcpCatalogSource.matchAll(/"name":\s*"([A-Za-z0-9_.-]+)"/g)].map((match) => match[1]);
const catalogSchemaExtraction = extractCatalogSchemaEntries(catalogBuilderSource);
const catalogSchemaEntries = catalogSchemaExtraction.entries;
const schemaCount = catalogSchemaEntries.length;
const schemaDigest = schemaCount > 0 ? schemaContractDigest(catalogSchemaEntries) : null;
const schemaDigestExact = schemaDigest === FROZEN_A64_SCHEMA_DIGEST;
const dispatchStartMarker = "// A6.4_DISPATCH_TOOL_ARMS_BEGIN";
const dispatchEndMarker = "// A6.4_DISPATCH_TOOL_ARMS_END";
const dispatchStartMarkerCount = mcpDispatcherSource.split(dispatchStartMarker).length - 1;
const dispatchEndMarkerCount = mcpDispatcherSource.split(dispatchEndMarker).length - 1;
const dispatchRegion =
  dispatchStartMarkerCount === 1 && dispatchEndMarkerCount === 1
    ? mcpDispatcherSource.split(dispatchStartMarker, 2)[1].split(dispatchEndMarker, 1)[0]
    : "";
const dispatchVerbs = [...dispatchRegion.matchAll(/^\s*"([A-Za-z0-9_.-]+)"\s*=>/gm)].map((match) => match[1]);
const duplicates = (values) =>
  values
    .filter((value, index) => values.indexOf(value) !== index)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort();
const sameSet = (left, right) => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return left.length === leftSet.size && right.length === rightSet.size && leftSet.size === rightSet.size
    ? [...leftSet].every((value) => rightSet.has(value))
    : false;
};
const missingDispatch = catalogVerbs.filter((verb) => !dispatchVerbs.includes(verb)).sort();
const extraDispatch = dispatchVerbs.filter((verb) => !catalogVerbs.includes(verb)).sort();
const missingFrozen = frozenA64Verbs.filter((verb) => !catalogVerbs.includes(verb)).sort();
const extraFrozen = catalogVerbs.filter((verb) => !frozenA64Verbs.includes(verb)).sort();
const duplicateCatalog = duplicates(catalogVerbs);
const duplicateDispatch = duplicates(dispatchVerbs);
const transportToolsCallStart = mcpTransportSource.indexOf("pub(super) async fn tools_call(");
const transportToolsCallEnd = mcpTransportSource.indexOf(
  "// ---- Native MCP: JSON-RPC 2.0 over Streamable HTTP ----",
  transportToolsCallStart,
);
const transportToolsCall =
  transportToolsCallStart >= 0 && transportToolsCallEnd > transportToolsCallStart
    ? mcpTransportSource.slice(transportToolsCallStart, transportToolsCallEnd)
    : "";
const authorizeIndex = transportToolsCall.indexOf(".authorize(");
const schemaIndex = transportToolsCall.indexOf("input_schema_for_tool(");
const dispatchIndex = transportToolsCall.indexOf("dispatch::dispatch_authorized(");
const governanceBeforeSchema = authorizeIndex >= 0 && schemaIndex > authorizeIndex;
const schemaBeforeDispatch = schemaIndex >= 0 && dispatchIndex > schemaIndex;
const singleCatalogOwner =
  mcpTransportSource.includes("mod catalog;") &&
  mcpCatalogSource.includes("static TOOL_CATALOG:") &&
  mcpCatalogSource.includes("static TOOL_SCHEMA_INDEX:") &&
  mcpCatalogSource.includes("pub(super) fn tool_names()") &&
  mcpCatalogSource.includes('.get("tools")') &&
  !mcpTransportSource.includes("static TOOL_CATALOG:") &&
  !mcpTransportSource.includes("fn build_tools_list_value()");
const singleDispatcherOwner =
  mcpTransportSource.includes("mod dispatch;") &&
  (mcpDispatcherSource.match(/pub\(super\)\s+async\s+fn\s+dispatch_authorized\s*\(/g) ?? []).length === 1 &&
  dispatchStartMarkerCount === 1 &&
  dispatchEndMarkerCount === 1 &&
  !mcpTransportSource.includes("let result = match body.name.as_str()");
const proofbookReentryUsesGuardedToolsCall =
  mcpDispatcherSource.includes("match tools_call(State(state), Json(ToolCallBody { name, arguments })).await") &&
  !mcpDispatcherSource.includes("dispatch_authorized(&self.state");
const frozenContractExact =
  frozenA64Verbs.length === 83 &&
  sameSet(frozenA64Verbs, catalogVerbs) &&
  missingFrozen.length === 0 &&
  extraFrozen.length === 0;
const catalogSchemaExact =
  catalogVerbs.length === 83 &&
  schemaCount === 83 &&
  catalogSchemaExtraction.error === null &&
  schemaDigestExact &&
  duplicateCatalog.length === 0 &&
  mcpCatalogSource.includes("pub(super) fn tool_names()") &&
  mcpCatalogSource.includes("TOOL_CATALOG");
const catalogDispatchExact =
  dispatchVerbs.length === 83 &&
  duplicateDispatch.length === 0 &&
  sameSet(catalogVerbs, dispatchVerbs) &&
  missingDispatch.length === 0 &&
  extraDispatch.length === 0;
const acceptsFrozenVerbInventory = (candidate) =>
  candidate.length === 83 && duplicates(candidate).length === 0 && sameSet(candidate, frozenA64Verbs);
const mutatedSchemaEntries = catalogSchemaEntries.map(([name, schema]) => [name, structuredClone(schema)]);
const schemaMutationTarget = mutatedSchemaEntries.find(([name]) => name === "aelyris.knowledge.graph");
if (schemaMutationTarget) {
  schemaMutationTarget[1].additionalProperties = !schemaMutationTarget[1].additionalProperties;
}
const negativeDriftProof = {
  missingRejected: !acceptsFrozenVerbInventory(dispatchVerbs.slice(1)),
  extraRejected: !acceptsFrozenVerbInventory([...dispatchVerbs, "aelyris.test.extra"]),
  duplicateRejected: !acceptsFrozenVerbInventory([...dispatchVerbs.slice(0, -1), dispatchVerbs.at(-2)]),
  schemaMutationRejected:
    Boolean(schemaMutationTarget) && schemaContractDigest(mutatedSchemaEntries) !== FROZEN_A64_SCHEMA_DIGEST,
};
const mcpOwner = results.find((result) => result.path === mcpTransportOwnerPath);
const mcpSliceComplete =
  mcpOwner?.status === "pass" &&
  singleCatalogOwner &&
  singleDispatcherOwner &&
  frozenContractExact &&
  catalogSchemaExact &&
  catalogDispatchExact &&
  governanceBeforeSchema &&
  schemaBeforeDispatch &&
  proofbookReentryUsesGuardedToolsCall &&
  Object.values(negativeDriftProof).every(Boolean);
const mcpSlice = {
  id: "A6.4",
  owner: "MCP transport, catalog/schema, governance, and authorized domain dispatch",
  status: mcpSliceComplete ? "pass" : "fail",
  sliceComplete: mcpSliceComplete,
  mcpLines: mcpOwner?.lines ?? null,
  baselineLines: mcpOwner?.baselineLines ?? null,
  catalogOwnerPath: mcpCatalogOwnerPath,
  dispatcherOwnerPath: mcpDispatcherOwnerPath,
  frozenCount: frozenA64Verbs.length,
  catalogCount: catalogVerbs.length,
  schemaCount,
  schemaDigest,
  frozenSchemaDigest: FROZEN_A64_SCHEMA_DIGEST,
  schemaDigestExact,
  schemaExtractionError: catalogSchemaExtraction.error,
  dispatchCount: dispatchVerbs.length,
  singleCatalogOwner,
  singleDispatcherOwner,
  catalogSchemaExact,
  catalogDispatchExact,
  frozenContractExact,
  governanceBeforeSchema,
  schemaBeforeDispatch,
  proofbookReentryUsesGuardedToolsCall,
  missingDispatch,
  extraDispatch,
  missingFrozen,
  extraFrozen,
  duplicateCatalog,
  duplicateDispatch,
  negativeDriftProof,
  phaseComplete: false,
};
const dbQueriesOwnerPath = "src-tauri/src/db/queries.rs";
const dbCodeGraphOwnerPath = "src-tauri/src/db/queries/code_graph.rs";
const dbPaneLayoutOwnerPath = "src-tauri/src/db/queries/pane_layout.rs";
const dbQueriesSource = read(dbQueriesOwnerPath);
const dbCodeGraphSource = read(dbCodeGraphOwnerPath);
const dbPaneLayoutSource = read(dbPaneLayoutOwnerPath);
const dbQueriesExecutableSource = executableSource(dbQueriesSource);
const dbCodeGraphExecutableSource = executableSource(dbCodeGraphSource);
const dbPaneLayoutExecutableSource = executableSource(dbPaneLayoutSource);
const dbDomainExecutableSources = [dbCodeGraphExecutableSource, dbPaneLayoutExecutableSource];
const dbOwner = results.find((result) => result.path === dbQueriesOwnerPath);
const dbFacadeMethods = {
  [dbCodeGraphOwnerPath]: ["replace_code_graph", "load_code_graph"],
  [dbPaneLayoutOwnerPath]: ["save_pane_tree_layout", "get_pane_tree_layout", "delete_pane_tree_layout"],
};
const countMethodDeclarations = (source, method) =>
  [...source.matchAll(new RegExp(`\\bpub\\s+fn\\s+${escapeRegExp(method)}\\s*\\(`, "g"))].length;
const dbFacadeMethodsExact = Object.entries(dbFacadeMethods).every(([path, methods]) => {
  const ownerSource = path === dbCodeGraphOwnerPath ? dbCodeGraphExecutableSource : dbPaneLayoutExecutableSource;
  return methods.every(
    (method) =>
      countMethodDeclarations(ownerSource, method) === 1 &&
      countMethodDeclarations(dbQueriesExecutableSource, method) === 0 &&
      dbDomainExecutableSources.reduce((count, source) => count + countMethodDeclarations(source, method), 0) === 1,
  );
});
const dbDomainModulesRegistered = (source) =>
  /\bmod\s+code_graph\s*;/.test(source) && /\bmod\s+pane_layout\s*;/.test(source);
const dbDomainImplsUseExistingOwner = (sources) =>
  sources.every(
    (source) =>
      /\bimpl\s+Database\s*\{/.test(source) &&
      !/\bstruct\s+\w*Repository\b/.test(source) &&
      !/\bConnection::open(?:_in_memory)?\s*\(/.test(source),
  );
const dbDomainModulesOwnNoSchemaOrMigration = (sources) =>
  sources.every(
    (source) =>
      !/\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i.test(source) &&
      !/\b(?:run_migrations|schema_version|CURRENT_SCHEMA_VERSION)\b/.test(source),
  );
const dbSingleConnectionAndMigrationOwner = (source) =>
  /\bpub\s+struct\s+Database\s*\{[\s\S]*?\bconn\s*:\s*Connection\b/.test(source) &&
  /\bConnection::open\s*\(/.test(source) &&
  /\bConnection::open_in_memory\s*\(/.test(source) &&
  /\bmigrations::run_migrations\s*\(/.test(source);
const currentDbDomainModulesRegistered = dbDomainModulesRegistered(dbQueriesExecutableSource);
const currentDbDomainImplsUseExistingOwner = dbDomainImplsUseExistingOwner(dbDomainExecutableSources);
const currentDbDomainModulesOwnNoSchemaOrMigration = dbDomainModulesOwnNoSchemaOrMigration(dbDomainExecutableSources);
const currentDbSingleConnectionAndMigrationOwner = dbSingleConnectionAndMigrationOwner(dbQueriesExecutableSource);
const commentedRegistrationSource = dbQueriesSource.replace(
  /mod\s+code_graph\s*;\s*mod\s+pane_layout\s*;/,
  "/* mod code_graph;\nmod pane_layout; */",
);
const dbNegativeTopologyProof = {
  commentedRegistrationRejected: !dbDomainModulesRegistered(executableSource(commentedRegistrationSource)),
  independentConnectionRejected: !dbDomainImplsUseExistingOwner([
    ...dbDomainExecutableSources,
    'fn forbidden_connection() { let _ = rusqlite::Connection::open("forbidden.db"); }',
  ]),
  schemaOwnerRejected: !dbDomainModulesOwnNoSchemaOrMigration([
    ...dbDomainExecutableSources,
    'const FORBIDDEN_SCHEMA: &str = "CREATE TABLE forbidden (id TEXT)";',
  ]),
  duplicateFacadeMethodRejected:
    countMethodDeclarations(
      `${dbCodeGraphExecutableSource}\nimpl Database { pub fn replace_code_graph(&self) {} }`,
      "replace_code_graph",
    ) !== 1,
};
const focusedDbTestCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const focusedDbTestArgs = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--lib",
  "db::queries",
  "--",
  "--color",
  "never",
];
const focusedDbTestExecution = spawnSync(focusedDbTestCommand, focusedDbTestArgs, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
});
const focusedDbTestOutput = `${focusedDbTestExecution.stdout ?? ""}\n${focusedDbTestExecution.stderr ?? ""}`;
const focusedDbTestSummary = focusedDbTestOutput.match(
  /test result:\s+ok\.\s+(\d+) passed;\s+0 failed;\s+(\d+) ignored;/,
);
const requiredDbBehaviorTests = [
  "db::queries::tests::test_code_graph_replace_load_roundtrip",
  "db::queries::code_graph::tests::replace_code_graph_rolls_back_the_whole_snapshot_on_insert_failure",
  "db::queries::tests::test_pane_tree_layout_save_get_delete",
  "db::queries::tests::test_pane_tree_layout_rejects_invalid_json",
];
const focusedDbTests = {
  command: `${focusedDbTestCommand} ${focusedDbTestArgs.join(" ")}`,
  status: focusedDbTestExecution.status,
  signal: focusedDbTestExecution.signal,
  error: focusedDbTestExecution.error?.message ?? null,
  passed: Number(focusedDbTestSummary?.[1] ?? 0),
  ignored: Number(focusedDbTestSummary?.[2] ?? 0),
  requiredAssertionsExecuted: requiredDbBehaviorTests.every((testName) =>
    focusedDbTestOutput.includes(`test ${testName} ... ok`),
  ),
};
const focusedDbTestsPassed =
  focusedDbTests.status === 0 &&
  focusedDbTests.passed > 0 &&
  focusedDbTests.ignored === 0 &&
  focusedDbTests.requiredAssertionsExecuted;
const dbSliceComplete =
  (dbOwner?.status ?? "fail") === "pass" &&
  currentDbDomainModulesRegistered &&
  dbFacadeMethodsExact &&
  currentDbDomainImplsUseExistingOwner &&
  currentDbDomainModulesOwnNoSchemaOrMigration &&
  currentDbSingleConnectionAndMigrationOwner &&
  Object.values(dbNegativeTopologyProof).every(Boolean) &&
  focusedDbTestsPassed;
const dbSlice = {
  id: "A6.5",
  owner: "SQLite domain repositories behind the existing Database owner",
  status: dbSliceComplete ? "pass" : "fail",
  sliceComplete: dbSliceComplete,
  queriesLines: dbOwner?.lines ?? null,
  queriesBaselineLines: dbOwner?.baselineLines ?? null,
  databaseOwnerPath: dbQueriesOwnerPath,
  domainOwnerPaths: [dbCodeGraphOwnerPath, dbPaneLayoutOwnerPath],
  domainModulesRegistered: currentDbDomainModulesRegistered,
  facadeMethodsExact: dbFacadeMethodsExact,
  domainImplsUseExistingOwner: currentDbDomainImplsUseExistingOwner,
  domainModulesOwnNoSchemaOrMigration: currentDbDomainModulesOwnNoSchemaOrMigration,
  singleConnectionAndMigrationOwner: currentDbSingleConnectionAndMigrationOwner,
  negativeTopologyProof: dbNegativeTopologyProof,
  focusedDbTests,
  phaseComplete: false,
};

const nativeEntrypointPath = "src-tauri/src/bin/aelyris_native.rs";
const nativeRouterOwnerPath = "src-tauri/src/bin/aelyris_native/router.rs";
const nativeReadinessOwnerPath = "src-tauri/src/bin/aelyris_native/readiness.rs";
const nativeClientOwnerPath = "src-tauri/src/bin/aelyris_native/client.rs";
const nativeOwnerPaths = [nativeEntrypointPath, nativeRouterOwnerPath, nativeReadinessOwnerPath, nativeClientOwnerPath];
const nativeEntrypointSource = read(nativeEntrypointPath);
const nativeRouterSource = read(nativeRouterOwnerPath);
const nativeReadinessSource = read(nativeReadinessOwnerPath);
const nativeClientSource = read(nativeClientOwnerPath);
const nativeProofSources = [nativeEntrypointSource, nativeRouterSource, nativeReadinessSource, nativeClientSource];
const nativeProofSource = nativeProofSources.join("\n");
const nativeOwner = results.find((result) => result.path === nativeEntrypointPath);
const cargoTomlSource = read("src-tauri/Cargo.toml");
const frozenA66Commands = [
  "help",
  "--help",
  "-h",
  "contract",
  "window-proof",
  "render-proof",
  "grid-render-proof",
  "present-loop-proof",
  "gpu-render-proof",
  "winit-wgpu-proof",
  "text-shaping-fixture-proof",
  "ime-proof",
  "ime-dogfood-proof",
  "ime-os-dogfood-proof",
  "ime-os-dogfood-worker",
  "paste-guard-proof",
  "settings-proof",
  "settings-window-proof",
  "command-center-proof",
  "command-center-window-proof",
  "command-center-input-scroll-proof",
  "mode-shell-proof",
  "mode-rail-window-proof",
  "inspector-window-proof",
  "right-rail-demotion-proof",
  "accessibility-proof",
  "uia-provider-proof",
  "visual-qa-proof",
  "primary-shell-proof",
  "power-events-proof",
  "db-smoke-proof",
  "upper-compat-proof",
  "sleep-now",
  "list",
  "mux",
  "graph",
  "attach",
  "detach",
  "send",
  "capture",
];
const nativeRouterStartMarker = "// A6.6_COMMAND_ROUTER_START";
const nativeRouterEndMarker = "// A6.6_COMMAND_ROUTER_END";
const nativeRouterStart = nativeRouterSource.indexOf(nativeRouterStartMarker);
const nativeRouterEnd = nativeRouterSource.indexOf(nativeRouterEndMarker);
const nativeRouterBlock =
  nativeRouterStart >= 0 && nativeRouterEnd > nativeRouterStart
    ? nativeRouterSource.slice(nativeRouterStart + nativeRouterStartMarker.length, nativeRouterEnd)
    : "";
const nativeRouterCommands = [...nativeRouterBlock.matchAll(/"([^"]+)"\s*(?:\||=>)/g)].map((match) => match[1]);
const nativeCommandContractExact =
  nativeRouterCommands.length === frozenA66Commands.length &&
  duplicates(nativeRouterCommands).length === 0 &&
  sameSet(nativeRouterCommands, frozenA66Commands);
const nativeSchemaEntries = [...nativeProofSource.matchAll(/"schema"\s*:\s*"([^"]+)"/g)]
  .map((match) => match[1])
  .sort();
const nativeSchemaDigest = createHash("sha256").update(nativeSchemaEntries.join("\n")).digest("hex");
const FROZEN_A66_SCHEMA_DIGEST = "adb8ce52f0e06ee1926f8ace2239dffd7e16ba318272dd67e7b6a7bbeefa26b9";
const nativeSchemaContractExact = nativeSchemaEntries.length === 62 && nativeSchemaDigest === FROZEN_A66_SCHEMA_DIGEST;
const nativeModulesRegistered =
  nativeEntrypointSource.includes('#[path = "aelyris_native/client.rs"]') &&
  nativeEntrypointSource.includes('#[path = "aelyris_native/readiness.rs"]') &&
  nativeEntrypointSource.includes('#[path = "aelyris_native/router.rs"]') &&
  !nativeEntrypointSource.includes("match command {") &&
  nativeRouterSource.includes("pub(super) async fn run()") &&
  nativeReadinessSource.includes("pub(super) async fn contract()") &&
  nativeReadinessSource.includes("pub(super) fn full_native_readiness_contract()") &&
  nativeClientSource.includes("pub(super) async fn request(");
const nativeOwnerBoundaryIsSingle =
  (nativeProofSource.match(/\basync\s+fn\s+run\s*\(/g) ?? []).length === 1 &&
  (nativeProofSource.match(/\basync\s+fn\s+contract\s*\(/g) ?? []).length === 1 &&
  (nativeProofSource.match(/\basync\s+fn\s+request\s*\(/g) ?? []).length === 1 &&
  (nativeProofSource.match(/\bfn\s+full_native_readiness_contract\s*\(/g) ?? []).length === 1 &&
  (nativeProofSource.match(/std::process::exit\s*\(\s*1\s*\)/g) ?? []).length === 1 &&
  nativeEntrypointSource.includes('eprintln!("aelyris-native: {err}")');
const nativeChildOwnersAddNoRuntimeState = [nativeRouterSource, nativeReadinessSource, nativeClientSource].every(
  (source) =>
    !/\b(?:static|struct)\s+\w*(?:Manager|Store|Repository|Runtime)\b/.test(source) &&
    !/\b(?:rusqlite|Connection::open|Database::new|OnceLock|static\s+\w+\s*:\s*Mutex)\b/.test(source),
);
const nativeHostBehaviorBoundaryRetained =
  (nativeEntrypointSource.match(/#\[cfg\(target_os = "windows"\)\]/g) ?? []).length === 43 &&
  (nativeEntrypointSource.match(/#\[cfg\(not\(target_os = "windows"\)\)\]/g) ?? []).length === 18 &&
  (nativeEntrypointSource.match(/#\[cfg\(windows\)\]/g) ?? []).length === 3 &&
  (nativeEntrypointSource.match(/#\[cfg\(not\(windows\)\)\]/g) ?? []).length === 2 &&
  [nativeRouterSource, nativeReadinessSource, nativeClientSource].every((source) => !source.includes("#[cfg("));
const nativeBinBlock =
  [...cargoTomlSource.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[\[bin\]\]|\n\[lib\])/g)]
    .map((match) => match[1])
    .find((block) => /\bname\s*=\s*"aelyris-native"/.test(block)) ?? "";
const nativeFeatureBoundaryDeclared =
  /\brequired-features\s*=\s*\[\s*"native-proof-cli"\s*\]/.test(nativeBinBlock) &&
  /\[features\][\s\S]*?\bnative-proof-cli\s*=\s*\[\s*\]/.test(cargoTomlSource) &&
  !/\bdefault\s*=\s*\[[^\]]*"native-proof-cli"/.test(cargoTomlSource);
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const nativeMetadataArgs = [
  "metadata",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--no-deps",
  "--format-version",
  "1",
];
const nativeMetadataExecution = spawnSync(cargoCommand, nativeMetadataArgs, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
});
let nativeMetadata = null;
try {
  nativeMetadata = JSON.parse(nativeMetadataExecution.stdout ?? "");
} catch {
  nativeMetadata = null;
}
const nativeMetadataTarget = nativeMetadata?.packages
  ?.find((pkg) => pkg.name === "aelyris")
  ?.targets?.find((target) => target.name === "aelyris-native" && target.kind?.includes("bin"));
const nativeDefaultUnavailable =
  nativeMetadataExecution.status === 0 &&
  nativeMetadataTarget?.["required-features"]?.length === 1 &&
  nativeMetadataTarget["required-features"][0] === "native-proof-cli";
const focusedNativeTestArgs = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--features",
  "native-proof-cli",
  "--bin",
  "aelyris-native",
  "--",
  "--color",
  "never",
];
const focusedNativeTestExecution = spawnSync(cargoCommand, focusedNativeTestArgs, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
});
const focusedNativeTestOutput = `${focusedNativeTestExecution.stdout ?? ""}\n${focusedNativeTestExecution.stderr ?? ""}`;
const focusedNativeTestSummary = focusedNativeTestOutput.match(
  /test result:\s+ok\.\s+(\d+) passed;\s+0 failed;\s+(\d+) ignored;/,
);
const requiredNativeBehaviorTests = [
  "tests::join_text_args_preserves_text_and_enter",
  "tests::grid_render_frame_uses_term_engine_cells",
  "tests::full_native_contract_is_honest_about_missing_daily_driver_work",
];
const focusedNativeTests = {
  command: `${cargoCommand} ${focusedNativeTestArgs.join(" ")}`,
  status: focusedNativeTestExecution.status,
  signal: focusedNativeTestExecution.signal,
  error: focusedNativeTestExecution.error?.message ?? null,
  passed: Number(focusedNativeTestSummary?.[1] ?? 0),
  ignored: Number(focusedNativeTestSummary?.[2] ?? 0),
  requiredAssertionsExecuted: requiredNativeBehaviorTests.every((testName) =>
    focusedNativeTestOutput.includes(`test ${testName} ... ok`),
  ),
};
const focusedNativeTestsPassed =
  focusedNativeTests.status === 0 &&
  focusedNativeTests.passed > 0 &&
  focusedNativeTests.ignored === 0 &&
  focusedNativeTests.requiredAssertionsExecuted;
const nativeExecutableBehavior = {
  helpListsFrozenCommands:
    nativeCommandContractExact &&
    frozenA66Commands
      .filter((command) => !["--help", "-h", "mux", "upper-compat-proof"].includes(command))
      .every((command) => nativeRouterSource.includes(command)),
  unknownCommandReturnsError: nativeRouterSource.includes('other => Err(format!("unknown command: {other}"))'),
  mainErrorPrefixExact: nativeEntrypointSource.includes('eprintln!("aelyris-native: {err}")'),
  mainErrorExitCodeOne: /std::process::exit\s*\(\s*1\s*\)/.test(nativeEntrypointSource),
  imeProofSchemaRetained: nativeProofSource.includes('"schema": "aelyris.native.client.v1"'),
};
const nativeExecutableBehaviorPassed =
  nativeExecutableBehavior.helpListsFrozenCommands &&
  nativeExecutableBehavior.unknownCommandReturnsError &&
  nativeExecutableBehavior.mainErrorPrefixExact &&
  nativeExecutableBehavior.mainErrorExitCodeOne &&
  nativeExecutableBehavior.imeProofSchemaRetained;
const nativeInvocationSources = {
  nativeClient: read("scripts/verify-native-client-spike.mjs"),
  sleepGuard: read("scripts/verify-native-sleep-guard.mjs"),
  upperCompat: read("scripts/verify-upper-compat-gates.mjs"),
  textShaping: read("scripts/verify-native-text-shaping-fallback.mjs"),
};
const nativeProofInvocationsOptIn =
  nativeInvocationSources.nativeClient.includes('"--features"') &&
  nativeInvocationSources.nativeClient.includes('"native-proof-cli"') &&
  nativeInvocationSources.sleepGuard.includes('"--features"') &&
  nativeInvocationSources.sleepGuard.includes('"native-proof-cli"') &&
  nativeInvocationSources.upperCompat.includes('"--features"') &&
  nativeInvocationSources.upperCompat.includes('"native-proof-cli"') &&
  nativeInvocationSources.textShaping.includes("--features native-proof-cli --bin aelyris-native");
const nativeFreshnessConsumerPaths = [
  "scripts/verify-full-native-rust-gap-audit.mjs",
  "scripts/verify-native-boundary-contract.mjs",
  "scripts/verify-native-first-hybrid-audit.mjs",
  "scripts/verify-native-hwnd-paste-live.mjs",
  "scripts/verify-native-operator-primary-terminal.mjs",
  "scripts/verify-native-sleep-guard.mjs",
  "scripts/verify-native-terminal-input-host.mjs",
  "scripts/verify-native-text-shaping-fallback.mjs",
  "scripts/verify-native-visual-regression.mjs",
  "scripts/verify-upper-compat-gates.mjs",
];
const nativeFreshnessConsumers = Object.fromEntries(
  nativeFreshnessConsumerPaths.map((path) => [path, read(path)]),
);
const nativeFreshnessConsumersCausal = Object.values(nativeFreshnessConsumers).every((source) =>
  nativeOwnerPaths.every((path) => source.includes(path)),
);
const nativeScoreConsumerSource = read("scripts/score-release-quality.mjs");
const nativeScoreConsumerCausal =
  nativeScoreConsumerSource.includes("const nativeProofSourcePaths = [") &&
  ["aelyris_native.rs", "client.rs", "readiness.rs", "router.rs"].every((leaf) =>
    nativeScoreConsumerSource.includes(leaf),
  );
const acceptsFrozenNativeCommands = (candidate) =>
  candidate.length === frozenA66Commands.length &&
  duplicates(candidate).length === 0 &&
  sameSet(candidate, frozenA66Commands);
const nativeNegativeTopologyProof = {
  missingCommandRejected: !acceptsFrozenNativeCommands(nativeRouterCommands.slice(1)),
  extraCommandRejected: !acceptsFrozenNativeCommands([...nativeRouterCommands, "a6.6-extra"]),
  duplicateCommandRejected: !acceptsFrozenNativeCommands([
    ...nativeRouterCommands.slice(0, -1),
    nativeRouterCommands.at(-2),
  ]),
  schemaMutationRejected:
    createHash("sha256")
      .update([...nativeSchemaEntries.slice(1), "aelyris.native.mutated.v1"].sort().join("\n"))
      .digest("hex") !== FROZEN_A66_SCHEMA_DIGEST,
  defaultFeatureMutationRejected: !/\brequired-features\s*=\s*\[\s*"native-proof-cli"\s*\]/.test(
    nativeBinBlock.replace('required-features = ["native-proof-cli"]', ""),
  ),
  freshnessSourceMutationRejected: !nativeOwnerPaths.every((path) =>
    nativeFreshnessConsumers["scripts/verify-native-text-shaping-fallback.mjs"]
      .replace(nativeClientOwnerPath, "src-tauri/src/bin/aelyris_native/missing-client.rs")
      .includes(path),
  ),
};
const nativeSliceComplete =
  (nativeOwner?.status ?? "fail") === "pass" &&
  (nativeOwner?.lines ?? 0) < (nativeOwner?.baselineLines ?? 0) &&
  nativeModulesRegistered &&
  nativeOwnerBoundaryIsSingle &&
  nativeChildOwnersAddNoRuntimeState &&
  nativeCommandContractExact &&
  nativeSchemaContractExact &&
  nativeHostBehaviorBoundaryRetained &&
  nativeFeatureBoundaryDeclared &&
  nativeDefaultUnavailable &&
  nativeProofInvocationsOptIn &&
  nativeFreshnessConsumersCausal &&
  nativeScoreConsumerCausal &&
  focusedNativeTestsPassed &&
  nativeExecutableBehaviorPassed &&
  Object.values(nativeNegativeTopologyProof).every(Boolean);
const nativeSlice = {
  id: "A6.6",
  owner: "feature-gated native proof CLI router, readiness contract, and daemon client",
  status: nativeSliceComplete ? "pass" : "fail",
  sliceComplete: nativeSliceComplete,
  entrypointLines: nativeOwner?.lines ?? null,
  baselineLines: nativeOwner?.baselineLines ?? null,
  ownerPaths: nativeOwnerPaths,
  modulesRegistered: nativeModulesRegistered,
  singleOwnerBoundaries: nativeOwnerBoundaryIsSingle,
  childOwnersAddNoRuntimeState: nativeChildOwnersAddNoRuntimeState,
  commandCount: nativeRouterCommands.length,
  frozenCommandCount: frozenA66Commands.length,
  commandContractExact: nativeCommandContractExact,
  schemaCount: nativeSchemaEntries.length,
  schemaDigest: nativeSchemaDigest,
  frozenSchemaDigest: FROZEN_A66_SCHEMA_DIGEST,
  schemaContractExact: nativeSchemaContractExact,
  hostBehaviorBoundaryRetained: nativeHostBehaviorBoundaryRetained,
  featureBoundaryDeclared: nativeFeatureBoundaryDeclared,
  defaultUnavailable: nativeDefaultUnavailable,
  proofInvocationsOptIn: nativeProofInvocationsOptIn,
  freshnessConsumers: {
    paths: nativeFreshnessConsumerPaths,
    causal: nativeFreshnessConsumersCausal,
    scoreConsumerCausal: nativeScoreConsumerCausal,
  },
  focusedNativeTests,
  executableBehavior: nativeExecutableBehavior,
  negativeTopologyProof: nativeNegativeTopologyProof,
  phaseComplete: false,
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
      : requestedSlice === "A6.4"
        ? !mcpSlice.sliceComplete
        : requestedSlice === "A6.5"
          ? !dbSlice.sliceComplete
          : requestedSlice === "A6.6"
            ? !nativeSlice.sliceComplete
            : failed;
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-modularity-inventory/v3",
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
  mcpSlice,
  dbSlice,
  nativeSlice,
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
      mcpCatalogOwnerPath,
      mcpDispatcherOwnerPath,
      dbCodeGraphOwnerPath,
      dbPaneLayoutOwnerPath,
      ...nativeOwnerPaths.slice(1),
      "src-tauri/Cargo.toml",
      "scripts/verify-native-client-spike.mjs",
      "scripts/verify-native-text-shaping-fallback.mjs",
      "scripts/verify-upper-compat-gates.mjs",
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
