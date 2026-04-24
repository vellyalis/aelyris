import styles from "./EditorPanel.module.css";

// Sandboxed iframes do not inherit the parent's CSS variables, so these
// values are resolved at author time from the design tokens in
// `src/styles/global.css`. Keep in sync with:
//   --font-ui / --font-mono, --text-primary, --text-secondary, --gold,
//   --ctp-blue, --white-4/6/10, --radius, --radius-sm, --space-*.
const FONT_UI_STACK = "'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif";
const FONT_MONO_STACK = "'IBM Plex Mono', 'Cascadia Code', Consolas, monospace";

interface MarkdownPreviewProps {
  html: string;
}

export function MarkdownPreview({ html }: MarkdownPreviewProps) {
  const srcdoc = `<!DOCTYPE html>
<html><head><style>
  body { font-family: ${FONT_UI_STACK}; color: rgba(255,255,255,0.88); background: transparent; padding: 16px; margin: 0; line-height: 1.5; font-size: 13px; }
  h1,h2,h3,h4 { color: #c8a050; margin-top: 1.2em; letter-spacing: -0.01em; }
  a { color: #89b4fa; }
  code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: ${FONT_MONO_STACK}; font-size: 0.9em; }
  pre { background: rgba(255,255,255,0.04); padding: 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #c8a050; margin-left: 0; padding-left: 12px; color: rgba(255,255,255,0.5); }
  table { border-collapse: collapse; width: 100%; }
  th,td { border: 1px solid rgba(255,255,255,0.1); padding: 6px 10px; text-align: left; }
  th { background: rgba(255,255,255,0.04); color: #c8a050; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); }
</style></head><body>${html}</body></html>`;

  return <iframe className={styles.mdPreview} srcDoc={srcdoc} sandbox="allow-same-origin" title="Markdown Preview" />;
}
