import type { MoodPresetId } from "./registry";

export const MOOD_SURFACE_CSS_KEYS = [
  "--chrome-frame-bg",
  "--chrome-frame-filter",
  "--chrome-frame-shadow",
  "--chrome-control-hover-bg",
  "--chrome-control-hover-border",
  "--chrome-separator-bg",
  "--statusbar-bg",
  "--statusbar-filter",
  "--statusbar-shadow",
  "--material-panel-filter",
  "--panel-legibility-filter",
  "--panel-text-scrim",
  "--terminal-shell-filter",
  "--material-panel-shadow",
  "--material-card-shadow",
  "--popup-glass-bg",
  "--popup-glass-border",
  "--popup-glass-shadow",
  "--scrim-standard-bg",
  "--scrim-heavy-bg",
  "--dialog-surface",
  "--dialog-surface-blur",
  "--settings-control-bg",
  "--settings-card-bg",
  "--settings-card-bg-hover",
  "--settings-card-bg-active",
  "--toolkit-grid-bg",
  "--toolkit-grid-shadow",
  "--toolkit-tile-bg",
  "--toolkit-tile-primary-bg",
  "--toolkit-tile-hover-bg",
  "--toolkit-tile-text",
  "--toolkit-icon-bg",
  "--toolkit-bottom-bg",
  "--toolkit-bottom-btn-bg",
] as const;

export type MoodSurfaceKey = (typeof MOOD_SURFACE_CSS_KEYS)[number];
export type MoodSurfaceCSS = Record<MoodSurfaceKey, string>;

/**
 * Shared panel-blur filter value used by --material-panel-filter and
 * --terminal-shell-filter across every mood surface variant. Value unchanged
 * from the previous inline "blur(8px)" string literals.
 */
const PANEL_BLUR = "blur(8px)";

/**
 * Stronger frost applied to text-dense panels (left file-tree + right
 * inspector) so a busy / bright wallpaper is blurred and darkened enough for
 * rows to stay readable (Apple "Thick material" sidebar vibrancy). The
 * brightness(<1) darkens the frosted photo; saturate keeps it from going
 * muddy. Shared across dark moods; crystal uses a lighter brightness so its
 * clearer glass stays clear, sakura keeps a near-neutral frost for light mode.
 */
const PANEL_LEGIBILITY_FILTER_DARK = "blur(18px) saturate(1.3) brightness(0.72)";
const PANEL_LEGIBILITY_FILTER_CRYSTAL = "blur(20px) saturate(1.28) brightness(0.82)";
const PANEL_LEGIBILITY_FILTER_LIGHT = "blur(18px) saturate(1.18) brightness(1.02)";

/**
 * Low-alpha legibility scrim composited into the text-dense panel background
 * (above the frosted wallpaper, below the rows). Dark moods use a dark wash so
 * light glyphs lift; sakura (light) uses a WHITE wash so dark ink lifts instead
 * of being darkened. Measured to clear WCAG AA over the bright sakura wallpaper.
 */
const PANEL_TEXT_SCRIM_DARK =
  "linear-gradient(180deg, rgba(3, 9, 16, 0.42), rgba(3, 9, 16, 0.34) 70%, rgba(3, 9, 16, 0.42))";
const PANEL_TEXT_SCRIM_CRYSTAL =
  "linear-gradient(180deg, rgba(2, 10, 20, 0.34), rgba(2, 10, 20, 0.28) 70%, rgba(2, 10, 20, 0.34))";
const PANEL_TEXT_SCRIM_LIGHT =
  "linear-gradient(180deg, rgba(255, 252, 254, 0.4), rgba(255, 250, 253, 0.32) 70%, rgba(255, 252, 254, 0.4))";

