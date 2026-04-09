import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import styles from "./Settings.module.css";

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
}

const THEMES = [
  { id: "aether-dark", label: "Aether Dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
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
  const [theme, setTheme] = useState("aether-dark");
  const [font, setFont] = useState("IBM Plex Mono");
  const [fontSize, setFontSize] = useState(14);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [ligatures, setLigatures] = useState(true);
  const [defaultShell, setDefaultShell] = useState("powershell");
  const [cursorStyle, setCursorStyle] = useState("bar");
  const [cursorBlink, setCursorBlink] = useState(true);

  return (
    <AnimatePresence>
    {visible && (
    <motion.div className={styles.overlay} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <motion.div className={styles.panel} onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.content}>
          {/* Appearance */}
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
                <input
                  type="number"
                  className={styles.input}
                  value={fontSize}
                  min={10}
                  max={24}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Line Height</label>
                <input
                  type="number"
                  className={styles.input}
                  value={lineHeight}
                  min={1}
                  max={2}
                  step={0.1}
                  onChange={(e) => setLineHeight(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.toggle}>
                <input type="checkbox" checked={ligatures} onChange={(e) => setLigatures(e.target.checked)} />
                <span>Font Ligatures</span>
              </label>
            </div>
          </section>

          {/* Terminal */}
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
          </section>

          {/* Keyboard Shortcuts */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
            <div className={styles.shortcutList}>
              {[
                ["Command Palette", "Ctrl+Shift+P"],
                ["New Tab", "Ctrl+Shift+T"],
                ["Close Tab", "Ctrl+Shift+W"],
                ["Toggle Sidebar", "Ctrl+B"],
                ["Toggle Inspector", "Ctrl+Shift+I"],
                ["Split Horizontal", "Ctrl+Shift+H"],
                ["Split Vertical", "Ctrl+Shift+V"],
                ["Search", "Ctrl+F"],
                ["Search in Files", "Ctrl+Shift+F"],
                ["New File", "Ctrl+N"],
                ["Close Editor", "Ctrl+W"],
                ["Open Folder", "Ctrl+Shift+O"],
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
