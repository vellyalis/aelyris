import { Check, ChevronRight, Layers, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isReadOnlyLayer, type LayerSummary } from "../../shared/types/ghostdiff";
import styles from "./GhostDiffPanel.module.css";

interface GhostDiffPanelProps {
  layers: LayerSummary[];
  onDismiss: (layerId: string) => void;
  onClose: () => void;
}

/**
 * Popover anchored to the StatusBar ghost-layer button. Shows every active
 * ghost layer with its file list; file-click opens each path inside the
 * editor (via 3C-1b inline ghost paint — for now the click is a stub).
 */
export function GhostDiffPanel({ layers, onDismiss, onClose }: GhostDiffPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => {
      window.addEventListener("mousedown", onClick);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      cancelAnimationFrame(raf);
    };
  }, [onClose]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div ref={rootRef} className={styles.panel} role="dialog" aria-label="Ghost diff layers">
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Layers size={12} />
          <span>Ghost diff</span>
        </div>
        <span className={styles.subtitle}>
          {layers.length === 0 ? "No active layers" : `${layers.length} layer${layers.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className={styles.list}>
        {layers.length === 0 ? (
          <div className={styles.empty}>Agents in worktrees will appear here with live file diffs.</div>
        ) : (
          layers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              expanded={expanded.has(layer.id)}
              onToggle={() => toggleExpanded(layer.id)}
              onDismiss={() => onDismiss(layer.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface LayerRowProps {
  layer: LayerSummary;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}

function layerCaption(source: LayerSummary["source"]): { caption: string; title: string } {
  switch (source.kind) {
    case "worktree":
      return { caption: source.branch, title: source.branch };
    case "branchComparison": {
      const label = `${source.baseBranch} ← ${source.headBranch}`;
      return { caption: label, title: label };
    }
    case "snapshot": {
      // Terminal-scoped overlay — show the capture time so two snapshot
      // layers from the same session don't look identical in the panel.
      const time = new Date(source.capturedAt * 1000).toLocaleTimeString();
      const label = `snapshot @ ${time}`;
      const title = `Session ${source.sessionId.slice(0, 8)} · ${label}`;
      return { caption: label, title };
    }
  }
}

function LayerRow({ layer, expanded, onToggle, onDismiss }: LayerRowProps) {
  const { tint, source, fileCount, hunkCount, isComplete, filePaths } = layer;
  const { caption, title } = layerCaption(source);
  const readOnly = isReadOnlyLayer(source);

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse files" : "Expand files"}
        >
          <ChevronRight size={12} className={expanded ? styles.chevronOpen : undefined} />
        </button>
        <span className={styles.tintDot} style={{ background: tint.roleColor }} />
        <span className={styles.roleLabel}>{tint.roleLabel}</span>
        {readOnly && (
          <span className={styles.readOnlyBadge} title="Read-only — Tab / Shift+Tab disabled">
            read-only
          </span>
        )}
        <code className={styles.branch} title={title}>
          {caption}
        </code>
        <span className={styles.counts}>
          {fileCount} file{fileCount === 1 ? "" : "s"} · {hunkCount} hunk
          {hunkCount === 1 ? "" : "s"}
        </span>
        <span className={styles.statusIcon}>
          {isComplete ? (
            <Check size={12} className={styles.iconComplete} />
          ) : (
            <Loader2 size={12} className={styles.iconActive} />
          )}
        </span>
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={onDismiss}
          title="Dismiss layer"
          aria-label="Dismiss layer"
        >
          <X size={11} />
        </button>
      </div>
      {expanded && filePaths.length > 0 && (
        <ul className={styles.fileList}>
          {filePaths.map((path) => (
            <li key={path} className={styles.fileRow} title={path}>
              {path}
            </li>
          ))}
        </ul>
      )}
      {expanded && filePaths.length === 0 && <div className={styles.emptyFiles}>No file changes yet.</div>}
    </div>
  );
}
