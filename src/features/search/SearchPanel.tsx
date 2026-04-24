import { invoke } from "@tauri-apps/api/core";
import { FolderSearch, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { LoadingSkeleton } from "../../shared/ui/LoadingSkeleton";
import styles from "./SearchPanel.module.css";

interface GrepResult {
  file: string;
  line: number;
  content: string;
}

interface SearchPanelProps {
  visible: boolean;
  rootPath: string;
  onClose: () => void;
  onResultClick: (file: string, line: number) => void;
}

export function SearchPanel({ visible, rootPath, onClose, onResultClick }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GrepResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!q.trim()) {
        setResults([]);
        return;
      }
      timerRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const r = await invoke<GrepResult[]>("grep_files", {
            rootPath,
            pattern: q,
            maxResults: 100,
          });
          setResults(r);
        } catch {
          setResults([]);
        }
        setSearching(false);
      }, 300);
    },
    [rootPath],
  );

  // Group results by file
  const grouped = new Map<string, GrepResult[]>();
  for (const r of results) {
    const list = grouped.get(r.file) ?? [];
    list.push(r);
    grouped.set(r.file, list);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.panel}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className={styles.header}>
            <input
              autoFocus
              className={styles.input}
              placeholder="Search in files..."
              aria-label="Search in files"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
            />
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close search">
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.results}>
            {searching && <LoadingSkeleton variant="row" count={5} label="Searching" />}
            {!searching && query && results.length === 0 && (
              <EmptyState
                icon={<FolderSearch size={20} strokeWidth={1.5} />}
                title="No matches"
                description={`Nothing in this project matches "${query}".`}
              />
            )}
            {[...grouped.entries()].map(([file, matches]) => {
              const shortFile = file.replace(rootPath + "/", "");
              return (
                <div key={file} className={styles.fileGroup}>
                  <div className={styles.fileName}>{shortFile}</div>
                  {matches.map((m, i) => (
                    <button key={i} className={styles.match} onClick={() => onResultClick(m.file, m.line)}>
                      <span className={styles.lineNum}>{m.line}</span>
                      <span className={styles.lineContent}>{highlightMatch(m.content, query)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {!searching && !query && (
              <EmptyState preset="files" title="Search across files" description="Type to find text anywhere in this project." />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
