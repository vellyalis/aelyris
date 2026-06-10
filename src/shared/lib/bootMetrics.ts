// Startup performance instrumentation.
//
// Pair with `performance.mark("app:boot")` at the top of main.tsx.
// Call `markFirstPaint()` after the first React commit.
// Additional feature-level marks (terminal mount, editor open, etc.) can be
// recorded via `markBoot(name)` and surfaced with `logBootMetrics()`.

const BOOT_MARK = "app:boot";
const FIRST_PAINT_MARK = "app:first-paint";

let firstPaintLogged = false;
const onceMarks = new Set<string>();

/** Record an arbitrary boot-phase marker. Safe to call multiple times. */
export function markBoot(name: string): void {
  try {
    performance.mark(name);
  } catch {
    /* performance API unavailable — ignore */
  }
}

/**
 * Record a marker only the first time this name is seen in the process.
 * Intended for "first X" events (first terminal mount, first editor open, …)
 * where later occurrences are not interesting for boot-time analysis.
 * Also emits a measure against `app:boot` and logs it in dev mode.
 */
export function markBootOnce(name: string): void {
  if (onceMarks.has(name)) return;
  onceMarks.add(name);
  try {
    performance.mark(name);
    performance.measure(`app:boot → ${name}`, BOOT_MARK, name);
    if (import.meta.env.DEV) {
      const entries = performance.getEntriesByName(`app:boot → ${name}`);
      const last = entries[entries.length - 1];
      if (last) {
        // eslint-disable-next-line no-console
        console.info(`[boot] ${name}: ${last.duration.toFixed(1)}ms`);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Record the first-paint marker and emit a measure against `app:boot`.
 * Idempotent: subsequent calls are no-ops.
 */
export function markFirstPaint(): void {
  if (firstPaintLogged) return;
  firstPaintLogged = true;
  try {
    performance.mark(FIRST_PAINT_MARK);
    performance.measure("app:boot → first-paint", BOOT_MARK, FIRST_PAINT_MARK);
    if (import.meta.env.DEV) {
      const entries = performance.getEntriesByName("app:boot → first-paint");
      const last = entries[entries.length - 1];
      if (last) {
        // eslint-disable-next-line no-console
        console.info(`[boot] first-paint: ${last.duration.toFixed(1)}ms`);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Dump every recorded "app:*" measure to the console.
 * Intended for manual perf audits in dev mode.
 */
export function logBootMetrics(): void {
  if (!import.meta.env.DEV) return;
  try {
    const measures = performance.getEntriesByType("measure").filter((e) => e.name.startsWith("app:"));
    if (measures.length === 0) return;
    // eslint-disable-next-line no-console
    console.info("[boot] metrics:");
    for (const m of measures) {
      // eslint-disable-next-line no-console
      console.info(`  ${m.name}: ${m.duration.toFixed(1)}ms`);
    }
  } catch {
    /* ignore */
  }
}
