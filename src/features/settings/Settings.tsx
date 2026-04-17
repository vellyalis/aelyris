import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "../../shared/store/appStore";
import styles from "./Settings.module.css";

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
}

const THEMES = [
  { id: "aether-dark", label: "Aether Dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { id: "catppuccin-latte", label: "Catppuccin Latte (Light)" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "dracula", label: "Dracula" },
];

const FONTS = [
  "IBM Plex Mono",
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "Consolas",
];

const SHELLS = [
  { id: "powershell", label: "PowerShell" },
  { id: "cmd", label: "CMD" },
  { id: "gitbash", label: "Git Bash" },
  { id: "wsl", label: "WSL" },
];

export function Settings({ visible, onClose }: SettingsProps) {
  const { themeId: storeTheme, setThemeId } = useAppStore();
  const [theme, setTheme] = useState(storeTheme);
  const [font, setFont] = useState("IBM Plex Mono");
  const [fontSize, setFontSize] = useState(14);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [ligatures, setLigatures] = useState(true);
  const [defaultShell, setDefaultShell] = useState("powershell");
  const [cursorStyle, setCursorStyle] = useState("bar");
  const [cursorBlink, setCursorBlink] = useState(true);

  useEffect(() => {
    invoke<{ appearance: { theme: string; terminal_font_family: string; font_size: number; line_height: number; ligatures: boolean }; terminal: { default_shell: string; cursor_style: string; cursor_blink: boolean } }>("load_app_config")
      .then((cfg) => {
        setTheme(cfg.appearance.theme);
        setFont(cfg.appearance.terminal_font_family.split(",")[0].trim());
        setFontSize(cfg.appearance.font_size);
        setLineHeight(cfg.appearance.line_height);
        setLigatures(cfg.appearance.ligatures);
        setDefaultShell(cfg.terminal.default_shell);
        setCursorStyle(cfg.terminal.cursor_style);
        setCursorBlink(cfg.terminal.cursor_blink);
      })
      .catch(() => {});
  }, []);

  const handleSave = () => {
    setThemeId(theme);
    invoke("save_app_config", {
      config: {
        appearance: { theme, ui_font_family: "IBM Plex Sans", terminal_font_family: font, font_size: fontSize, line_height: lineHeight, ligatures, window_effect: "mica", opacity: 0.95 },
        terminal: { default_shell: defaultShell, scrollback: 10000, cursor_style: cursorStyle, cursor_blink: cursorBlink },
      },
    }).catch(() => {});
    onClose();
  };

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.overlay}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <motion.div
            className={styles.panel}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <div className={styles.header}>
              <h2 className={styles.title}>Settings</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button className={styles.saveBtn} onClick={handleSave}>Save</button>
                <button className={styles.closeBtn} aria-label="Close" onClick={onClose}>×</button>
              </div>
            </div>

            <div className={styles.content}>
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Appearance</h3>
                <div className={styles.field}>
                  <label className={styles.label}>Theme</label>
                  <select className={styles.select} value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Terminal Font</label>
                  <select className={styles.select} value={font} onChange={(e) => setFont(e.target.value)}>
                    {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Font Size</label>
                    <input type="number" className={styles.input} value={fontSize} min={10} max={24} onChange={(e) => setFontSize(Number(e.target.value))} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Line Height</label>
                    <input type="number" className={styles.input} value={lineHeight} min={1} max={2} step={0.1} onChange={(e) => setLineHeight(Number(e.target.value))} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={ligatures} onChange={(e) => setLigatures(e.target.checked)} />
                    <span>Font Ligatures</span>
                  </label>
                </div>
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Terminal</h3>
                <div className={styles.field}>
                  <label className={styles.label}>Default Shell</label>
                  <select className={styles.select} value={defaultShell} onChange={(e) => setDefaultShell(e.target.value)}>
                    {SHELLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Cursor Style</label>
                  <select className={styles.select} value={cursorStyle} onChange={(e) => setCursorStyle(e.target.value)}>
                    <option value="bar">Bar</option>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={cursorBlink} onChange={(e) => setCursorBlink(e.target.checked)} />
                    <span>Cursor Blink</span>
                  </label>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Renderer</label>
                  <select className={styles.select} value={localStorage.getItem("aether:renderer") ?? "xterm"} onChange={(e) => { localStorage.setItem("aether:renderer", e.target.value); window.dispatchEvent(new StorageEvent("storage")); }}>
                    <option value="xterm">xterm.js (stable)</option>
                    <option value="wgpu">GPU Canvas (experimental)</option>
                    <option value="native">Native Rust engine (Phase 2, experimental)</option>
                  </select>
                  <span className={styles.hint}>Native engine requires `AETHER_TERM_NATIVE=1` on the backend. Renderer change applies to newly opened terminals.</span>
                </div>
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
                <div className={styles.shortcutList}>
                  {[
                    ["Command Palette", "Ctrl+Shift+P"],
                    ["New Terminal", "Ctrl+Shift+T"],
                    ["Close Terminal Tab", "Ctrl+Shift+W"],
                    ["New File", "Ctrl+N"],
                    ["Close Editor", "Ctrl+W"],
                    ["Save", "Ctrl+S"],
                    ["Find in File", "Ctrl+F"],
                    ["Replace", "Ctrl+H"],
                    ["Go to Line", "Ctrl+G"],
                    ["Search in Files", "Ctrl+Shift+F"],
                    ["Open Folder", "Ctrl+Shift+O"],
                    ["Explorer Focus", "Ctrl+Shift+E"],
                    ["Start Agent", "Ctrl+Shift+A"],
                    ["Split Horizontal", "Ctrl+Shift+H"],
                    ["Split Vertical", "Ctrl+Shift+V"],
                    ["Session Jump", "Ctrl+0-9"],
                    ["Prev/Next Session", "Ctrl+[ / ]"],
                    ["Settings", "Ctrl+,"],
                  ].map(([action, key]) => (
                    <div key={action} className={styles.shortcutRow}>
                      <span>{action}</span>
                      <kbd className={styles.kbd}>{key}</kbd>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
