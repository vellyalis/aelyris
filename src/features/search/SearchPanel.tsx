import { invoke } from "@tauri-apps/api/core";
import { FolderSearch, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../../shared/store/toastStore";
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
  // A monotonically increasing token used to discard stale invoke results.
  // Without this, a slow "fo" query could resolve after a fast "foo" query
  // and clobber the latest results — even though the timer was cleared,
  // any invoke already in flight is uncancellable.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Drop any pending debounced invoke so it can't fire setState on
      // an unmounted component (and so a closing-the-panel-then-typing
      // sequence doesn't run a doomed grep call).
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Bump so any in-flight invoke ignores its own resolve.
      requestIdRef.current += 1;
    };
  }, []);

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Bump synchronously on every input change — including the
      // empty-query early-return path. Without this, a query that
      // resolves after the user clears the input still matches the
      // unchanged token and re-populates `results`/toast under an
      // empty query (codex r1 P2). The token must invalidate before
      // any new debounce schedules so the old in-flight invoke can't
      // sneak through.
      requestIdRef.current += 1;
      if (!q.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      timerRef.current = setTimeout(async () => {
        const requestId = ++requestIdRef.current;
        setSearching(true);
        try {
          const r = await invoke<GrepResult[]>("grep_files", {
            rootPath,
            pattern: q,
            maxResults: 100,
          });
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setResults(r);
        } catch (err) {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          // Surface failures instead of presenting them as "no matches" —
          // a regex syntax error or backend permission denial is not the
          // same as an empty result set, and the previous silent
          // setResults([]) trapped users in retype-loops.
          setResults([]);
          toast.error("Search failed", String(err));
        } finally {
          if (mountedRef.current && requestId === requestIdRef.current) {
            setSearching(false);
          }
        }
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
    <AnimatePresence initial={!reduceMotion}>
      {visible && (
        <motion.div
          className={styles.panel}
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className={styles.header}>
            <input
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
              const shortFile = file.replace(`${rootPath}/`, "");
              return (
                <div key={file} className={styles.fileGroup}>
                  <div className={styles.fileName}>{shortFile}</div>
                  {matches.map((m) => (
                    <button
                      type="button"
                      key={`${m.file}-${m.line}-${m.content}`}
                      className={styles.match}
                      onClick={() => onResultClick(m.file, m.line)}
                    >
                      <span className={styles.lineNum}>{m.line}</span>
                      <span className={styles.lineContent}>{highlightMatch(m.content, query)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {!searching && !query && (
              <EmptyState
                preset="files"
                title="Search across files"
                description="Type to find text anywhere in this project."
              />
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
