import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";
import {
  authenticodeEvidenceReady,
  nativeCoverageReportIsHonest,
  shouldFailReleaseEnforcement,
  updaterEvidenceReady,
} from "./release-evidence-truth.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "release-evidence-truth.json");
const validSignature = { valid: true, timestamped: true };
const mutations = [
  ["unsigned-binary", authenticodeEvidenceReady([validSignature, { valid: false, timestamped: false }])],
  ["missing-timestamp", authenticodeEvidenceReady([validSignature, { valid: true, timestamped: false }])],
  [
    "unreachable-metadata",
    updaterEvidenceReady({
      manifestIntegrity: [true],
      capabilityWired: true,
      endpointReachable: false,
      lifecycleReady: true,
    }),
  ],
  [
    "lifecycle-failure",
    updaterEvidenceReady({
      manifestIntegrity: [true],
      capabilityWired: true,
      endpointReachable: true,
      lifecycleReady: false,
    }),
  ],
  [
    "misleading-native-ready-label",
    nativeCoverageReportIsHonest({
      schema: "aelyris.native-coverage-gap/v2",
      measuredCoveragePercent: 98,
      measuredCoverageComplete: false,
      shippingShellReady: false,
      fullNativeReady: true,
    }),
  ],
];
for (const [name, accepted] of mutations) {
  if (accepted) throw new Error(`${name} mutation was accepted`);
}
if (!shouldFailReleaseEnforcement({ releaseCandidateReady: false, grade: "D" })) {
  throw new Error("enforce mode accepted a blocked grade-D report");
}
const generatedAt = new Date().toISOString();
const report = {
  version: 1,
  ok: true,
  status: "pass-release-evidence-truth",
  generatedAt,
  mutationCount: mutations.length + 1,
  provenance: createEvidenceProvenance({
    root: ROOT,
    verifierPath: "scripts/verify-release-evidence-truth.mjs",
    inputPaths: ["scripts/evidence-provenance.mjs", "scripts/release-evidence-truth.mjs"],
    generatedAt,
  }),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
