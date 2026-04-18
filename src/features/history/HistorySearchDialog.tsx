import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { History, Search, AlertTriangle } from "lucide-react";
import { useSemanticHistory } from "../../shared/hooks/useSemanticHistory";
import { formatExecutedAt, type SearchFilters, type SearchHit } from "../../shared/types/history";
import styles from "./HistorySearchDialog.module.css";

interface HistorySearchState {
  open: boolean;
}

interface HistorySearchStore extends HistorySearchState {
  show: () => void;
  close: () => void;
  toggle: () => void;
}

export const useHistorySearchStore = create<HistorySearchStore>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));

interface HistorySearchDialogProps {
  /**
   * Callback fired when the user accepts a hit. Typically wired to write the
   * command into the active terminal.
   */
  onAccept: (hit: SearchHit) => void;
  /** Optional cwd prefix filter default (e.g. current project path). */
  defaultCwdPrefix?: string;
}

export function HistorySearchDialog({ onAccept, defaultCwdPrefix }: HistorySearchDialogProps) {
  const { open, close } = useHistorySearchStore();
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [scopeCwd, setScopeCwd] = useState(false);

  const filters: SearchFilters = {
    only_failed: onlyFailed || undefined,
    cwd_prefix: scopeCwd ? defaultCwdPrefix : undefined,
  };

  const { query, setQuery, hits, loading, error } = useSemanticHistory(filters);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Reset when closing so a fresh open starts empty.
      setQuery("");
      setCursor(0);
      setOnlyFailed(false);
      setScopeCwd(false);
    }
  }, [open, setQuery]);

  useEffect(() => {
    // Clamp cursor when hit list shrinks.
    if (cursor >= hits.length) setCursor(Math.max(0, hits.length - 1));
  }, [hits.length, cursor]);

  useEffect(() => {
    // Scroll the active row into view.
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-row-index='${cursor}']`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const accept = useCallback(
    (hit: SearchHit) => {
      onAccept(hit);
      close();
    },
    [onAccept, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(hits.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[cursor];
        if (hit) accept(hit);
      }
    },
    [hits, cursor, accept],
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <div className={styles.header}>
            <History size={18} aria-hidden />
            <Dialog.Title className={styles.title}>Semantic History</Dialog.Title>
            <input
              ref={inputRef}
              className={styles.input}
              placeholder="e.g. '3 日前のビルドエラー', failing tests, deploy..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className={styles.filterRow}>
            <Search size={12} aria-hidden />
            <button
              className={`${styles.filterChip} ${onlyFailed ? styles.filterChipActive : ""}`}
              onClick={() => setOnlyFailed((v) => !v)}
              type="button"
            >
              failed only
            </button>
            {defaultCwdPrefix && (
              <button
                className={`${styles.filterChip} ${scopeCwd ? styles.filterChipActive : ""}`}
                onClick={() => setScopeCwd((v) => !v)}
                type="button"
                title={defaultCwdPrefix}
              >
                this project
              </button>
            )}
            {loading && <span>searching…</span>}
            {error && <span className={styles.failed}><AlertTriangle size={10} /> {error}</span>}
          </div>

          <div className={styles.results} ref={listRef}>
            {hits.length === 0 && !loading && (
              <div className={styles.empty}>
                {query.trim()
                  ? "No matches. Try different words or disable filters."
                  : "Type to search your command history semantically."}
              </div>
            )}
            {hits.map((hit, idx) => (
              <button
                key={hit.entry.command_id}
                data-row-index={idx}
                className={`${styles.row} ${idx === cursor ? styles.rowActive : ""}`}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => accept(hit)}
                type="button"
              >
                <div className={styles.rowMain}>
                  <span className={styles.command}>{hit.entry.command}</span>
                  <span className={styles.meta}>
                    <span className={styles.cwd} title={hit.entry.cwd}>{hit.entry.cwd}</span>
                    <span>{formatExecutedAt(hit.entry.executed_at)}</span>
                    {hit.entry.exit_code != null && hit.entry.exit_code !== 0 && (
                      <span className={styles.failed}>exit {hit.entry.exit_code}</span>
                    )}
                  </span>
                </div>
                <span className={styles.score}>{hit.score.toFixed(2)}</span>
              </button>
            ))}
          </div>

          <div className={styles.footer}>
            <div className={styles.footerHints}>
              <span><span className={styles.kbd}>↑↓</span> navigate</span>
              <span><span className={styles.kbd}>Enter</span> run</span>
              <span><span className={styles.kbd}>Esc</span> close</span>
            </div>
            <span>{hits.length} hits</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Open the semantic history dialog from anywhere (e.g. keybinding). */
export function showHistorySearch(): void {
  useHistorySearchStore.getState().show();
}
