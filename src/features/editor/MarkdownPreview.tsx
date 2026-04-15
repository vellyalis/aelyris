import styles from "./EditorPanel.module.css";

interface MarkdownPreviewProps {
  html: string;
}

export function MarkdownPreview({ html }: MarkdownPreviewProps) {
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
