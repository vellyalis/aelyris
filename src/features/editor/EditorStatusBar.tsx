import { memo } from "react";
import { Columns2, WrapText } from "lucide-react";
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
  line, column, language, encoding = "UTF-8", tabSize,
  minimapEnabled, wordWrap, saved,
  onToggleMinimap, onToggleWordWrap,
}: EditorStatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.item}>Ln {line}, Col {column}</span>
      {saved && <span className={styles.saved}>Saved</span>}
      <div className={styles.spacer} />
      <span className={styles.item}>Spaces: {tabSize}</span>
      <span className={styles.item}>{encoding}</span>
      <span className={styles.item}>{language}</span>
      <button className={styles.toggleBtn} onClick={onToggleWordWrap} title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}>
        <WrapText size={11} style={{ opacity: wordWrap ? 1 : 0.4 }} />
      </button>
      <button className={styles.toggleBtn} onClick={onToggleMinimap} title={minimapEnabled ? "Hide Minimap" : "Show Minimap"}>
        <Columns2 size={11} style={{ opacity: minimapEnabled ? 1 : 0.4 }} />
      </button>
    </div>
  );
});
