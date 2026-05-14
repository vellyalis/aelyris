import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.env.AETHER_PRODUCTION_ROOT ?? process.cwd());
const EVIDENCE = join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-resume.json");
const args = new Set(process.argv.slice(2));

function writeTemplate() {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  if (existsSync(EVIDENCE) && !args.has("--force")) {
    console.log(`[real-os-suspend] template already exists: ${EVIDENCE}`);
    return;
  }
  const template = {
    version: 1,
    status: "pending",
    capturedAt: new Date().toISOString(),
    operator: "",
    host: {
      os: "Windows",
      machine: "",
      powerMode: "",
    },
    app: {
      executable: "C:\\Users\\owner\\Aether_Terminal\\src-tauri\\target\\release\\Aether.exe",
      version: "0.2.3",
    },
    suspend: {
      suspendedAt: "",
      resumedAt: "",
      approximateDurationSeconds: 0,
      method: "Start menu sleep / lid close / power button",
    },
    checks: {
      appResponsive: false,
      terminalResponsive: false,
      sqliteWritable: false,
      paneStatePreserved: false,
    },
    notes: "",
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`[real-os-suspend] wrote template: ${EVIDENCE}`);
}

function fail(message, detail) {
  console.error(`[real-os-suspend] ${message}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

function main() {
  if (args.has("--write-template")) {
    writeTemplate();
    return;
  }
  if (!existsSync(EVIDENCE)) {
    fail("missing manual evidence", EVIDENCE);
  }
  const evidence = JSON.parse(readFileSync(EVIDENCE, "utf8"));
  const requiredChecks = ["appResponsive", "terminalResponsive", "sqliteWritable", "paneStatePreserved"];
  const missing = requiredChecks.filter((key) => evidence?.checks?.[key] !== true);
  if (evidence.status !== "pass") fail("status must be pass", String(evidence.status));
  if (missing.length > 0) fail("required checks are not all true", missing.join(", "));
  if (!evidence.suspend?.suspendedAt || !evidence.suspend?.resumedAt) {
    fail("suspend timestamps are required");
  }
  const duration = Number(evidence.suspend?.approximateDurationSeconds ?? 0);
  if (!Number.isFinite(duration) || duration < 10) {
    fail("suspend duration must be at least 10 seconds", String(evidence.suspend?.approximateDurationSeconds));
  }
  console.log(`[real-os-suspend] pass: ${EVIDENCE}`);
}

main();
