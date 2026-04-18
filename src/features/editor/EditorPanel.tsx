import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import { EditorStatusBar } from "./EditorStatusBar";
import { DiffCommentInput } from "./DiffCommentInput";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAppStore } from "../../shared/store/appStore";
import { getPalette, isLightTheme, monacoThemeColors } from "../../shared/themes/catppuccin";
import { useLsp, registerLspProviders } from "./lsp";
import { toast } from "../../shared/store/toastStore";
import { markBootOnce } from "../../shared/lib/bootMetrics";
import { useGhostPaintForFile } from "./useGhostPaintForFile";
import type { GhostEditor, MonacoNs } from "./ghostPaint";
import type { LineRange } from "./ghostConflict";
import styles from "./EditorPanel.module.css";

interface DiffComment {
  lineNumber: number;
  comment: string;
  status: "pending" | "fixing" | "resolved";
}

interface EditorPanelProps {
  filePath: string | null;
  onClose: () => void;
  initialLine?: number;
  initialDiffMode?: boolean;
  projectPath?: string;
  onStartAgent?: (prompt: string) => void;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", rs: "rust", toml: "toml",
  css: "css", scss: "scss", html: "html", yaml: "yaml", yml: "yaml",
  py: "python", sh: "shell", bash: "shell", sql: "sql",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

export function EditorPanel({ filePath, onClose, projectPath, initialLine, initialDiffMode, onStartAgent }: EditorPanelProps) {
  const themeId = useAppStore((s) => s.themeId);
  const markUnsaved = useAppStore((s) => s.markUnsaved);
  const markSaved = useAppStore((s) => s.markSaved);
  const ghostDiffLiveMode = useAppStore((s) => s.ghostDiffLiveMode);
  const palette = getPalette(themeId);
  const light = isLightTheme(themeId);
  const editorColors = monacoThemeColors(palette, light);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [vimMode, setVimMode] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  const [minimapEnabled, setMinimapEnabled] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [diffComments, setDiffComments] = useState<DiffComment[]>([]);
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [tabSize, setTabSize] = useState(2);

  // LSP integration
  const currentLanguage = filePath ? detectLanguage(filePath) : "plaintext";
  const lsp = useLsp({ projectPath: projectPath ?? "", monacoLanguage: currentLanguage });
  const lspDispose = useRef<(() => void) | null>(null);

  // Cleanup LSP providers on unmount
  useEffect(() => {
    return () => { lspDispose.current?.(); };
  }, []);
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimRef = useRef<{ dispose: () => void } | null>(null);

  // Ghost paint wiring — editor + monaco need to become state so the hook
  // re-runs once onMount hands them over. Reset to null whenever filePath
  // changes so stale editor references never reach the painter.
  const [ghostEditor, setGhostEditor] = useState<GhostEditor | null>(null);
  const [ghostMonaco, setGhostMonaco] = useState<MonacoNs | null>(null);
  const modelChangeSubscribersRef = useRef<
    Set<(ranges: LineRange[]) => void>
  >(new Set());
  const subscribeToModelChanges = useCallback(
    (listener: (ranges: LineRange[]) => void) => {
      modelChangeSubscribersRef.current.add(listener);
      return () => {
        modelChangeSubscribersRef.current.delete(listener);
      };
    },
    [],
  );
  // Suppresses dirty-range broadcast while we programmatically replace the
  // editor value (e.g. after accepting a ghost hunk). Without this the
  // setValue call would mark every remaining line as user-dirty and make
  // the next hunk look like a conflict.
  const suppressModelChangesRef = useRef(false);
  const ghostPaint = useGhostPaintForFile({
    editor: ghostEditor,
    monaco: ghostMonaco,
    filePath,
    projectPath,
    subscribeToModelChanges,
    liveMode: ghostDiffLiveMode,
  });
  const {
    conflictCount: ghostConflictCount,
    deferredCount: ghostDeferredCount,
    layerCount: ghostLayerCount,
  } = ghostPaint;
  // Latest hook result for the command handlers — they fire outside the
  // React render cycle so a ref is the only safe way to reach current state.
  const ghostPaintRef = useRef(ghostPaint);
  ghostPaintRef.current = ghostPaint;
  // Monaco IContextKey handles — updated in a useEffect from the hook
  // output so the preconditions on addCommand react to state changes.
  type CtxKey = { set: (value: boolean) => void };
  const ghostHunkKeyRef = useRef<CtxKey | null>(null);
  const ghostInFileKeyRef = useRef<CtxKey | null>(null);
  useEffect(() => {
    ghostInFileKeyRef.current?.set(ghostPaint.layerCount > 0);
    ghostHunkKeyRef.current?.set(
      ghostPaint.hasHunkAtLine(cursorPos.line),
    );
  }, [ghostPaint, cursorPos.line]);

  const toggleVim = useCallback(async () => {
    if (vimMode) {
      vimRef.current?.dispose();
      vimRef.current = null;
      setVimMode(false);
      return;
    }
    if (!editorRef.current) return;
    try {
      const { initVimMode } = await import("monaco-vim");
      const statusEl = document.getElementById("vim-statusbar");
      const vim = initVimMode(editorRef.current, statusEl);
      vimRef.current = vim;
      setVimMode(true);
    } catch { /* monaco-vim not available */ }
  }, [vimMode]);

  const toggleDiff = useCallback(async () => {
    if (diffMode) { setDiffMode(false); return; }
    if (!filePath || !projectPath) return;
    try {
      const original = await invoke<string>("git_file_original", { repoPath: projectPath, filePath });
      setOriginalContent(original);
      setDiffMode(true);
    } catch {
      setOriginalContent("");
      setDiffMode(true);
    }
  }, [diffMode, filePath, projectPath]);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setModified(false);
    if (filePath) markSaved(filePath);
    setDiffMode(false);
    // Drop the previous editor instance so the ghost painter's effect
    // tears down its decorations before the new Editor mount fires.
    setGhostEditor(null);
    setGhostMonaco(null);

    (async () => {
      try {
        const data = await invoke<string>("read_file", { path: filePath });
        if (cancelled) return;
        setContent(data);
        if (initialDiffMode && projectPath) {
          try {
            const orig = await invoke<string>("git_file_original", { repoPath: projectPath, filePath });
            if (!cancelled) { setOriginalContent(orig); setDiffMode(true); }
          } catch {
            if (!cancelled) { setOriginalContent(""); setDiffMode(true); }
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath]);

  // Reload file when window regains focus (external change detection)
  useEffect(() => {
    if (!filePath) return;
    const handleFocus = async () => {
      try {
        const diskContent = await invoke<string>("read_file", { path: filePath });
        if (diskContent !== content && content !== null && !modified) {
          setContent(diskContent);
          editorRef.current?.setValue(diskContent);
        }
      } catch { /* file may have been deleted */ }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath, content, modified]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s" && filePath && editorRef.current) {
        e.preventDefault();
        const value = editorRef.current.getValue();
        invoke("write_file", { path: filePath, content: value })
          .then(() => {
            setModified(false);
            markSaved(filePath);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            toast.success("Saved", filePath.split(/[/\\]/).pop() ?? filePath);
          })
          .catch((err) => {
            setError(String(err));
            toast.error("Save failed", String(err));
          });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filePath]);

  if (!filePath) return null;

  const fileName = filePath.split("/").pop() ?? filePath;
  const language = detectLanguage(filePath);
  const isMarkdown = language === "markdown";

  const renderedHtml = useMemo(() => {
    if (!isMarkdown || !previewMode || content === null) return "";
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [isMarkdown, previewMode, content]);

  return (
    <div className={styles.panel}>
      <EditorBreadcrumb
        filePath={filePath}
        projectPath={projectPath}
        ghostLayerCount={ghostLayerCount}
        ghostConflictCount={ghostConflictCount}
        ghostDeferredCount={ghostDeferredCount}
      />
      <div className={styles.header}>
        <span className={styles.fileName}>
          {modified && <span className={styles.modDot}>●</span>}
          {fileName}
        </span>
        <span className={styles.lang}>{language}</span>
        {isMarkdown && (
          <button className={styles.diffBtn} onClick={() => setPreviewMode((v) => !v)} title="Toggle markdown preview">
            {previewMode ? "Edit" : "Preview"}
          </button>
        )}
        <button className={styles.diffBtn} onClick={toggleVim} title="Toggle Vim mode">{vimMode ? "Vim ✓" : "Vim"}</button>
        <button className={styles.diffBtn} onClick={toggleDiff} title="Toggle diff">{diffMode ? "Editor" : "Diff"}</button>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>
      <div className={styles.body}>
        {loading && <div className={styles.status}>Loading...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {content !== null && !loading && previewMode && isMarkdown && (
          <MarkdownPreview html={renderedHtml} />
        )}
        {content !== null && !loading && !diffMode && !previewMode && (
          <Editor
            key={filePath}
            defaultValue={content}
            language={language}
            theme="vs-dark"
            onMount={(editor, monaco) => {
              markBootOnce("monaco:first-mount");
              editorRef.current = editor;
              setGhostEditor(editor);
              setGhostMonaco(monaco);
              editor.onDidChangeCursorPosition((e) => {
                setCursorPos({ line: e.position.lineNumber, column: e.position.column });
              });
              editor.onDidChangeModelContent((ev) => {
                if (suppressModelChangesRef.current) return;
                const ranges: LineRange[] = ev.changes.map((c) => ({
                  start: c.range.startLineNumber,
                  end: Math.max(c.range.startLineNumber, c.range.endLineNumber),
                }));
                if (ranges.length === 0) return;
                modelChangeSubscribersRef.current.forEach((fn) => fn(ranges));
              });

              // ─── Ghost diff hotkeys (Phase 3C-1c) ──────────────────────
              // Context keys let us preempt Monaco's default Tab / Esc only
              // when ghost paint is actually present + the cursor is on it.
              const ghostHunkKey = editor.createContextKey<boolean>(
                "aetherGhostHunkAtCursor",
                false,
              );
              const ghostInFileKey = editor.createContextKey<boolean>(
                "aetherGhostInFile",
                false,
              );
              ghostHunkKeyRef.current = ghostHunkKey;
              ghostInFileKeyRef.current = ghostInFileKey;

              const replaceModelValue = (next: string) => {
                // Snapshot cursor before setValue — Monaco resets it to
                // (1, 1) on setValue and we want the user to keep roughly
                // their prior spot (plan: "カーソル位置がおおむね保たれている").
                const priorPos = editor.getPosition();
                suppressModelChangesRef.current = true;
                editor.setValue(next);
                setContent(next);
                if (priorPos) {
                  const model = editor.getModel();
                  const maxLine = model ? model.getLineCount() : priorPos.lineNumber;
                  const clamped = {
                    lineNumber: Math.min(priorPos.lineNumber, maxLine),
                    column: priorPos.column,
                  };
                  editor.setPosition(clamped);
                  editor.revealLineInCenterIfOutsideViewport(clamped.lineNumber);
                }
                queueMicrotask(() => {
                  suppressModelChangesRef.current = false;
                });
              };

              editor.addCommand(
                monaco.KeyCode.Tab,
                () => {
                  const pos = editor.getPosition();
                  if (!pos) return;
                  ghostPaintRef.current
                    .acceptHunkAtLine(pos.lineNumber)
                    .then((next) => {
                      if (next !== null) {
                        replaceModelValue(next);
                        toast.success("Ghost hunk applied");
                      }
                    })
                    .catch((err: unknown) => {
                      toast.error("Apply failed", String(err));
                    });
                },
                "aetherGhostHunkAtCursor && !suggestWidgetVisible && !editorHasSelection",
              );

              editor.addCommand(
                monaco.KeyMod.Shift | monaco.KeyCode.Tab,
                () => {
                  ghostPaintRef.current
                    .acceptAllInFile()
                    .then((next) => {
                      if (next !== null) {
                        replaceModelValue(next);
                        toast.success("All ghost hunks applied");
                      } else if (ghostPaintRef.current.layerCount > 0) {
                        // acceptAllInFile swallows per-layer errors and
                        // returns null when every layer failed. Break the
                        // silence so the user knows Shift+Tab did nothing.
                        toast.error("Apply-all failed", "All layers failed to apply");
                      }
                    })
                    .catch((err: unknown) => {
                      toast.error("Apply-all failed", String(err));
                    });
                },
                "aetherGhostInFile && !suggestWidgetVisible && !editorHasSelection",
              );

              editor.addCommand(
                monaco.KeyCode.Escape,
                () => {
                  ghostPaintRef.current
                    .dismissFileLayers()
                    .then((n) => {
                      if (n > 0) toast.info("Ghost layers dismissed");
                    })
                    .catch(() => {
                      /* already dismissed */
                    });
                },
                "aetherGhostInFile && !suggestWidgetVisible && !findWidgetVisible",
              );
              monaco.editor.defineTheme("aether-theme", {
                base: light ? "vs" : "vs-dark",
                inherit: true,
                rules: [
                  { token: "comment", foreground: light ? "6c6f85" : "6A9955" },
                  { token: "keyword", foreground: palette.mauve.slice(1) },
                  { token: "string", foreground: palette.green.slice(1) },
                  { token: "number", foreground: palette.peach.slice(1) },
                  { token: "type", foreground: palette.yellow.slice(1) },
                  { token: "function", foreground: palette.blue.slice(1) },
                ],
                colors: editorColors,
              });
              monaco.editor.setTheme("aether-theme");
              editor.focus();
              const model = editor.getModel();
              if (model) {
                setTabSize(model.getOptions().tabSize);
              }
              if (initialLine) {
                editor.revealLineInCenter(initialLine);
                editor.setPosition({ lineNumber: initialLine, column: 1 });
              }
              // Register LSP providers (if language server is available)
              if (lsp.isAvailable) {
                lspDispose.current?.();
                lspDispose.current = registerLspProviders(monaco, language, lsp);
                // Notify LSP about file open
                if (filePath && content !== null) {
                  const uri = `file:///${filePath.replace(/\\/g, "/")}`;
                  lsp.notifyOpen(uri, currentLanguage, content);
                }
              }
            }}
            onChange={() => { setModified(true); if (filePath) markUnsaved(filePath); }}
            options={{
              fontSize: 13,
              fontFamily: "IBM Plex Mono, Cascadia Code, monospace",
              lineHeight: 20,
              minimap: { enabled: minimapEnabled },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              overviewRulerLanes: 0,
              scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
              padding: { top: 8 },
              autoIndent: "full",
              formatOnPaste: true,
              formatOnType: true,
              tabSize: 2,
              insertSpaces: true,
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              renderWhitespace: "selection",
              wordWrap: wordWrap ? "on" : "off",
              smoothScrolling: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
            }}
          />
        )}
        {content !== null && !loading && diffMode && (
          <DiffEditor
            original={originalContent ?? ""}
            modified={content}
            language={language}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              fontSize: 13,
              fontFamily: "IBM Plex Mono, Cascadia Code, monospace",
              lineHeight: 20,
              minimap: { enabled: minimapEnabled },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              overviewRulerLanes: 0,
            }}
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("aether-theme", {
                base: light ? "vs" : "vs-dark",
                inherit: true,
                rules: [],
                colors: editorColors,
              });
              monaco.editor.setTheme("aether-theme");
            }}
            onMount={(editor) => {
              // Click in glyph margin to add comment
              const modifiedEditor = editor.getModifiedEditor();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              modifiedEditor.onMouseDown((e: any) => {
                if (e.target.type === 2 && e.target.position) { // GLYPH_MARGIN
                  setCommentLine(e.target.position.lineNumber);
                  setCommentText("");
                }
              });
            }}
          />
        )}
        {/* Inline diff comment input */}
        {diffMode && commentLine !== null && (
          <DiffCommentInput
            filePath={filePath}
            lineNumber={commentLine}
            content={content}
            commentText={commentText}
            onChangeText={setCommentText}
            onSubmit={(prompt, comment) => {
              onStartAgent?.(prompt);
              setDiffComments((prev) => [...prev, { lineNumber: commentLine!, comment, status: "fixing" }]);
              setCommentLine(null);
              setCommentText("");
            }}
            onCancel={() => { setCommentLine(null); setCommentText(""); }}
          />
        )}
        {/* Comment badges */}
        {diffMode && diffComments.length > 0 && (
          <div className={styles.commentBadges}>
            {diffComments.map((c, i) => (
              <span key={i} className={styles.commentBadge} data-status={c.status} title={c.comment}>
                L{c.lineNumber}: {c.status === "fixing" ? "🔧" : c.status === "resolved" ? "✓" : "💬"} {c.comment.slice(0, 30)}
              </span>
            ))}
          </div>
        )}
      </div>
      <EditorStatusBar
        line={cursorPos.line}
        column={cursorPos.column}
        language={language}
        tabSize={tabSize}
        minimapEnabled={minimapEnabled}
        wordWrap={wordWrap}
        saved={saved}
        onToggleMinimap={() => {
          setMinimapEnabled((v) => !v);
          editorRef.current?.updateOptions({ minimap: { enabled: !minimapEnabled } });
        }}
        onToggleWordWrap={() => {
          const next = !wordWrap;
          setWordWrap(next);
          editorRef.current?.updateOptions({ wordWrap: next ? "on" : "off" });
        }}
      />
      {vimMode && <div id="vim-statusbar" className={styles.vimStatus} />}
    </div>
  );
}

