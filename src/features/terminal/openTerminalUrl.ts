/**
 * URL routing for Ctrl+Click on a terminal hyperlink (Tier 🟡 #4).
 *
 * Two-way branch:
 *   1. `file://` URLs that resolve inside the active project's `cwd` →
 *      open in the built-in editor. This is the case `ls --hyperlink`,
 *      ripgrep `--hyperlink-format=file`, and most CLI tools that emit
 *      OSC 8 file paths land in.
 *   2. Anything else (https / ftp / mailto / file:// outside cwd) →
 *      hand to `tauri-plugin-opener`, which dispatches to the OS handler.
 *
 * Pure routing logic lives in `routeTerminalUrl`; the side-effect
 * dispatcher is `openTerminalUrlWith`. Splitting them keeps the
 * decision testable without spinning up the editor or the Tauri plugin.
 */

export type TerminalUrlRoute =
  | { kind: "external"; url: string }
  | { kind: "editor"; absolutePath: string };

export interface RouteContext {
  /** Project / pane cwd. Optional because some panes start before a
   *  project is selected; in that case every file:// URL falls through
   *  to the external handler. */
  cwd?: string | null;
}

/**
 * Decide where a hyperlink click should land. Pure: no side effects,
 * no I/O.
 */
export function routeTerminalUrl(rawUrl: string, ctx: RouteContext): TerminalUrlRoute {
  const url = rawUrl.trim();
  if (!url.toLowerCase().startsWith("file://")) {
    return { kind: "external", url };
  }
  const absolutePath = fileUrlToPath(url);
  if (!absolutePath) {
    return { kind: "external", url };
  }
  if (!ctx.cwd) {
    return { kind: "external", url };
  }
  if (!isPathInside(absolutePath, ctx.cwd)) {
    return { kind: "external", url };
  }
  return { kind: "editor", absolutePath };
}

export interface OpenTerminalUrlAdapters {
  /** Side-effect: open the given absolute file path in the built-in editor. */
  openInEditor: (absolutePath: string) => void;
  /** Side-effect: hand the URL to the OS / external opener. */
  openExternal: (url: string) => Promise<void> | void;
}

/**
 * Side-effect form of [`routeTerminalUrl`]. Adapters are injected so
 * tests can render a `NativeTerminalArea` without resolving the editor
 * store or the Tauri plugin.
 */
export async function openTerminalUrlWith(
  rawUrl: string,
  ctx: RouteContext,
  adapters: OpenTerminalUrlAdapters,
): Promise<void> {
  const route = routeTerminalUrl(rawUrl, ctx);
  if (route.kind === "editor") {
    adapters.openInEditor(route.absolutePath);
    return;
  }
  await adapters.openExternal(route.url);
}

/**
 * Best-effort `file://URL → absolute path` decoder.
 *
 * Handles the three shapes Aether is likely to see:
 *   - `file:///C:/Users/x/foo.ts`    Windows drive (Tauri + most CLIs)
 *   - `file://localhost/C:/...`      legacy Windows
 *   - `file:///home/x/foo.ts`        POSIX
 *
 * Returns `null` for malformed URLs so the caller can fall back to the
 * external opener rather than guess at a path.
 */
export function fileUrlToPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  let pathname = decodeURIComponent(parsed.pathname);
  // URL pathnames always start with `/`. On Windows that produces
  // `/C:/foo` which is not a real OS path; strip the leading slash
  // when the next chars are a drive letter.
  if (/^\/[a-zA-Z]:/.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return pathname;
}

/**
 * Path-containment check tolerant of the Windows / POSIX split. Both
 * inputs are normalised to forward slashes; the comparison is
 * case-insensitive when *either* path uses a Windows drive letter (a
 * proxy for "we are on Windows", which works for our actual targets).
 *
 * Boundary handling: a child must either equal the parent or be
 * separated by a `/` so `/foo/bar` does not appear "inside" `/foo/ba`.
 */
export function isPathInside(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  let c = norm(child);
  let p = norm(parent);
  if (!c || !p) return false;
  if (/^[a-zA-Z]:/.test(c) || /^[a-zA-Z]:/.test(p)) {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  if (c === p) return true;
  return c.startsWith(`${p}/`);
}
