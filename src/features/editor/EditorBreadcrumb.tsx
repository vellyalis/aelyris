import { ChevronRight, FileWarning, Sparkles } from "lucide-react";
import { memo } from "react";
import styles from "./EditorBreadcrumb.module.css";
import { computeRelativePath } from "./useGhostPaintForFile";

interface EditorBreadcrumbProps {
  filePath: string;
  projectPath?: string;
  ghostLayerCount?: number;
  ghostConflictCount?: number;
  ghostDeferredCount?: number;
}

export const EditorBreadcrumb = memo(function EditorBreadcrumb({
  filePath,
  projectPath,
  ghostLayerCount = 0,
  ghostConflictCount = 0,
  ghostDeferredCount = 0,
}: EditorBreadcrumbProps) {
  // Reuse the ghost-paint normalizer so Windows/Unix mismatches can't leave
  // the absolute path showing through as a single breadcrumb segment.
  const relative = computeRelativePath(filePath, projectPath ?? null) ?? filePath;
  const segments = relative.split("/").filter(Boolean);
  const breadcrumbSegments = segments.reduce<Array<{ label: string; path: string }>>((acc, seg) => {
    const prev = acc[acc.length - 1]?.path;
    acc.push({ label: seg, path: prev ? `${prev}/${seg}` : seg });
    return acc;
  }, []);

  const hasGhost = ghostLayerCount > 0;
  const hasConflict = ghostConflictCount > 0;

  return (
    <div className={styles.breadcrumb}>
      {breadcrumbSegments.map((seg, i) => (
        <span key={seg.path} className={i === breadcrumbSegments.length - 1 ? styles.active : styles.segment}>
          {i > 0 && <ChevronRight size={10} className={styles.sep} />}
          {seg.label}
        </span>
      ))}
      {hasConflict && (
        <span
          className={styles.ghostBadge}
          data-kind="conflict"
          title={`${ghostConflictCount} ghost hunk${ghostConflictCount === 1 ? "" : "s"} deferred — your edits overlap the suggested change`}
        >
          <FileWarning size={10} className={styles.ghostBadgeIcon} />
          {ghostConflictCount} conflict{ghostConflictCount === 1 ? "" : "s"}
        </span>
      )}
      {!hasConflict && hasGhost && (
        <span
          className={styles.ghostBadge}
          title={`${ghostLayerCount} ghost layer${ghostLayerCount === 1 ? "" : "s"} painting this file${ghostDeferredCount > 0 ? ` · ${ghostDeferredCount} mixed hunk${ghostDeferredCount === 1 ? "" : "s"} on gutter` : ""}`}
        >
          <Sparkles size={10} className={styles.ghostBadgeIcon} />
          ghost{ghostLayerCount > 1 ? ` ×${ghostLayerCount}` : ""}
        </span>
      )}
    </div>
  );
});
