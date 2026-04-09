import { DiffEditor } from "@monaco-editor/react";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  fileName?: string;
}

const SCAPE_DARK_THEME = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1a1a1a",
    "editorLineNumber.foreground": "#555555",
    "editorLineNumber.activeForeground": "#888888",
    "editor.selectionBackground": "#3a3a4a",
    "editorGutter.background": "#1a1a1a",
  },
};

export function DiffViewer({
  original,
  modified,
  language = "typescript",
  fileName,
}: DiffViewerProps) {
  return (
    <div className={styles.container}>
      {fileName && <div className={styles.header}>{fileName}</div>}
      <div className={styles.editor}>
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "Cascadia Code, IBM Plex Mono, monospace",
            lineHeight: 20,
            renderOverviewRuler: false,
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          }}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme("aether-dark", SCAPE_DARK_THEME);
          }}
          onMount={() => {
            // Theme applied via beforeMount
          }}
        />
      </div>
    </div>
  );
}
