import {
  extractYamlBlock,
  scalarField,
} from "./audit-remediation-continuation-contract.mjs";

const PRODUCT_DELIVERY_SLICE_PATTERN = /\b(?:GMV-\d+|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactBacktickHeaderField(source, label) {
  const matches = [
    ...String(source ?? "").matchAll(
      new RegExp(`^${escapeRegExp(label)}:\\s*\\x60([^\\x60]+)\\x60\\.?\\s*$`, "gim"),
    ),
  ];
  return matches.length === 1 ? matches[0][1].trim() : null;
}

function safeRelativePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").trim();
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-z]:\//i.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}

export function productDeliverySliceId(value) {
  return String(value ?? "").match(PRODUCT_DELIVERY_SLICE_PATTERN)?.[0] ?? null;
}

export function hasProductDeliverySliceAnchor(source, sliceId) {
  if (productDeliverySliceId(sliceId) !== sliceId) return false;
  return new RegExp(`^###\\s+${escapeRegExp(sliceId)}(?:\\s|—|-)`, "m").test(String(source ?? ""));
}

export function parseProductDeliveryContinuationContract(source) {
  const block = extractYamlBlock(source, "continuation_contract");
  const fields = block
    ? Object.fromEntries(
        ["tracked_plan", "root_work_order", "worklog_dir", "local_handoff", "verifier"].map((label) => [
          label,
          scalarField(block, label),
        ]),
      )
    : {};
  const problems = [];
  if (!block) problems.push("continuation-contract-block");
  for (const label of ["tracked_plan", "root_work_order", "worklog_dir", "local_handoff", "verifier"]) {
    if (!fields[label]) problems.push(`${label}-present`);
  }
  for (const label of ["tracked_plan", "root_work_order", "worklog_dir", "local_handoff"]) {
    if (fields[label] && !safeRelativePath(fields[label])) problems.push(`${label}-safe-relative-path`);
  }
  if (fields.worklog_dir && !fields.worklog_dir.startsWith(".codex-auto/worklogs/")) {
    problems.push("worklog-dir-owner");
  }
  if (fields.local_handoff && !fields.local_handoff.startsWith(".claude/agent-memory-local/")) {
    problems.push("local-handoff-owner");
  }
  if (fields.verifier && !/^pnpm verify:[a-z0-9:-]+$/i.test(fields.verifier)) {
    problems.push("verifier-package-command");
  }
  return { ok: problems.length === 0, fields, problems };
}

export function parseProductDeliveryFrontier(source) {
  const statusMatches = [...String(source ?? "").matchAll(/^STATUS:\s*([^\r\n]+)$/gm)];
  const status = statusMatches.length === 1 ? statusMatches[0][1].trim() : null;
  const program = exactBacktickHeaderField(source, "PROGRAM");
  const activePhase = exactBacktickHeaderField(source, "CURRENT PHASE");
  const activeSlice = exactBacktickHeaderField(source, "ACTIVE SLICE");
  const completedSlice = exactBacktickHeaderField(source, "LAST COMPLETED SLICE");
  const nextSlice = exactBacktickHeaderField(source, "NEXT IMPLEMENTATION SLICE");
  const problems = [];
  if (status !== "ACTIVE") problems.push("status-active");
  if (program !== "product-delivery") problems.push("program-exact");
  if (!activePhase) problems.push("active-phase-exact");
  if (!activeSlice || productDeliverySliceId(activeSlice) !== activeSlice) problems.push("active-slice-exact");
  if (!completedSlice || productDeliverySliceId(completedSlice) !== completedSlice) {
    problems.push("completed-slice-exact");
  }
  if (!nextSlice || productDeliverySliceId(nextSlice) !== nextSlice) problems.push("next-slice-exact");
  return {
    ok: problems.length === 0,
    status,
    program,
    activePhase,
    activeSlice,
    completedSlice,
    nextSlice,
    problems,
  };
}
