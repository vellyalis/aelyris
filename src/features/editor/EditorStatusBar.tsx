import { memo } from "react";
import { Columns2 } from "lucide-react";
import styles from "./EditorStatusBar.module.css";

interface EditorStatusBarProps {
  line: number;
  column: number;
  language: string;
  encoding?: string;
  indentType?: string;
  minimapEnabled: boolean;
  onToggleMinimap: () => void;
}

export const EditorStatusBar = memo(function EditorStatusBar({
  line, column, language, encoding = "UTF-8", indentType = "Spaces: 2",
  minimapEnabled, onToggleMinimap,
}: EditorStatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.item}>Ln {line}, Col {column}</span>
      <div className={styles.spacer} />
      <span className={styles.item}>{indentType}</span>
      <span className={styles.item}>{encoding}</span>
      <span className={styles.item}>{language}</span>
      <button className={styles.toggleBtn} onClick={onToggleMinimap} title={minimapEnabled ? "Hide Minimap" : "Show Minimap"}>
        <Columns2 size={11} style={{ opacity: minimapEnabled ? 1 : 0.4 }} />
      </button>
    </div>
  );
});
