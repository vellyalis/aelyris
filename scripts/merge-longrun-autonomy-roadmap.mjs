import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function parseArgs(argv) {
  const out = {
    workspace: process.cwd(),
    extension: null,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--extension") out.extension = argv[++i];
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Usage: node scripts/merge-longrun-autonomy-roadmap.mjs [options]

Options:
  --workspace <dir>   Workspace containing .codex-auto. Defaults to cwd.
  --extension <file>  Roadmap extension JSON. Defaults to the 2026-05-05 autonomy extension.
  --dry-run           Print the planned merge without writing.
  --force             Merge even when a codex exec child is currently running.
  --help              Show this help.
`);
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path, value) {
  const tmp = join(dirname(path), `.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function isRunningChild(child) {
  if (!child || typeof child !== "object") return false;
  const status = String(child.status ?? "").toLowerCase();
  if (["done", "failed", "timeout", "complete", "completed"].includes(status)) return false;
  return Boolean(child.codexExecPid ?? child.pid ?? child.processId) || status === "running";
}

function normalizeLane(card) {
  const status = String(card?.status ?? "").toLowerCase();
  if (status === "done") return "done";
  if (status === "doing") return "doing";
  if (status === "blocked") return "blocked";
  return "next";
}

function reflowStarts(roadmap) {
  let cursor = 0;
  return roadmap.map((card) => {
    const duration = Number.isFinite(Number(card.duration)) ? Number(card.duration) : 10;
    const next = { ...card, start: cursor, duration };
    cursor += duration;
    return next;
  });
}

function mergeRoadmap(roadmap, extension) {
  const existingIds = new Set(roadmap.map((card) => card.id).filter(Boolean));
  const cards = Array.isArray(extension?.cards) ? extension.cards : [];
  const toInsert = cards
    .filter((card) => card?.id && !existingIds.has(card.id))
    .map((card) => ({
      ...card,
      lane: normalizeLane(card),
      status: card.status ?? normalizeLane(card),
      evidence: card.evidence ?? "",
      confidence: card.confidence ?? "not-started",
      qualityGate: card.qualityGate ?? "needs-evidence",
      qualityGateMissing: Array.isArray(card.qualityGateMissing) ? card.qualityGateMissing : ["evidence"],
      qualityGateCheckedAt: card.qualityGateCheckedAt ?? new Date().toISOString(),
    }));

  const insertAfter = extension?.mergePolicy?.insertAfter ?? "P0-15";
  const index = roadmap.findIndex((card) => card.id === insertAfter);
  const insertAt = index >= 0 ? index + 1 : roadmap.length;
  const merged = [...roadmap.slice(0, insertAt), ...toInsert, ...roadmap.slice(insertAt)];
  return { merged: reflowStarts(merged), inserted: toInsert };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const workspace = resolve(options.workspace);
  const logDir = join(workspace, ".codex-auto");
  const roadmapPath = join(logDir, "project-roadmap.json");
  const extensionPath = resolve(
    options.extension ?? join(logDir, "roadmap-extension-longrun-autonomy-2026-05-05.json"),
  );
  const childPath = join(logDir, "current-child.json");

  const child = readJson(childPath, null);
  if (!options.force && isRunningChild(child)) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "codex-exec-running",
          detail: "Refusing to merge while a codex exec child appears active. Re-run after the current turn finishes or pass --force.",
          childStatus: child?.status ?? null,
          codexExecPid: child?.codexExecPid ?? child?.pid ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const parsedRoadmap = readJson(roadmapPath, null);
  if (!parsedRoadmap) throw new Error(`Roadmap not found: ${roadmapPath}`);
  const roadmap = Array.isArray(parsedRoadmap) ? parsedRoadmap : parsedRoadmap.roadmap;
  if (!Array.isArray(roadmap)) throw new Error(`Roadmap file has no roadmap array: ${roadmapPath}`);
  const extension = readJson(extensionPath, null);
  if (!extension) throw new Error(`Extension not found: ${extensionPath}`);

  const { merged, inserted } = mergeRoadmap(roadmap, extension);
  const next = Array.isArray(parsedRoadmap)
    ? merged
    : {
        ...parsedRoadmap,
        version: Math.max(Number(parsedRoadmap.version ?? 1), 4),
        updatedAt: new Date().toISOString(),
        roadmap: merged,
        roadmapExtensions: [
          ...(Array.isArray(parsedRoadmap.roadmapExtensions) ? parsedRoadmap.roadmapExtensions : []),
          {
            id: extension.target ?? "longrun-full-autonomy-spp",
            path: extensionPath,
            mergedAt: new Date().toISOString(),
            insertedCardIds: inserted.map((card) => card.id),
          },
        ],
      };

  const result = {
    ok: true,
    dryRun: options.dryRun,
    workspace,
    roadmapPath,
    extensionPath,
    inserted: inserted.map((card) => card.id),
    totalBefore: roadmap.length,
    totalAfter: merged.length,
  };

  if (!options.dryRun && inserted.length > 0) writeJsonAtomic(roadmapPath, next);
  console.log(JSON.stringify(result, null, 2));
}

main();
