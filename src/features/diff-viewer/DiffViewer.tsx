import { DiffEditor } from "@monaco-editor/react";
import { useAppStore } from "../../shared/store/appStore";
import { getPalette, isLightTheme, monacoThemeColors } from "../../shared/themes/catppuccin";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  fileName?: string;
}

export function DiffViewer({
  original,
  modified,
  language = "typescript",
  fileName,
}: DiffViewerProps) {
  const themeId = useAppStore((s) => s.themeId);
  const palette = getPalette(themeId);
  const light = isLightTheme(themeId);
  const colors = monacoThemeColors(palette, light);

  return (
    <div className={styles.container}>
      {fileName && <div className={styles.header}>{fileName}</div>}
      <div className={styles.editor}>
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme="aether-theme"
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
            monaco.editor.defineTheme("aether-theme", {
              base: light ? "vs" : "vs-dark",
              inherit: true,
              rules: [],
              colors,
            });
            monaco.editor.setTheme("aether-theme");
          }}
        />
      </div>
    </div>
  );
}
