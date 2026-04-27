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
 */
export function toMonacoModelUri(filePath: string): string {
  const slashed = filePath.replace(/\\/g, "/");
  // POSIX absolute path (starts with "/") needs `file://${slashed}` to
  // avoid `file:////home/...` (four leading slashes); Windows drive
  // paths need `file:///${slashed}` so the drive letter survives parse.
  return slashed.startsWith("/") ? `file://${slashed}` : `file:///${slashed}`;
}
