import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Select } from "../../shared/ui/Select";
import { useAppStore } from "../../shared/store/appStore";
import { toast } from "../../shared/store/toastStore";
import { Switch } from "../../shared/ui/Switch";
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

// Mirror of Rust `AppConfig` in src-tauri/src/config/settings.rs. Holding the
// full shape lets `handleSave` round-trip every field — even the ones the UI
// can't edit (window state, ui_font_family, opacity, scrollback…) — instead
// of resetting them to default whenever the user clicks Save.
interface LoadedConfig {
  appearance: {
    theme: string;
    ui_font_family: string;
    terminal_font_family: string;
    font_size: number;
    line_height: number;
    ligatures: boolean;
    window_effect: string;
    opacity: number;
  };
  terminal: {
    default_shell: string;
    scrollback: number;
    cursor_style: string;
    cursor_blink: boolean;
  };
  window?: {
    width: number;
    height: number;
    x?: number | null;
    y?: number | null;
    maximized: boolean;
    sidebar_visible: boolean;
    last_directory?: string | null;
    tab_count: number;
  };
  ghost_diff?: {
    live_mode?: boolean;
  };
}

export function Settings({ visible, onClose }: SettingsProps) {
  const storeTheme = useAppStore((s) => s.themeId);
  const setThemeId = useAppStore((s) => s.setThemeId);
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
  // Keep the full config snapshot so Save can round-trip fields the UI can't
  // edit (window state, ui_font_family, opacity, scrollback). Without this,
  // every Save click resets those fields to the Rust defaults.
  const [loadedConfig, setLoadedConfig] = useState<LoadedConfig | null>(null);

  useEffect(() => {
    // Re-load every time the dialog opens so a user who edited config.toml
    // directly between sessions doesn't have their changes overwritten by
    // the previous mount's stale state when they click Save.
    if (!visible) return;
    let cancelled = false;
    invoke<LoadedConfig>("load_app_config")
      .then((cfg) => {
        if (cancelled) return;
        setLoadedConfig(cfg);
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
    return () => {
      cancelled = true;
    };
  }, [visible, setGhostDiffLiveMode]);

  const handleSave = () => {
    if (!loadedConfig) {
      // Open and immediately close before the load resolves — preserve disk
      // contents by skipping save entirely rather than writing UI defaults.
      onClose();
      return;
    }
    setThemeId(theme);
    setGhostDiffLiveMode(liveMode);
    const merged: LoadedConfig = {
      ...loadedConfig,
      appearance: {
        ...loadedConfig.appearance,
        theme,
        terminal_font_family: font,
        font_size: fontSize,
        line_height: lineHeight,
        ligatures,
      },
      terminal: {
        ...loadedConfig.terminal,
        default_shell: defaultShell,
        cursor_style: cursorStyle,
        cursor_blink: cursorBlink,
      },
      ghost_diff: {
        ...(loadedConfig.ghost_diff ?? {}),
        live_mode: liveMode,
      },
    };
    invoke("save_app_config", { config: merged })
      .then(() => onClose())
      .catch((err) => {
        // Surface failure instead of swallowing — user otherwise sees the
        // dialog close with no indication that disk write failed.
        toast.error("Failed to save settings", String(err));
      });
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
                <label className={styles.label} htmlFor="settings-theme">
                  Theme
                </label>
                <Select
                  id="settings-theme"
                  value={theme}
                  onValueChange={(next) => {
                    setTheme(next);
                    // Apply immediately so the palette editor below targets
                    // the live theme (the running window is the preview).
                    setThemeId(next);
                  }}
                  options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
                  ariaLabel="Theme"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Palette</label>
                <ThemePaletteEditor themeId={theme} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-font">
                  Terminal Font
                </label>
                <Select
                  id="settings-font"
                  value={font}
                  onValueChange={setFont}
                  options={FONTS.map((f) => ({ value: f, label: f }))}
                  ariaLabel="Terminal font"
                />
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-font-size">
                    Font Size
                  </label>
                  <input
                    id="settings-font-size"
                    type="number"
                    className={styles.input}
                    value={fontSize}
                    min={10}
                    max={24}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-line-height">
                    Line Height
                  </label>
                  <input
                    id="settings-line-height"
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
                <Switch
                  id="settings-ligatures"
                  label="Font Ligatures"
                  checked={ligatures}
                  onCheckedChange={setLigatures}
                />
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Terminal</h3>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-default-shell">
                  Default Shell
                </label>
                <Select
                  id="settings-default-shell"
                  value={defaultShell}
                  onValueChange={setDefaultShell}
                  options={SHELLS.map((s) => ({ value: s.id, label: s.label }))}
                  ariaLabel="Default shell"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-cursor-style">
                  Cursor Style
                </label>
                <Select
                  id="settings-cursor-style"
                  value={cursorStyle}
                  onValueChange={setCursorStyle}
                  options={[
                    { value: "bar", label: "Bar" },
                    { value: "block", label: "Block" },
                    { value: "underline", label: "Underline" },
                  ]}
                  ariaLabel="Cursor style"
                />
              </div>
              <div className={styles.field}>
                <Switch
                  id="settings-cursor-blink"
                  label="Cursor Blink"
                  checked={cursorBlink}
                  onCheckedChange={setCursorBlink}
                />
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
                <Switch
                  id="settings-ghost-live"
                  label="Live mode (paint in-progress layers)"
                  hint="When off, ghost paint appears only after the agent run finishes. When on, every fs change from the agent's worktree streams into the editor as it happens."
                  checked={liveMode}
                  onCheckedChange={setLiveMode}
                />
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
