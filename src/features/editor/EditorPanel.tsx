import Editor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { Check, MessageSquare, Wrench } from "lucide-react";
import { marked } from "marked";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { markBootOnce } from "../../shared/lib/bootMetrics";
import { getMonoFontStack } from "../../shared/lib/fontStack";
import { useAppStore } from "../../shared/store/appStore";
import { toast } from "../../shared/store/toastStore";
import { getPalette, isLightTheme, monacoThemeColors } from "../../shared/themes/catppuccin";
import { EmptyState } from "../../shared/ui/EmptyState";
import { DiffCommentInput } from "./DiffCommentInput";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import styles from "./EditorPanel.module.css";
import { EditorStatusBar } from "./EditorStatusBar";
import type { LineRange } from "./ghostConflict";
import type { GhostEditor, MonacoNs } from "./ghostPaint";
import { registerLspProviders, useLsp } from "./lsp";
import { toMonacoModelUri } from "./lsp/lspUri";
import { MarkdownPreview } from "./MarkdownPreview";
import { useGhostPaintForFile } from "./useGhostPaintForFile";

const DiffViewer = lazy(() => import("../diff-viewer/DiffViewer").then((m) => ({ default: m.DiffViewer })));

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
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  rs: "rust",
  toml: "toml",
  css: "css",
  scss: "scss",
  html: "html",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  sh: "shell",
  bash: "shell",
  sql: "sql",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

