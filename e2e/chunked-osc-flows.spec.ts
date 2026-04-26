import { type Browser, chromium, expect, type Page, test } from "@playwright/test";
import { resolve as resolvePath } from "node:path";

/**
 * Chunked OSC 1338 inline-image protocol — Sprint 3 E2E coverage.
 *
 * Sprint 1 (a627cb7) shipped the engine assembler; Sprint 2 (112bd23)
 * shipped the emitter wrappers. This suite locks in correctness with
 * scenarios that stress the protocol's surface area:
 *
 * 1. Multi-chunk PNG round-trip — drives the 32×32 fixture (~8 chunks)
 *    through the bash emitter so we exercise the chunk-boundary code
 *    path that the single-chunk image-flows spec does not.
 * 2. Two sequential transfers with distinct image-ids — proves the
 *    assembler keys on image-id and surfaces both as independent
 *    `ImageRef` entries in the same snapshot.
 * 3. Malformed-then-valid — a hand-rolled malformed OSC 1338 frame
 *    drops silently, and a valid emitter run that follows still
 *    surfaces an image. Proves a malformed frame does not poison the
 *    assembler or leak text into the grid.
 *
 * Run prerequisite: `pnpm tauri:dev` is up and port 9222 is reachable.
 * If unreachable every test in the suite is `test.skip`-ed, mirroring
 * `pty-flows.spec.ts` and `image-flows.spec.ts`.
 */

const CDP_URL = "http://localhost:9222";
const VITE_HOST = "localhost:1420";
const SNAPSHOT_TIMEOUT_MS = 10_000;

const FIXTURE_TINY = "e2e/fixtures/inline-image-1x1.png";
const FIXTURE_LARGE = "e2e/fixtures/inline-image-32x32.png";
const EMITTER_PS1 = "scripts/aether-imgcat.ps1";

const REPO_ROOT = resolvePath(__dirname, "..");

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
  cells: { ch?: string }[][];
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

