import * as Dialog from "@radix-ui/react-dialog";
import { matchSorter } from "match-sorter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./QuickOpen.module.css";
import { useFileList } from "./useFileList";

type QuickOpenMode = "files" | "buffers";

interface QuickOpenProps {
  projectPath: string;
  openFiles: string[];
  onSelectFile: (path: string) => void;
  onClose: () => void;
  initialMode?: QuickOpenMode;
}

export function QuickOpen({ projectPath, openFiles, onSelectFile, onClose, initialMode = "files" }: QuickOpenProps) {
  const [mode, setMode] = useState<QuickOpenMode>(initialMode);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { files, loading } = useFileList(projectPath);

  // Source list depends on mode
  const sourceList = mode === "buffers" ? openFiles : files;

  // Fuzzy filter
  const results = useMemo(() => {
    if (!query.trim()) return sourceList.slice(0, 50);
    return matchSorter(sourceList, query, {
      keys: [(item) => item],
      threshold: matchSorter.rankings.CONTAINS,
    }).slice(0, 50);
  }, [sourceList, query]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIdx] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const file = results[selectedIdx];
        if (file) {
          const fullPath = mode === "buffers" ? file : `${projectPath}/${file}`;
          onSelectFile(fullPath);
          onClose();
        }
      }
      // Escape is handled by Radix Dialog itself — no local listener needed.
      else if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "files" ? "buffers" : "files"));
        setQuery("");
      }
    },
    [results, selectedIdx, projectPath, mode, onSelectFile, onClose],
  );

  const fileName = (path: string) => path.split("/").pop() ?? path;
  const dirName = (path: string) => {
    const parts = path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.panel}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Radix's default focus target is the content root; we want the
            // search input instead so the user can type immediately.
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">
            {mode === "files" ? "Quick Open: Files" : "Quick Open: Buffers"}
          </Dialog.Title>
          <div className={styles.inputRow}>
            <span className={styles.modeTag}>{mode === "files" ? "Files" : "Buffers"}</span>
            <input
              ref={inputRef}
              className={styles.input}
              placeholder={mode === "files" ? "Search files..." : "Switch buffer..."}
              aria-label={mode === "files" ? "Search files" : "Switch buffer"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <span className={styles.hint}>Tab: switch mode</span>
          </div>
          <div ref={listRef} className={styles.list}>
            {loading && <div className={styles.loading}>Loading files...</div>}
            {results.map((path, i) => (
              <div
                key={path}
                className={`${styles.item} ${i === selectedIdx ? styles.itemActive : ""}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => {
                  const fullPath = mode === "buffers" ? path : `${projectPath}/${path}`;
                  onSelectFile(fullPath);
                  onClose();
                }}
              >
                <span className={styles.itemName}>{fileName(path)}</span>
                <span className={styles.itemDir}>{dirName(path)}</span>
              </div>
            ))}
            {!loading && results.length === 0 && <div className={styles.empty}>No matches</div>}
          </div>
          <div className={styles.footer}>
            <span>
              {results.length} / {sourceList.length} files
            </span>
            <span>↑↓ navigate · Enter open · Esc close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
