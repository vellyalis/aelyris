import { useState, useCallback, useMemo } from "react";
import { History, Play, Copy, X, ChevronRight, ChevronDown } from "lucide-react";
import type { CommandBlock } from "./commandBlock";
import styles from "./CommandHistory.module.css";

interface CommandHistoryProps {
  blocks: readonly CommandBlock[];
  /** Re-send the command to the PTY (caller appends \r if needed). */
  onRerun: (command: string) => void;
  /** Copy arbitrary text to the clipboard. */
  onCopy: (text: string) => void;
}

/** How many output lines to show inline before a "show all" affordance. */
const PREVIEW_LINES = 6;

/**
 * Block-level command history dropdown.  Each row is a completed command
 * block and its captured output; rows can be expanded to show the full
 * output, and each has copy-command / copy-output / rerun actions.
 */
export function CommandHistory({ blocks, onRerun, onCopy }: CommandHistoryProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    // Show newest first — they are what the user is most likely to act on.
    const named = blocks.filter((b) => b.command.length > 0);
    const reversed = named.slice().reverse();
    if (!filter.trim()) return reversed;
    const lower = filter.toLowerCase();
    return reversed.filter(
      (b) =>
        b.command.toLowerCase().includes(lower) ||
        b.outputLines.some((l) => l.toLowerCase().includes(lower)),
    );
  }, [blocks, filter]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRerun = useCallback(
    (cmd: string) => {
      onRerun(cmd);
      setOpen(false);
    },
    [onRerun],
  );

  const distinctCount = useMemo(
    () => blocks.filter((b) => b.command.length > 0).length,
    [blocks],
  );

  if (distinctCount === 0) return null;

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        title={`Command history (${distinctCount})`}
        aria-label="Command history"
      >
        <History size={11} />
        <span className={styles.count}>{distinctCount}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <input
              className={styles.filter}
              placeholder="Filter commands or output..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">
              <X size={10} />
            </button>
          </div>
          <div className={styles.list}>
            {filtered.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                expanded={expanded.has(block.id)}
                onToggleExpand={() => toggleExpand(block.id)}
                onRerun={handleRerun}
                onCopy={onCopy}
              />
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

interface BlockRowProps {
  block: CommandBlock;
  expanded: boolean;
  onToggleExpand: () => void;
  onRerun: (cmd: string) => void;
  onCopy: (text: string) => void;
}

function BlockRow({ block, expanded, onToggleExpand, onRerun, onCopy }: BlockRowProps) {
  const previewLines = expanded
    ? block.outputLines
    : block.outputLines.slice(0, PREVIEW_LINES);
  const hasMore = block.outputLines.length > PREVIEW_LINES;
  const duration = block.endedAt ? block.endedAt - block.startedAt : null;

  return (
    <div className={styles.item}>
      <div className={styles.row}>
        <button
          className={styles.chevron}
          onClick={onToggleExpand}
          aria-label={expanded ? "Collapse" : "Expand"}
          disabled={block.outputLines.length === 0}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <span className={styles.command} title={block.command}>
          {block.command}
        </span>
        {duration !== null && (
          <span className={styles.duration}>{formatDuration(duration)}</span>
        )}
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={() => onRerun(block.command)}
            title="Re-run command"
          >
            <Play size={9} />
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => onCopy(block.command)}
            title="Copy command"
          >
            <Copy size={9} />
          </button>
          {block.outputLines.length > 0 && (
            <button
              className={styles.actionBtn}
              onClick={() => onCopy(block.outputLines.join("\n"))}
              title="Copy output"
            >
              <Copy size={9} style={{ opacity: 0.6 }} />
            </button>
          )}
        </div>
      </div>
      {expanded && previewLines.length > 0 && (
        <pre className={styles.output}>
          {previewLines.join("\n")}
          {!expanded && hasMore && "\n…"}
        </pre>
      )}
    </div>
  );
}

/** Format ms as "420ms" / "12.3s" / "1:02.3". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec - min * 60).toFixed(1);
  return `${min}:${sec.padStart(4, "0")}`;
}