function darkMoodSurfaces(tone: {
  shell: string;
  panel: string;
  panelStrong: string;
  accent: string;
  gold: string;
  text: string;
}): MoodSurfaceCSS {
  return {
    "--chrome-frame-bg": `linear-gradient(180deg, rgba(${tone.accent}, 0.026), transparent 72%), linear-gradient(90deg, rgba(${tone.accent}, 0.022), transparent 36%, transparent 66%, rgba(${tone.gold}, 0.012)), rgba(${tone.shell}, 0.28)`,
    "--chrome-frame-filter": "blur(14px) saturate(1.12) brightness(0.82) contrast(1.1)",
    "--chrome-frame-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.08), inset 0 -1px 0 rgba(${tone.accent}, 0.08)`,
    "--chrome-control-hover-bg": `rgba(${tone.accent}, 0.095)`,
    "--chrome-control-hover-border": `rgba(${tone.accent}, 0.16)`,
    "--chrome-separator-bg": `linear-gradient(180deg, transparent, rgba(${tone.accent}, 0.18), transparent)`,
    "--statusbar-bg": `rgba(${tone.shell}, 0.26)`,
    "--statusbar-filter": "blur(14px) saturate(1.12) brightness(0.82) contrast(1.08)",
    "--statusbar-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.055), inset 0 -1px 0 rgba(${tone.accent}, 0.07)`,
    "--material-panel-filter": PANEL_BLUR,
    "--panel-legibility-filter": PANEL_LEGIBILITY_FILTER_DARK,
    "--panel-text-scrim": PANEL_TEXT_SCRIM_DARK,
    "--terminal-shell-filter": PANEL_BLUR,
    "--material-panel-shadow": `var(--rim-top), inset 0 0 0 1px rgba(${tone.accent}, 0.055), 0 12px 30px rgba(0, 0, 0, 0.2)`,
    "--material-card-shadow": `var(--rim-top), 0 0 0 1px rgba(${tone.accent}, 0.05), 0 8px 20px rgba(0, 0, 0, 0.18)`,
    "--popup-glass-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.045), transparent 40%), linear-gradient(145deg, rgba(${tone.accent}, 0.04), transparent 52%), rgba(${tone.panelStrong}, 0.52)`,
    "--popup-glass-border": `rgba(${tone.accent}, 0.14)`,
    "--popup-glass-shadow": `var(--rim-top), inset 0 0 0 1px rgba(${tone.accent}, 0.055), 0 16px 38px rgba(0, 0, 0, 0.26)`,
    "--scrim-standard-bg": `linear-gradient(180deg, rgba(0, 0, 0, 0.34), rgba(${tone.shell}, 0.46)), rgba(${tone.shell}, 0.2)`,
    "--scrim-heavy-bg": `linear-gradient(180deg, rgba(0, 0, 0, 0.42), rgba(${tone.shell}, 0.58)), rgba(${tone.shell}, 0.28)`,
    "--dialog-surface": `linear-gradient(180deg, rgba(${tone.text}, 0.045), transparent 32%), linear-gradient(145deg, rgba(${tone.accent}, 0.045), transparent 50%), rgba(${tone.panelStrong}, 0.58)`,
    "--dialog-surface-blur": "blur(20px)",
    "--settings-control-bg": `rgba(${tone.panel}, 0.24)`,
    "--settings-card-bg": `rgba(${tone.panel}, 0.28)`,
    "--settings-card-bg-hover": `rgba(${tone.panelStrong}, 0.38)`,
    "--settings-card-bg-active": `rgba(${tone.panelStrong}, 0.46)`,
    "--toolkit-grid-bg": `linear-gradient(135deg, rgba(${tone.accent}, 0.075), transparent 38%, rgba(${tone.gold}, 0.04)), rgba(${tone.panel}, 0.22)`,
    "--toolkit-grid-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.055), inset 0 -1px 0 rgba(${tone.accent}, 0.06)`,
    "--toolkit-tile-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.035), rgba(${tone.accent}, 0.022)), rgba(${tone.panel}, 0.28)`,
    "--toolkit-tile-primary-bg": `linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 14%, transparent), transparent 46%), rgba(${tone.panelStrong}, 0.34)`,
    "--toolkit-tile-hover-bg": `linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 12%, transparent), transparent 58%), rgba(${tone.panelStrong}, 0.42)`,
    "--toolkit-tile-text": "var(--text-primary)",
    "--toolkit-icon-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.055), rgba(${tone.accent}, 0.035)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(${tone.panelStrong}, 0.38))`,
    "--toolkit-bottom-bg": `linear-gradient(90deg, rgba(${tone.accent}, 0.07), transparent 52%, rgba(${tone.gold}, 0.045)), rgba(${tone.panel}, 0.24)`,
    "--toolkit-bottom-btn-bg": `rgba(${tone.panelStrong}, 0.32)`,
  };
}

