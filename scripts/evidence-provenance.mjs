import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const EVIDENCE_PROVENANCE_SCHEMA = "aelyris.evidence-provenance/v1";
export const DEFAULT_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;

function posixPath(value) {
  return value.split(sep).join("/");
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return existsSync(path) ? sha256Bytes(readFileSync(path)) : null;
}

export function currentGitHead(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

export function createEvidenceProvenance({
  root,
  verifierPath,
  inputPaths,
  generatedAt = new Date().toISOString(),
  ttlMs = DEFAULT_EVIDENCE_TTL_MS,
  executionId = randomUUID(),
  command = process.argv.join(" "),
  gitHead = currentGitHead(root),
}) {
  const verifierFullPath = resolve(root, verifierPath);
  const uniqueInputs = [
    ...new Set([...inputPaths].map((path) => posixPath(relative(root, resolve(root, path))))),
  ].sort();
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Evidence provenance requires a valid generatedAt and positive integer ttlMs.");
  }
  return {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    gitHead,
    verifier: {
      path: posixPath(relative(root, verifierFullPath)),
      sha256: sha256File(verifierFullPath),
    },
    inputs: uniqueInputs.map((path) => ({ path, sha256: sha256File(resolve(root, path)) })),
    execution: { id: executionId, pid: process.pid, command },
    generatedAt,
    expiresAt: new Date(generatedAtMs + ttlMs).toISOString(),
    freshnessPolicy: { ttlMs, failClosed: true },
  };
}

export function validateEvidenceProvenance({ root, artifact, now = Date.now(), gitHead = currentGitHead(root) }) {
  const provenance = artifact?.provenance;
  const errors = [];
  if (provenance?.schema !== EVIDENCE_PROVENANCE_SCHEMA) errors.push("missing-or-unsupported-schema");
  if (provenance?.gitHead !== gitHead) errors.push("git-head-mismatch");
  const generatedAtMs = Date.parse(provenance?.generatedAt ?? "");
  const expiresAtMs = Date.parse(provenance?.expiresAt ?? "");
  if (!Number.isFinite(generatedAtMs) || generatedAtMs > now + 5_000) errors.push("invalid-generated-at");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) errors.push("expired");
  if (provenance?.freshnessPolicy?.failClosed !== true) errors.push("freshness-not-fail-closed");
  const verifierPath = provenance?.verifier?.path;
  if (!verifierPath || provenance?.verifier?.sha256 !== sha256File(resolve(root, verifierPath ?? ""))) {
    errors.push("verifier-digest-mismatch");
  }
  if (!Array.isArray(provenance?.inputs)) {
    errors.push("missing-input-hashes");
  } else {
    for (const input of provenance.inputs) {
      if (!input?.path || input.sha256 !== sha256File(resolve(root, input?.path ?? ""))) {
        errors.push(`input-hash-mismatch:${input?.path ?? "unknown"}`);
      }
    }
  }
  if (!provenance?.execution?.id || !provenance?.execution?.command) errors.push("missing-execution-identity");
  return { ok: errors.length === 0, errors };
}

export function validateEvidenceDependencyGraph(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const ids = new Set(nodes.map((node) => node.id));
  const errors = [];
  if (ids.size !== nodes.length) errors.push("duplicate-node-id");
  const adjacency = new Map(nodes.map((node) => [node.id, node.dependsOn ?? []]));
  for (const node of nodes) {
    if (!["direct", "aggregate", "derived"].includes(node.kind)) errors.push(`invalid-kind:${node.id}`);
    for (const dependency of node.dependsOn ?? []) {
      if (!ids.has(dependency)) errors.push(`unknown-dependency:${node.id}:${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`cycle:${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of adjacency.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return { ok: errors.length === 0, errors };
}

export function deduplicateRootCauses(blockers) {
  const byRootCause = new Map();
  for (const item of blockers) {
    const normalized = String(item?.blocker ?? item ?? "")
      .trim()
      .toLowerCase()
      .replaceAll(/\s+/g, " ");
    const rootCauseId = sha256Bytes(normalized).slice(0, 16);
    const area = item?.area ?? "unknown";
    const existing = byRootCause.get(rootCauseId);
    if (existing) {
      if (!existing.areas.includes(area)) existing.areas.push(area);
    } else {
      byRootCause.set(rootCauseId, { rootCauseId, area, areas: [area], blocker: item?.blocker ?? String(item) });
    }
  }
  return [...byRootCause.values()];
}
