import { useEffect, useState, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./EditorPanel.module.css";

interface EditorPanelProps {
  filePath: string | null;
  onClose: () => void;
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

export function EditorPanel({ filePath, onClose }: EditorPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    setModified(false);
    invoke<string>("read_file", { path: filePath })
      .then((data) => { setContent(data); setLoading(false); })
      .catch((err) => { setError(String(err)); setLoading(false); });
  }, [filePath]);

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s" && filePath && editorRef.current) {
        e.preventDefault();
        const value = editorRef.current.getValue();
        invoke("write_file", { path: filePath, content: value })
          .then(() => setModified(false))
          .catch((err) => setError(String(err)));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filePath]);

  if (!filePath) return null;

  const fileName = filePath.split("/").pop() ?? filePath;
  const language = detectLanguage(filePath);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.fileName}>
          {modified && <span className={styles.modDot}>●</span>}
          {fileName}
        </span>
        <span className={styles.lang}>{language}</span>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>
      <div className={styles.body}>
        {loading && <div className={styles.status}>Loading...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {content !== null && !loading && (
          <Editor
            defaultValue={content}
            language={language}
            theme="vs-dark"
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monaco.editor.defineTheme("aether-dark", {
                base: "vs-dark",
                inherit: true,
                rules: [],
                colors: {
                  "editor.background": "#0d0d0d",
                  "editorLineNumber.foreground": "#444444",
                  "editorLineNumber.activeForeground": "#888888",
                  "editor.selectionBackground": "#c8a05030",
                  "editorGutter.background": "#0d0d0d",
                },
              });
              monaco.editor.setTheme("aether-dark");
              editor.focus();
            }}
            onChange={() => setModified(true)}
            options={{
              fontSize: 13,
              fontFamily: "IBM Plex Mono, Cascadia Code, monospace",
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              overviewRulerLanes: 0,
              scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
}
