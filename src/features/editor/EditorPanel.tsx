import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import { EditorStatusBar } from "./EditorStatusBar";
import { useAppStore } from "../../shared/store/appStore";
import { getPalette, isLightTheme, monacoThemeColors } from "../../shared/themes/catppuccin";
import { useLsp, registerLspProviders } from "./lsp";
import { toast } from "../../shared/store/toastStore";
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
      <EditorBreadcrumb filePath={filePath} projectPath={projectPath} />
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
              editorRef.current = editor;
              editor.onDidChangeCursorPosition((e) => {
                setCursorPos({ line: e.position.lineNumber, column: e.position.column });
              });
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

/**
 * Renders DOMPurify-sanitized markdown HTML in a sandboxed iframe.
 * Content is pre-sanitized via DOMPurify before reaching this component.
 */
function buildCommentPrompt(filePath: string | null, lineNumber: number, content: string | null, comment: string): string {
  const lines = (content ?? "").split("\n");
  const context = lines.slice(Math.max(0, lineNumber - 3), lineNumber + 2).join("\n");
  return `File: ${filePath}, Line ${lineNumber}\n\nContext:\n${context}\n\nFeedback: ${comment}\n\nPlease fix this issue.`;
}

function DiffCommentInput({ filePath, lineNumber, content, commentText, onChangeText, onSubmit, onCancel }: {
  filePath: string | null;
  lineNumber: number;
  content: string | null;
  commentText: string;
  onChangeText: (t: string) => void;
  onSubmit: (prompt: string, comment: string) => void;
  onCancel: () => void;
}) {
  const submit = () => {
    if (!commentText.trim()) return;
    onSubmit(buildCommentPrompt(filePath, lineNumber, content, commentText.trim()), commentText.trim());
  };
  return (
    <div className={styles.commentOverlay}>
      <div className={styles.commentBox}>
        <span className={styles.commentLabel}>Line {lineNumber} — feedback for agent:</span>
        <textarea
          autoFocus className={styles.commentInput} placeholder="Describe what to fix..."
          value={commentText} onChange={(e) => onChangeText(e.target.value)} rows={2}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className={styles.commentActions}>
          <button className={styles.commentSend} onClick={submit}>Send to Agent (Ctrl+Enter)</button>
          <button className={styles.commentCancel} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function MarkdownPreview({ html }: { html: string }) {
  const srcdoc = `<!DOCTYPE html>
<html><head><style>
  body { font-family: 'IBM Plex Sans', sans-serif; color: #cdd6f4; background: transparent; padding: 16px; margin: 0; line-height: 1.6; }
  h1,h2,h3,h4 { color: #c8a050; margin-top: 1.2em; }
  a { color: #89b4fa; }
  code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: 'IBM Plex Mono', monospace; font-size: 0.9em; }
  pre { background: rgba(255,255,255,0.04); padding: 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #c8a050; margin-left: 0; padding-left: 12px; color: rgba(255,255,255,0.5); }
  table { border-collapse: collapse; width: 100%; }
  th,td { border: 1px solid rgba(255,255,255,0.1); padding: 6px 10px; text-align: left; }
  th { background: rgba(255,255,255,0.04); color: #c8a050; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      className={styles.mdPreview}
      srcDoc={srcdoc}
      sandbox="allow-same-origin"
      title="Markdown Preview"
    />
  );
}