test.describe("Chunked OSC 1338 inline-image flows", () => {
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
    if (browser) await browser.close().catch(() => {});
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

  const spawnPowershell = async (): Promise<string> =>
    call<string>("spawn_terminal", {
      shell: "powershell",
      cols: 120,
      rows: 30,
      cwd: REPO_ROOT,
    });

  const closeTerminal = async (id: string) => {
    try {
      await call<void>("close_terminal", { id });
    } catch {
      /* best-effort cleanup */
    }
  };

  const snapshotGrid = async (id: string): Promise<GridSnapshot | null> =>
    call<GridSnapshot | null>("term_snapshot", { id });

  /** Poll until `predicate(snapshot)` is true or the timeout elapses. */
  const waitForSnapshot = async (
    id: string,
    predicate: (s: GridSnapshot) => boolean,
    timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
  ): Promise<GridSnapshot> => {
    const deadline = Date.now() + timeoutMs;
    let last: GridSnapshot | null = null;
    while (Date.now() < deadline) {
      last = await snapshotGrid(id);
      if (last && predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `waitForSnapshot timed out after ${timeoutMs} ms — last images=${last?.images?.length ?? "<absent>"}`,
    );
  };

  /** PowerShell command to drive aether-imgcat.ps1 against a fixture. */
  const emitImage = (fixture: string, imageId?: number): string => {
    const fixturePath = resolvePath(REPO_ROOT, fixture);
    const emitterPath = resolvePath(REPO_ROOT, EMITTER_PS1);
    const idArg = imageId !== undefined ? ` ${imageId}` : "";
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${emitterPath}" "${fixturePath}"${idArg}\r`;
  };

  /** Assert a `term_image_data` blob is a PNG by signature. */
  const assertPngBlob = (data: ImageDataResponse | null) => {
    expect(data).not.toBeNull();
    expect(data!.format).toBe("png");
    const decoded = Buffer.from(data!.dataBase64, "base64");
    expect(decoded.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  };

  // ---- tests --------------------------------------------------------------

  test("multi-chunk 32x32 PNG surfaces a single ImageRef + round-trips PNG bytes", async () => {
    const tid = await spawnPowershell();
    try {
      await new Promise((r) => setTimeout(r, 800));
      await call<void>("write_terminal", { id: tid, data: emitImage(FIXTURE_LARGE) });

      const snap = await waitForSnapshot(tid, (s) => (s.images?.length ?? 0) >= 1);
      expect(snap.images!.length).toBe(1);

      const ref = snap.images![0]!;
      expect(ref.widthPx).toBe(32);
      expect(ref.heightPx).toBe(32);

      const data = await call<ImageDataResponse | null>("term_image_data", {
        id: tid,
        imageId: ref.id,
      });
      assertPngBlob(data);
      expect(data!.widthPx).toBe(32);
      expect(data!.heightPx).toBe(32);
    } finally {
      await closeTerminal(tid);
    }
  });

  test("two sequential transfers surface as two independent ImageRefs", async () => {
    const tid = await spawnPowershell();
    try {
      await new Promise((r) => setTimeout(r, 800));
      // Two emitter runs back-to-back, each picking its own image-id.
      // The assembler keys on emitter image-id, but the engine's internal
      // ImageStore allocates fresh monotonic ids — so we count entries
      // rather than match the emitter ids.
      await call<void>("write_terminal", { id: tid, data: emitImage(FIXTURE_TINY, 1001) });
      await call<void>("write_terminal", { id: tid, data: emitImage(FIXTURE_TINY, 1002) });

      const snap = await waitForSnapshot(tid, (s) => (s.images?.length ?? 0) >= 2);
      expect(snap.images!.length).toBeGreaterThanOrEqual(2);
      // Both ImageRefs must round-trip PNG bytes.
      for (const ref of snap.images!.slice(0, 2)) {
        const data = await call<ImageDataResponse | null>("term_image_data", {
          id: tid,
          imageId: ref.id,
        });
        assertPngBlob(data);
      }
    } finally {
      await closeTerminal(tid);
    }
  });

  test("malformed OSC 1338 frame is dropped without poisoning the assembler", async () => {
    const tid = await spawnPowershell();
    try {
      await new Promise((r) => setTimeout(r, 800));
      // Step 1: emit a malformed OSC 1338 frame (verb 'X' is unknown).
      // The parser must consume it off the wire (no garbage on grid)
      // and the engine must not register an image entry for it.
      await call<void>("write_terminal", {
        id: tid,
        // [Console]::Out.Write keeps the BEL terminator intact; [char]27
        // is portable across PowerShell 5 + 7.
        data: `[Console]::Out.Write([char]27 + "]1338;X;weird" + [char]7)\r`,
      });
      await new Promise((r) => setTimeout(r, 400));
      const beforeSnap = await snapshotGrid(tid);
      const beforeCount = beforeSnap?.images?.length ?? 0;

      // Step 2: emit a valid PNG. The assembler must still accept it.
      await call<void>("write_terminal", { id: tid, data: emitImage(FIXTURE_TINY) });

      const snap = await waitForSnapshot(
        tid,
        (s) => (s.images?.length ?? 0) > beforeCount,
      );
      const newImages = snap.images!.slice(beforeCount);
      expect(newImages.length).toBeGreaterThanOrEqual(1);
      const data = await call<ImageDataResponse | null>("term_image_data", {
        id: tid,
        imageId: newImages[0]!.id,
      });
      assertPngBlob(data);

      // Sanity: the malformed frame's bytes must NOT have leaked into
      // the grid. A grep for the literal `1338;X` would catch a
      // regression where the OSC parser stopped consuming malformed
      // frames (and they passed through to alacritty).
      const gridText = snap.cells
        .map((row) => row.map((c) => c?.ch ?? " ").join(""))
        .join("\n");
      expect(gridText).not.toContain("1338;X");
    } finally {
      await closeTerminal(tid);
    }
  });
});
