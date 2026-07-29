export function resolveProjectFilePath(projectPath: string, path: string): string {
  const trimmed = path.trim();
  if (/^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  const root = projectPath.replace(/[\\/]+$/, "");
  return `${root}\\${trimmed.replace(/^[/\\]+/, "").replace(/\//g, "\\")}`;
}

export function parseJsonArtifact<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