function crystalMoodSurfaces(): MoodSurfaceCSS {
  return {
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(225, 247, 255, 0.052), transparent 70%), linear-gradient(90deg, rgba(139, 233, 255, 0.04), transparent 34%, transparent 66%, rgba(216, 247, 255, 0.025)), rgba(2, 10, 20, 0.24)",
    "--chrome-frame-filter": "blur(22px) saturate(1.28) brightness(0.9) contrast(1.08)",
    "--chrome-frame-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.11), inset 0 -1px 0 rgba(139, 233, 255, 0.08)",
    "--chrome-control-hover-bg": "rgba(139, 233, 255, 0.1)",
    "--chrome-control-hover-border": "rgba(139, 233, 255, 0.16)",
    "--chrome-separator-bg": "linear-gradient(180deg, transparent, rgba(139, 233, 255, 0.18), transparent)",
    "--statusbar-bg": "rgba(2, 10, 20, 0.24)",
    "--statusbar-filter": "blur(22px) saturate(1.24) brightness(0.9) contrast(1.08)",
    "--statusbar-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.075), inset 0 -1px 0 rgba(139, 233, 255, 0.06)",
    "--material-panel-filter": PANEL_BLUR,
    "--panel-legibility-filter": PANEL_LEGIBILITY_FILTER_CRYSTAL,
    "--panel-text-scrim": PANEL_TEXT_SCRIM_CRYSTAL,
    "--terminal-shell-filter": PANEL_BLUR,
    "--material-panel-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(139, 233, 255, 0.052), 0 16px 38px rgba(0, 0, 0, 0.16)",
    "--material-card-shadow": "var(--rim-top), 0 0 0 1px rgba(139, 233, 255, 0.055), 0 10px 26px rgba(0, 0, 0, 0.14)",
    "--popup-glass-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.055), transparent 40%), linear-gradient(145deg, rgba(139, 233, 255, 0.045), transparent 52%), rgba(4, 18, 31, 0.5)",
    "--popup-glass-border": "rgba(139, 233, 255, 0.14)",
    "--popup-glass-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(139, 233, 255, 0.06), 0 18px 42px rgba(0, 0, 0, 0.22)",
    "--scrim-standard-bg": "linear-gradient(180deg, rgba(0, 0, 0, 0.3), rgba(2, 10, 20, 0.38)), rgba(2, 10, 20, 0.14)",
    "--scrim-heavy-bg": "linear-gradient(180deg, rgba(0, 0, 0, 0.38), rgba(2, 10, 20, 0.5)), rgba(2, 10, 20, 0.22)",
    "--dialog-surface":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.052), transparent 32%), linear-gradient(145deg, rgba(139, 233, 255, 0.05), transparent 50%), rgba(5, 22, 36, 0.54)",
    "--dialog-surface-blur": "blur(26px)",
    "--settings-control-bg": "rgba(4, 18, 31, 0.36)",
    "--settings-card-bg": "rgba(4, 20, 34, 0.28)",
    "--settings-card-bg-hover": "rgba(6, 28, 45, 0.38)",
    "--settings-card-bg-active": "rgba(7, 34, 54, 0.46)",
    "--toolkit-grid-bg":
      "linear-gradient(135deg, rgba(139, 233, 255, 0.07), transparent 38%, rgba(216, 247, 255, 0.04)), rgba(4, 20, 34, 0.24)",
    "--toolkit-grid-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.07), inset 0 -1px 0 rgba(139, 233, 255, 0.06)",
    "--toolkit-tile-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.04), rgba(139, 233, 255, 0.024)), rgba(4, 20, 34, 0.3)",
    "--toolkit-tile-primary-bg":
      "linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 14%, transparent), transparent 46%), rgba(7, 34, 54, 0.36)",
    "--toolkit-tile-hover-bg":
      "linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 12%, transparent), transparent 58%), rgba(7, 34, 54, 0.44)",
    "--toolkit-tile-text": "var(--text-primary)",
    "--toolkit-icon-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.055), rgba(139, 233, 255, 0.036)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(7, 34, 54, 0.42))",
    "--toolkit-bottom-bg":
      "linear-gradient(90deg, rgba(139, 233, 255, 0.06), transparent 52%, rgba(216, 247, 255, 0.035)), rgba(4, 20, 34, 0.25)",
    "--toolkit-bottom-btn-bg": "rgba(7, 34, 54, 0.34)",
  };
}

