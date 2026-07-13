const GRANULAR_SLICE_PATTERN = /\bA\d+(?:\.\d+)+(?:[a-z]\d*)?\b/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed === "null") return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function canonicalGitStatus(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, "; ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

export function scalarField(text, label) {
  const match = String(text ?? "").match(new RegExp(`^\\s*${escapeRegExp(label)}:\\s*(.*?)\\s*$`, "im"));
  return unquote(match?.[1]);
}

export function backtickField(text, label) {
  const matches = [
    ...String(text ?? "").matchAll(new RegExp(`^${escapeRegExp(label)}:\\s*\`([^\`]+)\`[^\\r\\n]*$`, "gim")),
  ];
  return matches.length === 1 ? matches[0][1].trim() : null;
}

export function granularSliceId(value) {
  return String(value ?? "").match(GRANULAR_SLICE_PATTERN)?.[0] ?? null;
}

export function phaseForSlice(value) {
  return granularSliceId(value)?.match(/^A\d+/i)?.[0] ?? null;
}

export function hasPlanSliceAnchor(plan, sliceId) {
  if (!granularSliceId(sliceId) || granularSliceId(sliceId) !== sliceId) return false;
  return new RegExp(`^\\s*(?:(?:#{3,6})\\s+|\\d+\\.\\s+)\\*\\*?${escapeRegExp(sliceId)}(?:\\s|\\*)`, "im").test(
    String(plan ?? ""),
  );
}

export function extractYamlBlock(text, rootKey) {
  const blocks = [...String(text ?? "").matchAll(/```yaml\s*\r?\n([\s\S]*?)```/gi)].map((match) => match[1]);
  const matching = blocks.filter((block) => new RegExp(`^${escapeRegExp(rootKey)}:`, "m").test(block));
  return matching.length === 1 ? matching[0] : null;
}

export function sectionAfterHeading(text, heading) {
  const source = String(text ?? "");
  const start = source.indexOf(heading);
  if (start < 0) return "";
  const bodyStart = start + heading.length;
  const nextHeading = source.slice(bodyStart).search(/\r?\n##\s+/);
  return nextHeading < 0 ? source.slice(bodyStart) : source.slice(bodyStart, bodyStart + nextHeading);
}

function hasField(text, label) {
  return new RegExp(`^\\s*${escapeRegExp(label)}:`, "im").test(String(text ?? ""));
}

function fieldCount(text, label) {
  return [...String(text ?? "").matchAll(new RegExp(`^\\s*${escapeRegExp(label)}:`, "gim"))].length;
}

function jsonArrayField(text, label) {
  const raw = scalarField(text, label);
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
  } catch {
    return null;
  }
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateCurrentWorklogPath(value, worklogDir) {
  const path = String(value ?? "").replace(/\\/g, "/");
  const prefix = `${String(worklogDir).replace(/\\/g, "/").replace(/\/$/, "")}/`;
  const problems = [];
  if (!path.startsWith(prefix)) problems.push("wrong-worklog-dir");
  if (!path.endsWith(".md")) problems.push("worklog-extension");
  if (/^[a-z]:\//i.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
    problems.push("unsafe-worklog-path");
  }
  if (path.slice(prefix.length).includes("/")) problems.push("nested-worklog-path");
  return { ok: problems.length === 0, path, problems };
}

function commandEntries(block) {
  const declared = [...String(block ?? "").matchAll(/^\s*-\s+command:\s*(.+?)\s*$/gm)].length;
  const valid = [
    ...String(block ?? "").matchAll(
      /^\s*-\s+command:\s*(.+?)\s*\r?\n\s+result:\s*(PASS|REVIEW|BLOCK|NOT_RUN)\s*\r?\n\s+artifact:\s*(.+?)\s*$/gm,
    ),
  ].map((match) => ({ command: unquote(match[1]), result: match[2].toUpperCase(), artifact: unquote(match[3]) }));
  return { declared, valid };
}

function isSafeRepoArtifact(path) {
  if (path == null) return true;
  const normalized = String(path).replace(/\\/g, "/");
  return !(/^[a-z]:\//i.test(normalized) || normalized.startsWith("/") || normalized.split("/").includes(".."));
}

export function validateWorkRecord({
  source,
  expectedProgram,
  expectedPhase,
  expectedActiveSlice,
  expectedCompletedSlice,
  expectedNextSlice,
  expectedBranch,
  expectedHead,
  expectedGitStatus,
  expectedCommit,
}) {
  const block = extractYamlBlock(source, "work_record");
  const missing = [];
  if (!block) return { ok: false, missing: ["yaml-work-record"], fields: {}, commandCount: 0 };

  const fields = Object.fromEntries(
    [
      "program",
      "session_date_jst",
      "branch",
      "head_at_start",
      "head_at_close",
      "worktree_at_start",
      "worktree_at_close",
      "active_phase",
      "active_slice",
      "completed_slice",
      "next_implementation_slice",
      "objective",
      "commit",
      "next_exact_action",
    ].map((label) => [label, scalarField(block, label)]),
  );

  for (const label of [
    "program",
    "session_date_jst",
    "branch",
    "head_at_start",
    "head_at_close",
    "worktree_at_start",
    "worktree_at_close",
    "active_phase",
    "active_slice",
    "completed_slice",
    "next_implementation_slice",
    "objective",
    "files_read",
    "files_changed",
    "commands",
    "decisions",
    "commit",
    "blockers",
    "implementation",
    "stale_evidence",
    "policy",
    "external",
    "residual_risk",
    "next_exact_action",
  ]) {
    if (!hasField(block, label)) missing.push(label);
    if (fieldCount(block, label) !== 1) missing.push(`${label}-exactly-once`);
  }

  if (fields.program !== expectedProgram) missing.push("program-exact");
  if (fields.active_phase !== expectedPhase) missing.push("active-phase-exact");
  if (fields.active_slice !== expectedActiveSlice) missing.push("active-slice-exact");
  if (fields.completed_slice !== expectedCompletedSlice) missing.push("completed-slice-exact");
  if (fields.next_implementation_slice !== expectedNextSlice) missing.push("next-slice-exact");
  if (fields.branch !== expectedBranch) missing.push("branch-exact");
  if (fields.head_at_close !== expectedHead) missing.push("head-at-close-current");
  if (fields.commit !== expectedCommit) missing.push("commit-current");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(fields.session_date_jst ?? "")) {
    missing.push("session-date-exact");
  }
  if (!/^[0-9a-f]{7,40}$/.test(fields.head_at_start ?? "")) missing.push("head-at-start-sha");
  if (!fields.objective) missing.push("objective-nonempty");
  if (!fields.worktree_at_start) missing.push("worktree-at-start-nonempty");
  if (canonicalGitStatus(fields.worktree_at_close) !== canonicalGitStatus(expectedGitStatus)) {
    missing.push("worktree-at-close-current");
  }
  if (granularSliceId(fields.next_exact_action) !== expectedNextSlice) {
    missing.push("next-exact-action-slice");
  }

  for (const label of [
    "files_read",
    "files_changed",
    "decisions",
    "implementation",
    "stale_evidence",
    "policy",
    "external",
    "residual_risk",
  ]) {
    if (jsonArrayField(block, label) == null) missing.push(`${label}-typed-array`);
  }

  const commands = commandEntries(block);
  if (commands.declared === 0 || commands.valid.length !== commands.declared) {
    missing.push("commands-exact-result-artifact");
  }
  if (commands.valid.some((entry) => !entry.command || !isSafeRepoArtifact(entry.artifact))) {
    missing.push("commands-safe-artifact-path");
  }

  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
    fields,
    commandCount: commands.valid.length,
  };
}

export function validateHandoff({
  source,
  expectedProgram,
  expectedPhase,
  expectedActiveSlice,
  expectedCompletedSlice,
  expectedNextSlice,
  expectedBranch,
  expectedHead,
  expectedGitStatus,
  expectedWorklog,
  expectedChangedPaths,
}) {
  const block = extractYamlBlock(source, "program");
  const missing = [];
  if (!block) return { ok: false, missing: ["yaml-handoff"], fields: {} };

  const fields = Object.fromEntries(
    [
      "program",
      "active_phase",
      "active_slice",
      "last_completed_slice",
      "next_implementation_slice",
      "status",
      "branch",
      "head",
      "git_status",
      "worklog",
      "tracked_paths",
    ].map((label) => [label, scalarField(block, label)]),
  );

  const expected = {
    program: expectedProgram,
    active_phase: expectedPhase,
    active_slice: expectedActiveSlice,
    last_completed_slice: expectedCompletedSlice,
    next_implementation_slice: expectedNextSlice,
    status: "active",
    branch: expectedBranch,
    head: expectedHead,
    worklog: expectedWorklog,
  };
  for (const [label, value] of Object.entries(expected)) {
    if (fieldCount(block, label) !== 1) missing.push(`${label}-exactly-once`);
    if (fields[label] !== value) missing.push(`${label}-exact`);
  }
  if (fieldCount(block, "tracked_paths") !== 1) missing.push("tracked_paths-exactly-once");
  const trackedPaths = jsonArrayField(block, "tracked_paths");
  if (!sameStringSet(trackedPaths, expectedChangedPaths)) missing.push("tracked-paths-current");
  if (canonicalGitStatus(fields.git_status) !== canonicalGitStatus(expectedGitStatus)) {
    missing.push("git-status-current");
  }

  if (String(source).split("LOCAL ONLY. DO NOT COMMIT.").length - 1 !== 1) {
    missing.push("LOCAL ONLY. DO NOT COMMIT.");
  }
  for (const marker of [
    "## Read Order",
    "## Current Artifacts And Refresh Commands",
    "## Commands And Results",
    "## Blocker Split",
    "## Next Exact Action",
    "## Forbidden Scope",
    "## Pasteable /goal",
  ]) {
    if (String(source).split(marker).length - 1 !== 1) missing.push(marker);
  }

  const nextActionSlice = granularSliceId(sectionAfterHeading(source, "## Next Exact Action"));
  if (nextActionSlice !== expectedNextSlice) missing.push("handoff-next-action-slice");

  const goalSection = sectionAfterHeading(source, "## Pasteable /goal");
  const goalBlock = extractYamlBlock(goalSection, "continuation_goal");
  if (!goalBlock) {
    missing.push("pasteable-goal-metadata");
  } else {
    const goalFields = {
      program: scalarField(goalBlock, "program"),
      current_phase: scalarField(goalBlock, "current_phase"),
      active_slice: scalarField(goalBlock, "active_slice"),
      next_implementation_slice: scalarField(goalBlock, "next_implementation_slice"),
    };
    const goalExpected = {
      program: expectedProgram,
      current_phase: expectedPhase,
      active_slice: expectedActiveSlice,
      next_implementation_slice: expectedNextSlice,
    };
    for (const [label, value] of Object.entries(goalExpected)) {
      if (fieldCount(goalBlock, label) !== 1 || goalFields[label] !== value) {
        missing.push(`pasteable-goal-${label}`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
    fields: { ...fields, tracked_paths: trackedPaths },
  };
}
