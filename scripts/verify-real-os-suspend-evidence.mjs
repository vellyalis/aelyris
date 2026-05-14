import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
    validation: {
      windowsPowerEvents: {
        suspendEventFound: false,
        resumeEventFound: false,
        matchedEvents: [],
      },
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

function queryWindowsPowerEvents(startIso, endIso) {
  if (process.platform !== "win32") {
    fail("Windows System event-log validation requires Windows", process.platform);
  }
  const ps = `
    $ErrorActionPreference = 'Stop'
    $start = ([datetime]::Parse($env:AETHER_SUSPEND_START)).AddMinutes(-5)
    $end = ([datetime]::Parse($env:AETHER_SUSPEND_END)).AddMinutes(5)
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1,42,107; StartTime = $start; EndTime = $end } -ErrorAction SilentlyContinue |
      Sort-Object TimeCreated |
      Select-Object TimeCreated, Id, ProviderName, Message
    $events | ConvertTo-Json -Depth 3 -Compress
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      AETHER_SUSPEND_START: startIso,
      AETHER_SUSPEND_END: endIso,
    },
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail("failed to query Windows power events", result.stderr?.trim() || result.stdout?.trim());
  }
  const raw = result.stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const events = Array.isArray(parsed) ? parsed : [parsed];
  return events.map((event) => ({
    timeCreated: event.TimeCreated,
    id: Number(event.Id),
    providerName: String(event.ProviderName ?? ""),
    message: String(event.Message ?? "").slice(0, 240),
  }));
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
  const events = queryWindowsPowerEvents(evidence.suspend.suspendedAt, evidence.suspend.resumedAt);
  const suspendEventFound = events.some((event) => event.id === 42);
  const resumeEventFound = events.some((event) => event.id === 1 || event.id === 107);
  if (!suspendEventFound || !resumeEventFound) {
    fail(
      "Windows power event evidence is incomplete",
      JSON.stringify({ suspendEventFound, resumeEventFound, eventIds: events.map((event) => event.id) }),
    );
  }
  evidence.validation = {
    ...(evidence.validation ?? {}),
    validatedAt: new Date().toISOString(),
    windowsPowerEvents: {
      suspendEventFound,
      resumeEventFound,
      matchedEvents: events,
    },
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[real-os-suspend] pass: ${EVIDENCE}`);
}

main();