export const MOOD_SURFACE_CSS: Record<MoodPresetId, MoodSurfaceCSS> = {
  "aether-sky": darkMoodSurfaces({
    shell: "2, 8, 18",
    panel: "6, 20, 36",
    panelStrong: "8, 27, 50",
    accent: "120, 207, 255",
    gold: "240, 207, 122",
    text: "246, 251, 255",
  }),
  "aether-moonwater": darkMoodSurfaces({
    shell: "0, 8, 22",
    panel: "2, 25, 48",
    panelStrong: "3, 35, 65",
    accent: "82, 215, 255",
    gold: "245, 199, 227",
    text: "246, 253, 255",
  }),
  "aether-crystal": crystalMoodSurfaces(),
  "aether-dream": darkMoodSurfaces({
    shell: "10, 6, 20",
    panel: "34, 25, 50",
    panelStrong: "48, 38, 68",
    accent: "200, 182, 255",
    gold: "255, 217, 150",
    text: "253, 248, 255",
  }),
  "aether-cute": darkMoodSurfaces({
    shell: "3, 13, 13",
    panel: "18, 48, 44",
    panelStrong: "30, 70, 66",
    accent: "114, 240, 220",
    gold: "255, 209, 220",
    text: "246, 255, 253",
  }),
  "aether-sakura": {
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.46), transparent 72%), linear-gradient(90deg, rgba(189, 63, 104, 0.045), transparent 34%, transparent 66%, rgba(252, 201, 185, 0.06)), rgba(255, 238, 247, 0.72)",
    "--chrome-frame-filter": "blur(12px) saturate(1.14) brightness(1.02) contrast(1.02)",
    "--chrome-frame-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.56), inset 0 -1px 0 rgba(130, 49, 73, 0.09)",
    "--chrome-control-hover-bg": "rgba(189, 63, 104, 0.1)",
    "--chrome-control-hover-border": "rgba(130, 49, 73, 0.18)",
    "--chrome-separator-bg": "linear-gradient(180deg, transparent, rgba(130, 49, 73, 0.22), transparent)",
    "--statusbar-bg": "rgba(255, 238, 247, 0.82)",
    "--statusbar-filter": "blur(12px) saturate(1.12) brightness(1.02) contrast(1.02)",
    "--statusbar-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -1px 0 rgba(159, 75, 97, 0.07)",
    "--material-panel-filter": PANEL_BLUR,
    "--panel-legibility-filter": PANEL_LEGIBILITY_FILTER_LIGHT,
    "--panel-text-scrim": PANEL_TEXT_SCRIM_LIGHT,
    "--terminal-shell-filter": PANEL_BLUR,
    "--material-panel-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.06), 0 10px 28px rgba(80, 32, 52, 0.12)",
    "--material-card-shadow": "var(--rim-top), 0 0 0 1px rgba(159, 75, 97, 0.07), 0 8px 18px rgba(80, 32, 52, 0.1)",
    "--popup-glass-bg": "linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 38%), rgba(255, 242, 248, 0.9)",
    "--popup-glass-border": "rgba(130, 49, 73, 0.22)",
    "--popup-glass-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.08), 0 14px 32px rgba(80, 32, 52, 0.16)",
    "--scrim-standard-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.18), rgba(54, 25, 39, 0.28)), rgba(255, 238, 245, 0.14)",
    "--scrim-heavy-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.24), rgba(54, 25, 39, 0.34)), rgba(255, 230, 240, 0.16)",
    "--dialog-surface":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.44), transparent 32%), linear-gradient(145deg, rgba(252, 201, 185, 0.1), transparent 50%), rgba(255, 248, 252, 0.88)",
    "--dialog-surface-blur": "blur(18px)",
    "--settings-control-bg": "rgba(255, 249, 252, 0.78)",
    "--settings-card-bg": "rgba(255, 246, 250, 0.74)",
    "--settings-card-bg-hover": "rgba(255, 241, 248, 0.84)",
    "--settings-card-bg-active": "rgba(255, 236, 246, 0.9)",
    "--toolkit-grid-bg":
      "linear-gradient(135deg, rgba(189, 63, 104, 0.075), transparent 38%, rgba(252, 201, 185, 0.09)), rgba(255, 245, 250, 0.72)",
    "--toolkit-grid-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.44), inset 0 -1px 0 rgba(130, 49, 73, 0.12)",
    "--toolkit-tile-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 218, 233, 0.08)), rgba(255, 247, 251, 0.78)",
    "--toolkit-tile-primary-bg":
      "linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 46%), rgba(255, 242, 249, 0.82)",
    "--toolkit-tile-hover-bg":
      "linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 58%), rgba(255, 237, 246, 0.88)",
    "--toolkit-tile-text": "rgba(47, 22, 33, 0.92)",
    "--toolkit-icon-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(189, 63, 104, 0.06)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(255, 247, 251, 0.78))",
    "--toolkit-bottom-bg":
      "linear-gradient(90deg, rgba(189, 63, 104, 0.07), transparent 52%, rgba(252, 201, 185, 0.07)), rgba(255, 244, 250, 0.78)",
    "--toolkit-bottom-btn-bg": "rgba(255, 250, 253, 0.84)",
  },
  "aether-obsidian": darkMoodSurfaces({
    shell: "8, 8, 13",
    panel: "21, 20, 26",
    panelStrong: "31, 30, 37",
    accent: "216, 183, 102",
    gold: "137, 220, 235",
    text: "250, 246, 235",
  }),
  "aether-pro": darkMoodSurfaces({
    shell: "2, 8, 16",
    panel: "4, 13, 23",
    panelStrong: "8, 22, 34",
    accent: "155, 199, 223",
    gold: "199, 179, 122",
    text: "241, 247, 250",
  }),
};
