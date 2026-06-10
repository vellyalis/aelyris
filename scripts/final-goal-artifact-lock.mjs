import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";

const ROOT = resolve(process.cwd());
const LOCK_DIR = join(ROOT, ".codex-auto", "quality", "final-goal-evidence.lock");
const OWNER_PATH = join(LOCK_DIR, "owner.json");
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.AETHER_FINAL_GOAL_LOCK_TIMEOUT_MS ?? "120000", 10);
const DEFAULT_STALE_MS = Number.parseInt(process.env.AETHER_FINAL_GOAL_LOCK_STALE_MS ?? "600000", 10);
const DEFAULT_POLL_MS = Number.parseInt(process.env.AETHER_FINAL_GOAL_LOCK_POLL_MS ?? "250", 10);

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function readOwner() {
  if (!existsSync(OWNER_PATH)) return null;
  try {
    return JSON.parse(readFileSync(OWNER_PATH, "utf8"));
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function lockAgeMs(owner) {
  const started = Date.parse(owner?.startedAt ?? "");
  return Number.isFinite(started) ? Date.now() - started : Number.POSITIVE_INFINITY;
}

export function acquireFinalGoalArtifactLock(name, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const startedAt = Date.now();
  const token = randomUUID();
  const owner = {
    token,
    name,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: ROOT,
    argv: process.argv.slice(1),
  };

  mkdirSync(dirname(LOCK_DIR), { recursive: true });

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(OWNER_PATH, `${JSON.stringify(owner, null, 2)}\n`);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const currentOwner = readOwner();
        if (currentOwner?.token === token) {
          rmSync(LOCK_DIR, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const currentOwner = readOwner();
      if (lockAgeMs(currentOwner) > staleMs) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      sleepSync(pollMs);
    }
  }

  const currentOwner = readOwner();
  throw new Error(
    `Timed out waiting for final-goal artifact lock after ${timeoutMs}ms; current owner: ${JSON.stringify(
      currentOwner,
    )}`,
  );
}
