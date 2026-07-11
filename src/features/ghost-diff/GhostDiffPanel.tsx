import { Check, ChevronRight, Layers, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isReadOnlyLayer, type LayerSummary } from "../../shared/types/ghostdiff";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./GhostDiffPanel.module.css";

interface GhostDiffPanelProps {
  layers: LayerSummary[];
  onDismiss: (layerId: string) => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

/**
 * Popover anchored to the StatusBar ghost-layer button. Shows every active
 * ghost layer with its file list; file-click opens each path inside the
 * editor through the app-owned file-selection route.
 */
export function GhostDiffPanel({ layers, onDismiss, onClose, onOpenFile }: GhostDiffPanelProps) {
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
      <PanelHeader
        leadingIcon={<Layers size={12} />}
        title="Ghost diff"
        subtitle={layers.length === 0 ? "No active layers" : `${layers.length} layer${layers.length === 1 ? "" : "s"}`}
      />
      <div className={styles.list}>
        {layers.length === 0 ? (
          <EmptyState
            icon={<Layers size={20} strokeWidth={1.5} />}
            title="No active ghost layers"
            description="Agents in worktrees will appear here with live file diffs."
          />
        ) : (
          layers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              expanded={expanded.has(layer.id)}
              onToggle={() => toggleExpanded(layer.id)}
              onDismiss={() => onDismiss(layer.id)}
              onOpenFile={onOpenFile}
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
  onOpenFile: (path: string) => void;
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

function LayerRow({ layer, expanded, onToggle, onDismiss, onOpenFile }: LayerRowProps) {
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
          <X size={10} />
        </button>
      </div>
      {expanded && filePaths.length > 0 && (
        <ul className={styles.fileList}>
          {filePaths.map((path) => (
            <li key={path}>
              <button type="button" className={styles.fileRow} title={path} onClick={() => onOpenFile(path)}>
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
      {expanded && filePaths.length === 0 && <div className={styles.emptyFiles}>No file changes yet.</div>}
    </div>
  );
}
