import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "ipc-ledger.json");
const WU_RT_1_PENDING_RE =
  /^(session_checkpoint|session_resume|session_handoff|session_reset_context|session_summarize)$/;

function read(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function walk(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "target" || entry === "dist" || entry === ".git") continue;
      walk(fullPath, predicate, acc);
      continue;
    }
    if (stats.isFile() && predicate(fullPath)) acc.push(fullPath);
  }
  return acc;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativePath(fullPath) {
  return relative(ROOT, fullPath).replace(/\\/g, "/");
}

function parseHandlers() {
  const lib = read("src-tauri/src/lib.rs");
  const match = lib.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
  if (!match) {
    throw new Error("Could not find tauri::generate_handler![...] in src-tauri/src/lib.rs");
  }
  const body = match[1].replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/\bipc::([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((entry) => entry[1]);
}

function readFiles(paths) {
  return paths.map((fullPath) => ({
    path: relativePath(fullPath),
    content: readFileSync(fullPath, "utf8"),
  }));
}

const frontendFiles = readFiles(
  walk(join(ROOT, "src"), (fullPath) => {
    const rel = relativePath(fullPath);
    if (rel.startsWith("src/__tests__/")) return false;
    return /\.(ts|tsx)$/.test(fullPath);
  }),
);
const apiFiles = readFiles(walk(join(ROOT, "src-tauri", "src", "api"), (fullPath) => /\.rs$/.test(fullPath)));
const scriptFiles = readFiles(walk(join(ROOT, "scripts"), (fullPath) => /\.(mjs|cjs|js|ts|tsx|rs|md)$/.test(fullPath)));

function matchingPaths(files, regex) {
  return files.filter((file) => regex.test(file.content)).map((file) => file.path);
}

function classify(name, refs) {
  if (refs.frontend.length > 0) return "fe-wired";
  if (refs.api.length > 0) return "api-face";
  if (WU_RT_1_PENDING_RE.test(name)) return "wu-rt-1-pending";
  if (refs.scripts.length > 0) return "verifier";
  return "unreferenced";
}

const handlers = parseHandlers().map((name) => {
  const invokeRe = new RegExp(`\\b(?:invoke|tauriInvoke)(?:<[^>]+>)?\\(\\s*["']${escapeRegExp(name)}["']`, "g");
  const nameRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  const refs = {
    frontend: matchingPaths(frontendFiles, invokeRe),
    api: matchingPaths(apiFiles, nameRe),
    scripts: matchingPaths(scriptFiles, nameRe),
  };
  return {
    name,
    classification: classify(name, refs),
    refs,
  };
});

const counts = handlers.reduce((acc, handler) => {
  acc[handler.classification] = (acc[handler.classification] ?? 0) + 1;
  return acc;
}, {});

const artifact = {
  generatedAt: new Date().toISOString(),
  source: "scripts/generate-ipc-ledger.mjs",
  handlerCount: handlers.length,
  counts,
  handlers,
  unreferenced: handlers.filter((handler) => handler.classification === "unreferenced").map((handler) => handler.name),
};

mkdirSync(join(ROOT, ".codex-auto", "quality"), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

const orderedClasses = ["fe-wired", "api-face", "verifier", "wu-rt-1-pending", "unreferenced"];
console.log("| classification | count |");
console.log("| --- | ---: |");
for (const classification of orderedClasses) {
  console.log(`| ${classification} | ${counts[classification] ?? 0} |`);
}
console.log("");
console.log(`Artifact: ${relativePath(OUT)}`);
if (artifact.unreferenced.length > 0) {
  console.log("");
  console.log("Unreferenced proposals:");
  for (const name of artifact.unreferenced) console.log(`- ${name}`);
}
