// Flat projection of the file-tree for virtualization + keyboard navigation.
// Keeping this as a pure function in its own module makes it easy to unit-
// test edge cases (deep nesting, partial expansion, missing contents) without
// spinning up the whole FileTree component.

export interface FlattenEntry {
  name: string;
  path: string;
  is_dir: boolean;
  file_type: string;
}

export interface FlatEntry {
  name: string;
  path: string;
  is_dir: boolean;
  file_type: string;
  depth: number;
  isOpen: boolean;
  parent: string | null;
}

/**
 * Walk the directory tree rooted at `root`, emitting one entry per visible
 * row in DFS order. A row is "visible" when every ancestor directory is
 * present in `expanded`. `entries` is a directory → children lookup; when a
 * directory is missing we simply stop walking its subtree (loading state).
 */
export function flattenVisible(root: string, entries: Map<string, FlattenEntry[]>, expanded: Set<string>): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (dir: string, depth: number) => {
    const items = entries.get(dir);
    if (!items) return;
    for (const item of items) {
      const isOpen = expanded.has(item.path);
      out.push({
        name: item.name,
        path: item.path,
        is_dir: item.is_dir,
        file_type: item.file_type,
        depth,
        isOpen,
        parent: dir,
      });
      if (item.is_dir && isOpen) {
        walk(item.path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}