export function EditorPanel({
  filePath,
  onClose,
  projectPath,
  initialLine,
  initialDiffMode,
  onStartAgent,
}: EditorPanelProps) {
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
    return () => {
      lspDispose.current?.();
    };
  }, []);
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimRef = useRef<{ dispose: () => void } | null>(null);
  // Tracks the live filePath so the async Ctrl+S handler can detect when
  // the user switched files between hitting save and the write resolving —
  // without this guard, the post-save setContent would overwrite the new
  // file's state with the previous file's value.
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  // Pinned timeout id for the saved-pill clear. Without this ref the
  // 2 s setTimeout from a save that fires right before unmount would
  // call setSaved(false) on an unmounted component — visible as the
  // React "state on unmounted component" warning.
  const savedPillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the panel is still mounted. The async write_file
  // .then arm gates state mutations on this — without it, the
  // filePathRef-only check still allows post-unmount setState (e.g.
  // user closes the file mid-save: filePathRef.current happens to
  // equal savedFilePath until React tears down, and the timeout would
  // re-arm afterward).
  //
  // Use useLayoutEffect, not useEffect, so the cleanup runs
  // synchronously during the unmount commit phase — passive useEffect
  // cleanups can run after a settled write_file promise has already
  // entered its .then arm, which means a stale `mountedRef.current ===
  // true` check could let post-unmount setState slip through.
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedPillTimerRef.current !== null) {
        clearTimeout(savedPillTimerRef.current);
        savedPillTimerRef.current = null;
      }
    };
  }, []);

  // Ghost paint wiring — editor + monaco need to become state so the hook
  // re-runs once onMount hands them over. Reset to null whenever filePath
  // changes so stale editor references never reach the painter.
  const [ghostEditor, setGhostEditor] = useState<GhostEditor | null>(null);
  const [ghostMonaco, setGhostMonaco] = useState<MonacoNs | null>(null);
  const modelChangeSubscribersRef = useRef<Set<(ranges: LineRange[]) => void>>(new Set());
  const subscribeToModelChanges = useCallback((listener: (ranges: LineRange[]) => void) => {
    modelChangeSubscribersRef.current.add(listener);
    return () => {
      modelChangeSubscribersRef.current.delete(listener);
    };
  }, []);
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
    ghostHunkKeyRef.current?.set(ghostPaint.hasHunkAtLine(cursorPos.line));
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
    } catch {
      /* monaco-vim not available */
    }
  }, [vimMode]);

  const toggleDiff = useCallback(async () => {
    if (diffMode) {
      setDiffMode(false);
      return;
    }
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
            if (!cancelled) {
              setOriginalContent(orig);
              setDiffMode(true);
            }
          } catch {
            if (!cancelled) {
              setOriginalContent("");
              setDiffMode(true);
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
      } catch {
        /* file may have been deleted */
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath, content, modified]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s" && filePath && editorRef.current) {
        e.preventDefault();
        // Snapshot filePath at click time. The .then below gates panel-state
        // mutations on `filePathRef.current === savedFilePath` so a save
        // that resolves after the user switches files writes only the
        // success toast, not the previous file's value into the new file's
        // state.
        const savedFilePath = filePath;
        const value = editorRef.current.getValue();
        invoke("write_file", { path: savedFilePath, content: value })
          .then(() => {
            // Gate panel-state mutations on BOTH "still mounted" and
            // "still on the same file" — the filePath check alone does
            // not block post-unmount setState, since filePathRef stays
            // pointing at the last seen value when the panel tears down.
            const stillCurrent = mountedRef.current && filePathRef.current === savedFilePath;
            if (stillCurrent) {
              // Sync content state to the just-saved value. Without this,
              // the window-focus reload effect below sees diskContent !==
              // content (content is the stale initial-load value) and
              // overwrites the editor with setValue(diskContent), which
              // fires onChange and re-marks the file dirty — even though
              // nothing changed.
              setContent(value);
              setModified(false);
              setSaved(true);
              if (savedPillTimerRef.current !== null) {
                clearTimeout(savedPillTimerRef.current);
              }
              savedPillTimerRef.current = setTimeout(() => {
                setSaved(false);
                savedPillTimerRef.current = null;
              }, 2000);
            }
            // markSaved + toast are filePath-scoped and safe to call
            // unconditionally — they affect the saved file's bookkeeping,
            // not the currently-open one.
            markSaved(savedFilePath);
            toast.success("Saved", savedFilePath.split(/[/\\]/).pop() ?? savedFilePath);
          })
          .catch((err) => {
            // Only mutate panel error state when the panel is still
            // mounted AND the failed save belongs to the file currently
            // on screen — otherwise the error banner would attach to
            // whatever file the user moved to (or to nothing, post-unmount).
            if (mountedRef.current && filePathRef.current === savedFilePath) {
              setError(String(err));
            }
            toast.error("Save failed", String(err));
          });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filePath]);

  const fileName = filePath ? (filePath.split("/").pop() ?? filePath) : "";
  const language = filePath ? detectLanguage(filePath) : "plaintext";
  const isMarkdown = language === "markdown";

  const renderedHtml = useMemo(() => {
    if (!isMarkdown || !previewMode || content === null) return "";
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [isMarkdown, previewMode, content]);

  const monoFontStack = useMemo(() => getMonoFontStack(), []);

  // Pre-formed `file://` URI used as Monaco's model URI. Without this
  // Monaco generates a synthetic `inmemory://model/N` URI for the model,
  // while LSP `textDocument/didOpen` is dispatched with `file:///<path>` —
  // the URIs never match, so rust-analyzer / pyright return zero
  // completions and hovers. The same helper feeds notifyOpen below so
  // both sides converge on a single canonical URI.
  const monacoModelPath = useMemo(
    () => (filePath ? toMonacoModelUri(filePath) : undefined),
    [filePath],
  );

  if (!filePath) {
    return (
      <div className={styles.panel}>
        <div className={styles.body}>
          <EmptyState
            preset="files"
            title="No file open"
            description="Select a file from the tree or press Ctrl+P to open one."
          />
        </div>
      </div>
    );
  }

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
        <button className={styles.diffBtn} onClick={toggleVim} title="Toggle Vim mode">
          {vimMode ? "Vim ✓" : "Vim"}
        </button>
        <button className={styles.diffBtn} onClick={toggleDiff} title="Toggle diff">
          {diffMode ? "Editor" : "Diff"}
        </button>
        <button className={styles.closeBtn} onClick={onClose}>
          ×
        </button>
      </div>
      <div className={styles.body}>
        {loading && <div className={styles.status}>Loading...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {content !== null && !loading && previewMode && isMarkdown && <MarkdownPreview html={renderedHtml} />}
        {content !== null && !loading && !diffMode && !previewMode && (
          <Editor
            key={filePath}
            path={monacoModelPath}
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
              const ghostHunkKey = editor.createContextKey<boolean>("aetherGhostHunkAtCursor", false);
              const ghostInFileKey = editor.createContextKey<boolean>("aetherGhostInFile", false);
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
                // Read the URI back from Monaco itself so both this
                // dispatch and the completion provider's
                // `model.uri.toString()` see the identical canonical
                // string. Our `toMonacoModelUri` helper produces a
                // valid `file://` input for Monaco's parser, but
                // Monaco may re-encode on round-trip (drive-letter
                // casing, reserved characters our helper doesn't
                // touch like `&` / `+`, non-ASCII) and the helper's
                // raw output would diverge from `model.uri.toString()`.
                //
                // The `filePath` check is defensive — the panel's
                // early-return at the top of render guarantees onMount
                // never fires without a filePath today, but if a
                // future patch ever decouples the Editor mount from
                // that guard, the stale model URI would otherwise
                // leak through to the LSP server.
                if (filePath && content !== null) {
                  const modelUri = editor.getModel()?.uri.toString();
                  if (modelUri) {
                    lsp.notifyOpen(modelUri, currentLanguage, content);
                  }
                }
              }
            }}
            onChange={() => {
              setModified(true);
              if (filePath) markUnsaved(filePath);
            }}
            options={{
              fontSize: 13,
              fontFamily: monoFontStack,
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
          <Suspense fallback={<div className={styles.status}>Loading diff...</div>}>
            <DiffViewer
              original={originalContent ?? ""}
              modified={content}
              language={language}
              fileName={fileName}
              onGlyphMarginClick={(line) => {
                setCommentLine(line);
                setCommentText("");
              }}
            />
          </Suspense>
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
            onCancel={() => {
              setCommentLine(null);
              setCommentText("");
            }}
          />
        )}
        {/* Comment badges */}
        {diffMode && diffComments.length > 0 && (
          <div className={styles.commentBadges}>
            {diffComments.map((c, i) => {
              const Icon = c.status === "fixing" ? Wrench : c.status === "resolved" ? Check : MessageSquare;
              return (
                <span key={i} className={styles.commentBadge} data-status={c.status} title={c.comment}>
                  <Icon size={10} strokeWidth={1.75} aria-hidden="true" />L{c.lineNumber}: {c.comment.slice(0, 30)}
                </span>
              );
            })}
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
