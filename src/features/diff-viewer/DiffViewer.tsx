import { DiffEditor } from "@monaco-editor/react";
import { Columns2, FileX2, Rows2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getMonoFontStack } from "../../shared/lib/fontStack";
import { useAppStore } from "../../shared/store/appStore";
import { getPalette, isLightTheme, monacoThemeColors } from "../../shared/themes/catppuccin";
import { EmptyState } from "../../shared/ui/EmptyState";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  fileName?: string;
  /** Fires when the user clicks the glyph margin on the modified side — lets
   *  hosts attach inline comment / suggestion affordances. */
  onGlyphMarginClick?: (lineNumber: number) => void;
}

type Layout = "split" | "unified";

// Binary content is detected via NUL bytes anywhere in the first 8KB — matches
// the heuristic git uses. Keeps us from trying to render megabytes of garbage
// in Monaco (which will stall the renderer).
const BINARY_SCAN_WINDOW = 8192;
// Above ~1MB Monaco's diff algorithm starts to chew CPU. Kick out early and
// render a guard instead of freezing the UI.
const LARGE_DIFF_BYTE_LIMIT = 1 * 1024 * 1024;

function hasNullByte(s: string): boolean {
  const scanTo = Math.min(s.length, BINARY_SCAN_WINDOW);
  for (let i = 0; i < scanTo; i += 1) {
    if (s.charCodeAt(i) === 0) return true;
  }
  return false;
}

function classifyDiff(original: string, modified: string): "empty" | "binary" | "too-large" | "ok" {
  if (original === modified) return "empty";
  if (hasNullByte(original) || hasNullByte(modified)) return "binary";
  if (original.length > LARGE_DIFF_BYTE_LIMIT || modified.length > LARGE_DIFF_BYTE_LIMIT) {
    return "too-large";
  }
  return "ok";
}

export function DiffViewer({
  original,
  modified,
  language = "typescript",
  fileName,
  onGlyphMarginClick,
}: DiffViewerProps) {
  const themeId = useAppStore((s) => s.themeId);
  const palette = getPalette(themeId);
  const light = isLightTheme(themeId);
  const colors = monacoThemeColors(palette, light);
  const [layout, setLayout] = useState<Layout>("split");
  const onGlyphMarginClickRef = useRef(onGlyphMarginClick);
  onGlyphMarginClickRef.current = onGlyphMarginClick;

  const kind = useMemo(() => classifyDiff(original, modified), [original, modified]);

  const header = (
    <div className={styles.header}>
      {fileName && <span className={styles.fileName}>{fileName}</span>}
      <fieldset className={styles.toolbar} aria-label="Diff layout">
        <button
          type="button"
          className={styles.segment}
          data-active={layout === "split"}
          onClick={() => setLayout("split")}
          title="Side-by-side"
          aria-pressed={layout === "split"}
        >
          <Columns2 size={12} strokeWidth={1.75} aria-hidden="true" />
          Split
        </button>
        <button
          type="button"
          className={styles.segment}
          data-active={layout === "unified"}
          onClick={() => setLayout("unified")}
          title="Unified"
          aria-pressed={layout === "unified"}
        >
          <Rows2 size={12} strokeWidth={1.75} aria-hidden="true" />
          Unified
        </button>
      </fieldset>
    </div>
  );

  if (kind === "empty") {
    return (
      <div className={styles.container}>
        {header}
        <div className={styles.placeholder}>
          <EmptyState preset="files" title="No changes to show" description="The two versions are identical." />
        </div>
      </div>
    );
  }

  if (kind === "binary" || kind === "too-large") {
    const title = kind === "binary" ? "Binary file" : "File is too large to diff";
    const description =
      kind === "binary"
        ? "This file contains binary data. Open it in an external viewer to inspect."
        : "Skipping diff to keep the editor responsive. Use the terminal (git diff) for the full view.";
    return (
      <div className={styles.container}>
        {header}
        <div className={styles.placeholder}>
          <EmptyState icon={<FileX2 size={20} strokeWidth={1.5} />} title={title} description={description} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {header}
      <div className={styles.editor}>
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme="aether-theme"
          options={{
            readOnly: true,
            renderSideBySide: layout === "split",
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: getMonoFontStack(),
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
          }}
          onMount={(editor, monaco) => {
            monaco.editor.setTheme("aether-theme");
            const modifiedEditor = editor.getModifiedEditor();
            // Monaco MouseTargetType.GUTTER_GLYPH_MARGIN === 2.
            modifiedEditor.onMouseDown((e) => {
              if (e.target.type === 2 && e.target.position) {
                onGlyphMarginClickRef.current?.(e.target.position.lineNumber);
              }
            });
          }}
        />
      </div>
    </div>
  );
}
