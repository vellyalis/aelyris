import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Inline image (Kitty / Sixel) round-trip via Tauri CDP — Tier 🟡 #5 Sprint 3
 * polish coverage. The companion of `pty-flows.spec.ts`; CDP attach,
 * skip-when-unreachable, and per-test terminal lifecycle all follow the
 * exact same shape.
 *
 * What this suite proves end-to-end (when the prerequisite is satisfied):
 *
 * 1. The `term_image_data` IPC is wired and returns `null` for an unknown
 *    image id. Smoke-level only; never depends on PTY behaviour.
 * 2. A Kitty PNG escape echoed through the real PTY → ConPTY → engine →
 *    `GridSnapshot.images` → `term_image_data` round-trip surfaces a paint-
 *    ready PNG payload to the frontend. Asserts the PNG signature on the
 *    way back.
 *
 * Run prerequisite (same as `pty-flows.spec.ts`):
 *
 *   pnpm tauri:dev   # opens a webview with --remote-debugging-port=9222
 *
 * If port 9222 is not reachable every test in the suite is `test.skip`-ed,
 * matching the no-op behaviour of `pty-flows.spec.ts`. The skip reason is
 * surfaced in the report so a missing Tauri build never turns into a red
 * bar in CI / local dev.
 *
 * Known caveat — Windows ConPTY:
 *
 *   The Kitty graphics protocol uses `\x1b_G…\x1b\\` (APC). Some Win11
 *   ConPTY builds without `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) silently
 *   drop unknown APC sequences before they ever reach the engine. If the
 *   image round-trip test below fails with "snapshot never reported any
 *   images", the most likely cause is the host's ConPTY rather than our
 *   scanner — confirm by reproducing the same `chafa -f kitty …` command
 *   manually inside the running window. We deliberately surface that as
 *   a real test failure rather than a silent skip: the polish-pass goal
 *   is to put a tripwire under the live pipeline so dogfood regressions
 *   show up in the report, not just on screen.
 */

const CDP_URL = "http://localhost:9222";
const VITE_HOST = "localhost:1420";
/** Per-test timeout for "wait for snapshot to converge". Generous because
 *  the shell prompt + escape echo can take ~1 s on Windows under load. */
const SNAPSHOT_TIMEOUT_MS = 8_000;

/** Smallest valid PNG: a 1x1 transparent pixel. Used as the Kitty payload
 *  so the on-wire base64 stays small and copy-pasted into the spec without
 *  needing a fixture file. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

/** Image id baked into the Kitty header. Picked above the auto-assigned
 *  range so a parallel test run can't collide on it. */
const KITTY_IMAGE_ID = 9991;

interface ImageRef {
  id: number;
  cellRow: number;
  cellCol: number;
  widthPx: number;
  heightPx: number;
  cellW?: number;
  cellH?: number;
}

interface GridSnapshot {
  cols: number;
  rows: number;
  cells: unknown[][];
  cursor: { row: number; col: number };
  images?: ImageRef[];
}

interface ImageDataResponse {
  format: "png" | "rgba8";
  dataBase64: string;
  widthPx: number;
  heightPx: number;
}

let browser: Browser | null = null;
let page: Page | null = null;
let cdpAvailable = false;
let cdpFailureReason = "";

test.describe("Inline image round-trip via Tauri CDP", () => {
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
      // Disconnect, don't tear down — the user owns the Tauri window. We
      // are merely attaching as a tool. Mirrors `pty-flows.spec.ts`.
      await browser.close().catch(() => {});
    }
  });

  test.beforeEach(() => {
    test.skip(!cdpAvailable, `Tauri CDP not reachable: ${cdpFailureReason || "unknown"}`);
  });

  // ---- helpers ------------------------------------------------------------

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
      cwd: "C:\\Users\\owner\\Aether_Terminal",
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

  /** Poll a predicate against fresh snapshots until it succeeds or the
   *  timeout elapses. Mirrors the helper in `pty-flows.spec.ts` but
   *  specialised on `images` so the failure message is actionable. */
  const waitForImages = async (
    id: string,
    timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
  ): Promise<GridSnapshot> => {
    const deadline = Date.now() + timeoutMs;
    let last: GridSnapshot | null = null;
    while (Date.now() < deadline) {
      last = await snapshotGrid(id);
      if (last && Array.isArray(last.images) && last.images.length > 0) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    const seenImages = last?.images?.length ?? "<absent>";
    throw new Error(
      `waitForImages timed out after ${timeoutMs} ms — ` +
        `last snapshot images=${seenImages} rows=${last?.rows ?? "<null>"}. ` +
        `Most likely cause: ConPTY dropped the Kitty APC escape before it reached the engine.`,
    );
  };

  /**
   * PowerShell one-liner that emits a Kitty graphics escape directly to its
   * stdout. `[Console]::Out.Write` bypasses the line-buffered pipeline that
   * `Write-Host` uses, so the bytes hit the PTY as a single chunk and the
   * `\x1b\\` (ST) terminator is preserved end-to-end. PowerShell expands
   * `` `e `` into ESC (0x1B) inside the double-quoted literal — the engine
   * sees byte-perfect `ESC _ G … ESC \\`.
   */
  const kittyEscapeCommand = (imageId: number, b64: string): string => {
    return `[Console]::Out.Write("\`e_Gf=100,a=T,t=d,i=${imageId};${b64}\`e\\")\r`;
  };

  // ---- tests --------------------------------------------------------------

  test("term_image_data returns null for an unknown image id", async () => {
    const tid = await spawnTerminal();
    try {
      // No escape was sent, so any imageId is unknown. The IPC must
      // resolve cleanly to `null` rather than throw — the frontend cache
      // (`useTerminalImages`) treats `null` as "drop silently".
      const data = await call<ImageDataResponse | null>("term_image_data", {
        id: tid,
        imageId: 999_999,
      });
      expect(data).toBeNull();
    } finally {
      await closeTerminal(tid);
    }
  });

  test("Kitty PNG escape surfaces an ImageRef and round-trips bytes back", async () => {
    const tid = await spawnTerminal();
    try {
      // Let the prompt settle so the escape lands cleanly inside the
      // visible grid rather than racing the shell's prompt write.
      await new Promise((r) => setTimeout(r, 600));

      await call<void>("write_terminal", {
        id: tid,
        data: kittyEscapeCommand(KITTY_IMAGE_ID, TINY_PNG_B64),
      });

      const snap = await waitForImages(tid);
      expect(snap.images).toBeDefined();
      expect(snap.images!.length).toBeGreaterThan(0);

      const ref = snap.images![0]!;
      expect(ref.id).toBeGreaterThan(0);
      expect(ref.widthPx).toBeGreaterThan(0);
      expect(ref.heightPx).toBeGreaterThan(0);
      // Anchor must be inside the visible grid — `collect_visible_images`
      // drops anything outside (rows..) before the snapshot is built.
      expect(ref.cellRow).toBeGreaterThanOrEqual(0);
      expect(ref.cellRow).toBeLessThan(snap.rows);

      const data = await call<ImageDataResponse | null>("term_image_data", {
        id: tid,
        imageId: ref.id,
      });
      expect(data).not.toBeNull();
      expect(data!.format).toBe("png");
      expect(data!.dataBase64.length).toBeGreaterThan(0);
      expect(data!.widthPx).toBeGreaterThan(0);
      expect(data!.heightPx).toBeGreaterThan(0);

      // Round-trip integrity: the bytes coming back must still be a PNG.
      // We don't byte-compare against TINY_PNG_B64 because the engine
      // re-emits whatever the decoder normalised — for PNG passthrough
      // that's the same bytes, but checking the `\x89PNG` signature is
      // a stable contract that survives any future re-encode.
      const decoded = Buffer.from(data!.dataBase64, "base64");
      expect(decoded.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } finally {
      await closeTerminal(tid);
    }
  });
});
