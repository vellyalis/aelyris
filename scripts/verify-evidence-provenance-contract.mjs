import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createEvidenceProvenance,
  deduplicateRootCauses,
  validateEvidenceDependencyGraph,
  validateEvidenceProvenance,
} from "./evidence-provenance.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "evidence-provenance-contract.json");
const root = mkdtempSync(join(tmpdir(), "aelyris-provenance-"));
try {
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "verifier.mjs"), "// verifier\n");
  writeFileSync(join(root, "input.json"), '{"ok":true}\n');
  const fixtureGeneratedAt = new Date().toISOString();
  const provenance = createEvidenceProvenance({
    root,
    verifierPath: "scripts/verifier.mjs",
    inputPaths: ["input.json"],
    generatedAt: fixtureGeneratedAt,
    ttlMs: 60_000,
    executionId: "mutation-fixture",
    command: "verify mutation fixture",
    gitHead: "a".repeat(40),
  });
  const artifact = { provenance };
  const pass = validateEvidenceProvenance({ root, artifact, gitHead: "a".repeat(40) });
  if (!pass.ok) throw new Error(`valid provenance rejected: ${pass.errors.join(", ")}`);

  const mutations = [
    ["stale", { ...provenance, expiresAt: new Date(Date.now() - 1_000).toISOString() }],
    ["wrong-head", { ...provenance, gitHead: "b".repeat(40) }],
    ["wrong-verifier", { ...provenance, verifier: { ...provenance.verifier, sha256: "0".repeat(64) } }],
    [
      "wrong-input",
      { ...provenance, inputs: provenance.inputs.map((input) => ({ ...input, sha256: "0".repeat(64) })) },
    ],
  ];
  for (const [name, mutated] of mutations) {
    if (validateEvidenceProvenance({ root, artifact: { provenance: mutated }, gitHead: "a".repeat(40) }).ok) {
      throw new Error(`${name} mutation was accepted`);
    }
  }
  const cycle = validateEvidenceDependencyGraph({
    nodes: [
      { id: "score", kind: "aggregate", dependsOn: ["audit"] },
      { id: "audit", kind: "derived", dependsOn: ["score"] },
    ],
  });
  if (cycle.ok || !cycle.errors.some((error) => error.startsWith("cycle:"))) {
    throw new Error("dependency cycle mutation was accepted");
  }
  const duplicate = validateEvidenceDependencyGraph({
    nodes: [
      { id: "root", kind: "direct", dependsOn: [] },
      { id: "root", kind: "aggregate", dependsOn: [] },
    ],
  });
  if (duplicate.ok || !duplicate.errors.includes("duplicate-node-id")) {
    throw new Error("duplicate root-cause mutation was accepted");
  }
  const roots = deduplicateRootCauses([
    { area: "direct-a", blocker: "Same direct defect" },
    { area: "direct-b", blocker: "  same   direct DEFECT " },
  ]);
  if (roots.length !== 1 || roots[0].areas.length !== 2) throw new Error("duplicate direct defects were counted twice");
  const generatedAt = new Date().toISOString();
  const report = {
    version: 1,
    ok: true,
    status: "pass-evidence-provenance-contract",
    generatedAt,
    mutationCount: mutations.length + 3,
    provenance: createEvidenceProvenance({
      root: ROOT,
      verifierPath: "scripts/verify-evidence-provenance-contract.mjs",
      inputPaths: ["scripts/evidence-provenance.mjs"],
      generatedAt,
    }),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
