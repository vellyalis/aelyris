import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const read = (path) => readFileSync(join(root, path), "utf8");
const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
const banner = read("src/features/app/UpdateBanner.tsx");
const bannerTest = read("src/__tests__/UpdateBanner.test.tsx");
const packageJson = JSON.parse(read("package.json"));

const checks = {
  updaterCheckCapability: capability.permissions?.includes("updater:allow-check") === true,
  updaterInstallCapability: capability.permissions?.includes("updater:allow-download-and-install") === true,
  checkFailureIsNotCollapsedToNoUpdate:
    !/catch\s*\{\s*return\s*\{\s*available:\s*false\s*\}/s.test(banner) &&
    banner.includes('state.phase === "error"') &&
    banner.includes('role="alert"'),
  retryIsExposed: banner.includes("void performCheck()") && banner.includes("Retry"),
  errorContractTested:
    bannerTest.includes("surfaces check errors and permits a retry") && bannerTest.includes("network unreachable"),
  releaseEnforcementCommand:
    packageJson.scripts?.["verify:quality-score:enforce"] === "node scripts/score-release-quality.mjs --enforce",
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failures.length > 0) throw new Error(`A2 Windows trust contract failed: ${failures.join(", ")}`);

const generatedAt = new Date().toISOString();
const output = join(root, ".codex-auto", "quality", "a2-windows-trust-contract.json");
const report = {
  schema: "aelyris.a2-windows-trust-contract/v1",
  status: "pass-repo-owned-updater-wiring",
  releaseLifecycleReady: false,
  releaseLifecycleBlocker:
    "Real Authenticode, reachable signed metadata, and install/relaunch/rollback evidence remain operator-owned.",
  checks,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a2-windows-trust-contract.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/capabilities/default.json",
      "src/features/app/UpdateBanner.tsx",
      "src/__tests__/UpdateBanner.test.tsx",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: output, ...report }, null, 2));
