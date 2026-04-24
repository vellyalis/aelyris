import { Columns2, WrapText } from "lucide-react";
import { memo } from "react";
import styles from "./EditorStatusBar.module.css";

interface EditorStatusBarProps {
  line: number;
  column: number;
  language: string;
  encoding?: string;
  tabSize: number;
  minimapEnabled: boolean;
  wordWrap: boolean;
  saved: boolean;
  onToggleMinimap: () => void;
  onToggleWordWrap: () => void;
}

export const EditorStatusBar = memo(function EditorStatusBar({
  line,
  column,
  language,
  encoding = "UTF-8",
  tabSize,
  minimapEnabled,
  wordWrap,
  saved,
  onToggleMinimap,
  onToggleWordWrap,
}: EditorStatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.item}>
        Ln {line}, Col {column}
      </span>
      {saved && <span className={styles.saved}>Saved</span>}
      <div className={styles.spacer} />
      <span className={styles.item}>Spaces: {tabSize}</span>
      <span className={styles.item}>{encoding}</span>
      <span className={styles.item}>{language}</span>
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={onToggleWordWrap}
        aria-pressed={wordWrap}
        aria-label="Toggle word wrap"
        title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}
      >
        <WrapText size={11} aria-hidden="true" style={{ opacity: wordWrap ? 1 : 0.4 }} />
      </button>
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={onToggleMinimap}
        aria-pressed={minimapEnabled}
        aria-label="Toggle minimap"
        title={minimapEnabled ? "Hide Minimap" : "Show Minimap"}
      >
        <Columns2 size={11} aria-hidden="true" style={{ opacity: minimapEnabled ? 1 : 0.4 }} />
      </button>
    </div>
  );
});
