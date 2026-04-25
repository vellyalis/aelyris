import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useAppStore } from "../../shared/store/appStore";
import styles from "./Settings.module.css";
import { ShellIntegrationSection } from "./ShellIntegrationSection";
import { ThemePaletteEditor } from "./ThemePaletteEditor";
import { UpdateCheckSection } from "./UpdateCheckSection";

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

const FONTS = ["IBM Plex Mono", "Cascadia Code", "JetBrains Mono", "Fira Code", "Consolas"];

const SHELLS = [
  { id: "powershell", label: "PowerShell" },
  { id: "cmd", label: "CMD" },
  { id: "gitbash", label: "Git Bash" },
  { id: "wsl", label: "WSL" },
];

interface LoadedConfig {
  appearance: {
    theme: string;
    terminal_font_family: string;
    font_size: number;
    line_height: number;
    ligatures: boolean;
  };
  terminal: {
    default_shell: string;
    cursor_style: string;
    cursor_blink: boolean;
  };
  ghost_diff?: {
    live_mode?: boolean;
  };
}

export function Settings({ visible, onClose }: SettingsProps) {
  const { themeId: storeTheme, setThemeId } = useAppStore();
  const ghostDiffLiveMode = useAppStore((s) => s.ghostDiffLiveMode);
  const setGhostDiffLiveMode = useAppStore((s) => s.setGhostDiffLiveMode);
  const [theme, setTheme] = useState(storeTheme);
  const [font, setFont] = useState("IBM Plex Mono");
  const [fontSize, setFontSize] = useState(14);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [ligatures, setLigatures] = useState(true);
  const [defaultShell, setDefaultShell] = useState("powershell");
  const [cursorStyle, setCursorStyle] = useState("bar");
  const [cursorBlink, setCursorBlink] = useState(true);
  const [liveMode, setLiveMode] = useState(ghostDiffLiveMode);

  useEffect(() => {
    invoke<LoadedConfig>("load_app_config")
      .then((cfg) => {
        setTheme(cfg.appearance.theme);
        setFont(cfg.appearance.terminal_font_family.split(",")[0].trim());
        setFontSize(cfg.appearance.font_size);
        setLineHeight(cfg.appearance.line_height);
        setLigatures(cfg.appearance.ligatures);
        setDefaultShell(cfg.terminal.default_shell);
        setCursorStyle(cfg.terminal.cursor_style);
        setCursorBlink(cfg.terminal.cursor_blink);
        // Rehydrate from disk so config.toml is the source of truth — this
        // corrects the localStorage bootstrap value if the user edited the
        // file directly.
        const persisted = cfg.ghost_diff?.live_mode ?? false;
        setLiveMode(persisted);
        setGhostDiffLiveMode(persisted);
      })
      .catch(() => {});
  }, [setGhostDiffLiveMode]);

  const handleSave = () => {
    setThemeId(theme);
    setGhostDiffLiveMode(liveMode);
    invoke("save_app_config", {
      config: {
        appearance: {
          theme,
          ui_font_family: "IBM Plex Sans",
          terminal_font_family: font,
          font_size: fontSize,
          line_height: lineHeight,
          ligatures,
          window_effect: "mica",
          opacity: 0.95,
        },
        terminal: {
          default_shell: defaultShell,
          scrollback: 10000,
          cursor_style: cursorStyle,
          cursor_blink: cursorBlink,
        },
        ghost_diff: { live_mode: liveMode },
      },
    }).catch(() => {});
    onClose();
  };

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>Settings</Dialog.Title>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button type="button" className={styles.saveBtn} onClick={handleSave}>
                Save
              </button>
              <Dialog.Close asChild>
                <button type="button" className={styles.closeBtn} aria-label="Close settings">
                  <span aria-hidden="true">×</span>
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className={styles.content}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Appearance</h3>
              <div className={styles.field}>
                <label className={styles.label}>Theme</label>
                <select
                  className={styles.select}
                  value={theme}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTheme(next);
                    // Apply immediately so the palette editor below targets
                    // the live theme (the running window is the preview).
                    setThemeId(next);
                  }}
                >
                  {THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Palette</label>
                <ThemePaletteEditor themeId={theme} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Terminal Font</label>
                <select className={styles.select} value={font} onChange={(e) => setFont(e.target.value)}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
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

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Terminal</h3>
              <div className={styles.field}>
                <label className={styles.label}>Default Shell</label>
                <select
                  className={styles.select}
                  value={defaultShell}
                  onChange={(e) => setDefaultShell(e.target.value)}
                >
                  {SHELLS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
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

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Updates</h3>
              <UpdateCheckSection />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Shell Integration</h3>
              <p className={styles.hint}>
                Aether parses OSC 133 prompt marks for "jump to previous prompt" and exit-code
                coloring. Install the helper script for your shell to enable these features.
              </p>
              <ShellIntegrationSection />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Ghost Diff Overlay</h3>
              <div className={styles.field}>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
                  <span>Live mode (paint in-progress layers)</span>
                </label>
                <p className={styles.hint}>
                  When off, ghost paint appears only after the agent run finishes. When on, every fs change from the
                  agent's worktree streams into the editor as it happens.
                </p>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
