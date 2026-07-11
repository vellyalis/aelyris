import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-supervision-concurrency.json");
const gates = [
  ["command-supervision", "verify:a5:command-supervision", "a5-command-supervision.json", "scripts/verify-a5-command-supervision.mjs"],
  ["proofbook-cas", "verify:a5:proofbook-cas", "a5-proofbook-cas.json", "scripts/verify-a5-proofbook-cas.mjs"],
  ["pty-concurrency", "verify:a5:pty-concurrency", "a5-pty-concurrency.json", "scripts/verify-a5-pty-concurrency.mjs"],
  ["taskgraph-concurrency", "verify:a5:taskgraph-concurrency", "a5-taskgraph-concurrency.json", "scripts/verify-a5-taskgraph-concurrency.mjs"],
  ["lsp-lifecycle", "verify:a5:lsp-lifecycle", "a5-lsp-lifecycle.json", "scripts/verify-a5-lsp-lifecycle.mjs"],
  ["watchdog-lifecycle", "verify:a5:watchdog-lifecycle", "a5-watchdog-lifecycle.json", "scripts/verify-a5-watchdog-lifecycle.mjs"],
];
const results = [];
let failed = false;
for (const [id, script, artifactName, verifierPath] of gates) {
  const startedAt = Date.now();
  try {
    execFileSync(process.execPath, [verifierPath], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 300_000, env: { ...process.env, NO_COLOR: "1" } });
    const child = JSON.parse(readFileSync(join(root, ".codex-auto", "quality", artifactName), "utf8"));
    const valid = child.sliceComplete === true && child.phaseComplete === false && String(child.status).startsWith("pass-");
    results.push({ id, status: valid ? "pass" : "fail", command: `pnpm ${script}`, artifact: `.codex-auto/quality/${artifactName}`, childStatus: child.status, durationMs: Date.now() - startedAt });
    failed ||= !valid;
  } catch (error) {
    failed = true;
    results.push({ id, status: "fail", command: `pnpm ${script}`, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
  }
}
const generatedAt = new Date().toISOString();
const report = { schema: "aelyris.a5-supervision-concurrency/v1", status: failed ? "failed" : "pass-a5-supervision-concurrency", sliceComplete: !failed, phaseComplete: !failed, scenarios: results, generatedAt, provenance: createEvidenceProvenance({ root, verifierPath: "scripts/verify-a5-supervision-concurrency.mjs", inputPaths: ["scripts/evidence-provenance.mjs", ...gates.map(([, , , path]) => path), "package.json"], generatedAt }) };
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
