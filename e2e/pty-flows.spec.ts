import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * PTY-in-the-loop E2E coverage (Tier 🟡 #6).
 *
 * The default 13 specs run against the Vite dev server (`localhost:1420`)
 * with no Tauri backend, so any flow that touches a real PTY is invisible
 * to them. This suite plugs the gap by attaching to a running Tauri dev
 * build via CDP — see `reference_tauri_cdp_e2e.md` and
 * `scripts/verify-3c2.mjs` for the same pattern at IPC level.
 *
 * Run prerequisite:
 *
 *   pnpm tauri:dev   # opens a webview with --remote-debugging-port=9222
 *
 * If port 9222 is not reachable every test in the suite is `test.skip`-ed
 * — the suite stays as a no-op in CI / local dev so a missing Tauri build
 * never turns into a red bar. The skip reason is surfaced in the report.
 *
 * Each test owns a fresh terminal id created inside the test and closed in
 * the per-test cleanup so leaks don't fan out across the suite if a single
 * spec aborts.
 */

const CDP_URL = "http://localhost:9222";
const VITE_HOST = "localhost:1420";
/** Sentinel string we look for in the grid after `echo`. Picked to be
 *  highly unlikely to appear in shell prompt chrome. */
const ECHO_SENTINEL = "aether-pty-e2e-marker";
/** Per-test timeout for "wait for snapshot to converge". 5 s is generous
 *  on Windows where ConPTY round-trip can take ~250 ms. */
const SNAPSHOT_TIMEOUT_MS = 5_000;

interface CellSnapshot {
  ch: string;
  fg: number;
  bg: number;
  attrs: number;
  hyperlink?: string | null;
}

interface GridSnapshot {
  cols: number;
  rows: number;
  cells: CellSnapshot[][];
  cursor: { row: number; col: number };
}

interface LogEntry {
  seq: number;
  timestamp_ms: number;
  level: string;
  target: string;
  message: string;
  fields: Record<string, string>;
}

let browser: Browser | null = null;
let page: Page | null = null;
let cdpAvailable = false;
let cdpFailureReason = "";

test.describe("PTY round-trip via Tauri CDP", () => {
  test.beforeAll(async () => {
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      const ctx = browser.contexts()[0];
      const candidate = ctx?.pages().find((p) => p.url().includes(VITE_HOST));
      if (!candidate) {
        cdpFailureReason = `no Tauri page found at ${VITE_HOST}`;
        await browser.close().catch(() => {});
        browser = null;
        return;
      }
      // Sanity check: the Tauri internals shape we expect.
      const hasInternals = await candidate.evaluate(() => {
        const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
        return typeof w.__TAURI_INTERNALS__?.invoke === "function";
      });
      if (!hasInternals) {
        cdpFailureReason = "page found but __TAURI_INTERNALS__.invoke missing";
        await browser.close().catch(() => {});
        browser = null;
        return;
      }
      page = candidate;
      cdpAvailable = true;
    } catch (err) {
      cdpFailureReason = err instanceof Error ? err.message : String(err);
    }
  });

  test.afterAll(async () => {
    if (browser) {
      // Disconnect, don't close — the user owns the Tauri window. We are
      // merely attaching as a tool. `close()` on a CDP-connected browser
      // is a tear-down that the parent process recovers from, but
      // disconnect is cleaner.
      await browser.close().catch(() => {});
    }
  });

  test.beforeEach(() => {
    test.skip(!cdpAvailable, `Tauri CDP not reachable: ${cdpFailureReason || "unknown"}`);
  });

  // Helpers — declared inside the describe so the `page` closure binds
  // to the resolved value rather than the initial `null`.

  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    if (!page) throw new Error("page not bound");
    return page.evaluate(
      async ({ cmd, args }) => {
        const w = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        };
        return w.__TAURI_INTERNALS__.invoke(cmd, args);
      },
      { cmd, args },
    ) as Promise<T>;
  };

  const spawnTerminal = async (): Promise<string> => {
    return call<string>("spawn_terminal", {
      shell: "powershell",
      cols: 120,
      rows: 30,
      // Repo root is a known-good cwd that exists wherever the suite runs and
      // does not require a fresh tmp dir to function.
      cwd: process.cwd(),
    });
  };

  const closeTerminal = async (id: string) => {
    try {
      await call<void>("close_terminal", { id });
    } catch {
      /* best-effort cleanup */
    }
  };

  const snapshotGrid = async (id: string): Promise<GridSnapshot | null> =>
    call<GridSnapshot | null>("term_snapshot", { id });

  const gridContains = (snap: GridSnapshot | null, needle: string): boolean => {
    if (!snap) return false;
    for (const row of snap.cells) {
      let line = "";
      for (const cell of row) line += cell.ch ?? " ";
      if (line.includes(needle)) return true;
    }
    return false;
  };

  /** Poll a predicate against fresh snapshots until it succeeds or the
   *  timeout elapses. The frontend renderer normally drives the diff
   *  loop — without it, snapshots need to be pulled by us directly. */
  const waitForGrid = async (
    id: string,
    predicate: (snap: GridSnapshot) => boolean,
    timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
  ): Promise<GridSnapshot> => {
    const deadline = Date.now() + timeoutMs;
    let last: GridSnapshot | null = null;
    while (Date.now() < deadline) {
      last = await snapshotGrid(id);
      if (last && predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `waitForGrid timed out after ${timeoutMs} ms — last snapshot rows=${last?.rows ?? "<null>"}`,
    );
  };

  test("echo round-trip lands the sentinel in the visible grid", async () => {
    const id = await spawnTerminal();
    try {
      // Give the shell a moment to lay down its prompt so the echoed
      // command and the sentinel both end up on visible rows.
      await new Promise((r) => setTimeout(r, 600));
      await call<void>("write_terminal", { id, data: `echo ${ECHO_SENTINEL}\r` });
      const snap = await waitForGrid(id, (s) => gridContains(s, ECHO_SENTINEL));
      expect(snap.cols).toBeGreaterThan(0);
      expect(snap.rows).toBeGreaterThan(0);
    } finally {
      await closeTerminal(id);
    }
  });

  test("emitting more lines than rows grows the scrollback ring", async () => {
    const id = await spawnTerminal();
    try {
      await new Promise((r) => setTimeout(r, 600));
      // 80 lines >> 30-row visible window → at least 50 rows must spill
      // into history. We use 1..80 and look for the highest sentinel so
      // we know the loop completed before the assertion.
      await call<void>("write_terminal", {
        id,
        data: "1..80 | ForEach-Object { Write-Output \"scrollback-line-$_\" }\r",
      });
      await waitForGrid(id, (s) => gridContains(s, "scrollback-line-80"), 8_000);
      // Wait for at least one row to fall into history.
      const deadline = Date.now() + 5_000;
      let history = await call<number>("term_history_size", { id });
      while (history === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        history = await call<number>("term_history_size", { id });
      }
      expect(history).toBeGreaterThan(0);
      // Pull the most-recent history row and assert it is a real row,
      // not a default-blank line.
      const rows = await call<CellSnapshot[][]>("term_history_rows", {
        id,
        fromN: 0,
        count: 1,
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.length).toBeGreaterThan(0);
    } finally {
      await closeTerminal(id);
    }
  });

  test("structured log ring captures backend events emitted during the spec", async () => {
    // Pre-spec watermark: ignore everything that came before this test
    // started so we don't mistake an unrelated info entry for our event.
    const before = await call<LogEntry[]>("logs_recent", { limit: 1 });
    const watermark = before[0]?.seq ?? 0;

    // Force at least one info log: spawning + closing a terminal hits
    // log::info!("respawned terminal …") and similar paths in pty/term.
    const id = await spawnTerminal();
    await new Promise((r) => setTimeout(r, 250));
    await closeTerminal(id);

    const tail = await call<LogEntry[]>("logs_since", { afterSeq: watermark, limit: 1024 });
    expect(tail.length).toBeGreaterThan(0);
    // Levels are uppercase per the Rust serializer.
    for (const entry of tail) {
      expect(entry.level).toMatch(/^(TRACE|DEBUG|INFO|WARN|ERROR)$/);
    }
    // At least one entry should originate from the backend crate.
    const fromBackend = tail.some((e) => e.target.startsWith("aether_terminal_lib"));
    expect(fromBackend).toBe(true);
  });
});
