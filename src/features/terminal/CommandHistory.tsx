import { useState, useCallback, useMemo } from "react";
import { History, Play, Copy, X } from "lucide-react";
import styles from "./CommandHistory.module.css";

interface CommandHistoryProps {
  commands: string[];
  onRerun: (command: string) => void;
  onCopy: (command: string) => void;
}

export function CommandHistory({ commands, onRerun, onCopy }: CommandHistoryProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return commands;
    const lower = filter.toLowerCase();
    return commands.filter((c) => c.toLowerCase().includes(lower));
  }, [commands, filter]);

  const handleRerun = useCallback((cmd: string) => {
    onRerun(cmd);
    setOpen(false);
  }, [onRerun]);

  if (commands.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        title={`Command history (${commands.length})`}
        aria-label="Command history"
      >
        <History size={11} />
        <span className={styles.count}>{commands.length}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <input
              className={styles.filter}
              placeholder="Filter commands..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">
              <X size={10} />
            </button>
          </div>
          <div className={styles.list}>
            {filtered.map((cmd, i) => (
              <div key={`${cmd}-${i}`} className={styles.item}>
                <span className={styles.command}>{cmd}</span>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} onClick={() => handleRerun(cmd)} title="Re-run">
                    <Play size={9} />
                  </button>
                  <button className={styles.actionBtn} onClick={() => onCopy(cmd)} title="Copy">
                    <Copy size={9} />
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className={styles.empty}>No matching commands</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
