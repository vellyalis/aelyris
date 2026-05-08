/**
 * Translate an absolute filesystem path to the canonical `file://` URI
 * Monaco assigns to its editor model when given as the `path` prop.
 *
 * `@monaco-editor/react` parses its `path` prop via `monaco.Uri.parse`,
 * NOT `Uri.file`. Passing a bare Windows drive path (`C:/repo/foo.ts`)
 * would be parsed as scheme="c" + path="/repo/foo.ts", silently losing
 * the drive letter — and mismatching whatever URI we pass to
 * `textDocument/didOpen`. The same helper feeds both sites so the
 * URIs are guaranteed to agree on Windows and POSIX alike.
 *
 * Reserved characters (`#`, `?`, `%`, space) inside the path must also
 * be percent-escaped — without this, Monaco truncates the URI at `#`
 * (fragment delimiter) or `?` (query delimiter), which breaks the
 * agreement between the model URI and what notifyOpen sent.
 */
export function toMonacoModelUri(filePath: string): string {
  const slashed = filePath.replace(/\\/g, "/");
  const escaped = escapeReservedForFileUri(slashed);
  // POSIX absolute path (starts with "/") needs `file://${escaped}` to
  // avoid `file:////home/...` (four leading slashes); Windows drive
  // paths need `file:///${escaped}` so the drive letter survives parse.
  return escaped.startsWith("/") ? `file://${escaped}` : `file:///${escaped}`;
}

// `%` must be escaped first so the subsequent `%XX` sequences aren't
// themselves treated as user-supplied literals on a second pass.
function escapeReservedForFileUri(s: string): string {
  return s.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/ /g, "%20");
}
