import { DEFAULT_BG } from "../lib/ansiPalette";

export type MoodPresetId =
  | "aether-sky"
  | "aether-moonwater"
  | "aether-dream"
  | "aether-cute"
  | "aether-sakura"
  | "aether-obsidian"
  | "aether-pro";

export interface MoodPreset {
  id: MoodPresetId;
  label: string;
  tone: string;
}

export const DEFAULT_MOOD_PRESET: MoodPresetId = "aether-sky";

export const MOOD_PRESETS: readonly MoodPreset[] = [
  { id: "aether-sky", label: "Aether Sky", tone: "Airy blue glass" },
  { id: "aether-moonwater", label: "Aether Moonwater", tone: "Moonlit cyan tide" },
  { id: "aether-dream", label: "Aether Dream", tone: "Soft lavender aurora" },
  { id: "aether-cute", label: "Aether Cute", tone: "Clear mint and rose" },
  { id: "aether-sakura", label: "Aether Sakura", tone: "Cherry blossom glass" },
  { id: "aether-obsidian", label: "Aether Obsidian", tone: "Midnight gold cockpit" },
  { id: "aether-pro", label: "Aether Pro", tone: "Quiet graphite focus" },
] as const;

const MOOD_SET = new Set<string>(MOOD_PRESETS.map((preset) => preset.id));

export function normalizeMoodPreset(value: string | null | undefined): MoodPresetId {
  return value && MOOD_SET.has(value) ? (value as MoodPresetId) : DEFAULT_MOOD_PRESET;
}

export function moodPresetToCSS(value: string | null | undefined): Record<string, string> {
  return MOOD_CSS[normalizeMoodPreset(value)];
}

const MOOD_CSS: Record<MoodPresetId, Record<string, string>> = {
  "aether-sky": {
    "--aether-ink": "#07111d",
    "--aether-obsidian": "#0d1727",
    "--aether-graphite": "#162338",
    "--aether-smoke-mauve": "#20324a",
    "--aether-moon": "#d9ecff",
    "--aether-champagne": "#f0cf7a",
    "--glass-clear": "rgba(35, 104, 170, 0.014)",
    "--glass-ground": "rgba(4, 14, 27, 0.28)",
    "--glass-frame": "rgba(9, 24, 42, 0.19)",
    "--glass-standard": "rgba(8, 25, 47, 0.18)",
    "--glass-dense": "rgba(7, 22, 42, 0.22)",
    "--glass-thick": "rgba(8, 27, 50, 0.255)",
    "--glass-solid": "rgba(18, 30, 48, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(132, 214, 244, 0.078)",
    "--aether-border-strong": "rgba(162, 226, 250, 0.145)",
    "--accent": "#78cfff",
    "--gold": "#f0cf7a",
    "--gold-dim": "rgba(240, 207, 122, 0.38)",
    "--gold-subtle": "rgba(240, 207, 122, 0.16)",
    "--gold-surface": "linear-gradient(180deg, #fff0b2 0%, #f6d982 36%, #d2a94f 100%)",
    "--text-primary": "rgba(246, 251, 255, 0.93)",
    "--text-secondary": "rgba(219, 238, 255, 0.62)",
    "--text-muted": "rgba(203, 224, 244, 0.58)",
    "--text-on-accent": "#07111d",
    "--row-hover": "rgba(118, 207, 245, 0.064)",
    "--row-hover-strong": "rgba(150, 222, 250, 0.1)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 48% -18%, rgba(76, 188, 224, 0.036), transparent 44%), linear-gradient(180deg, rgba(4, 15, 29, 0.38), rgba(1, 6, 15, 0.62))",
    "--terminal-chrome-bg": "rgba(5, 17, 30, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(7, 22, 38, 0.48)",
    "--terminal-rim-warm": "rgba(98, 207, 236, 0.074)",
    "--terminal-border": "rgba(111, 204, 238, 0.064)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(154, 224, 242, 0.032), inset 0 0 0 1px rgba(98, 190, 230, 0.044), inset 0 34px 78px rgba(2, 10, 23, 0.34), inset 0 -24px 62px rgba(1, 6, 16, 0.26)",
    "--terminal-shell-shadow": "0 24px 72px rgba(1, 8, 20, 0.34), 0 0 38px rgba(62, 170, 214, 0.038)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(116, 207, 238, 0.038), inset 0 26px 68px rgba(0, 6, 18, 0.29), inset 0 -20px 50px rgba(0, 4, 13, 0.22)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(1, 7, 18, 0.22), transparent 52px), linear-gradient(0deg, rgba(1, 7, 17, 0.16), transparent 42px), linear-gradient(90deg, rgba(62, 170, 214, 0.018), transparent 25%, transparent 74%, rgba(100, 204, 232, 0.012))",
    "--terminal-watermark-opacity": "0.042",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(62, 170, 214, 0.06))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(58, 163, 212, 0.036), transparent 34%), linear-gradient(305deg, rgba(115, 217, 238, 0.018), transparent 40%), linear-gradient(180deg, rgba(1, 9, 22, 0.06), rgba(1, 9, 22, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(110, 212, 238, 0.006) 50%, transparent)",
    "--mood-root-texture-opacity": "0.032",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(145, 226, 243, 0.052), inset 0 0 0 1px rgba(70, 184, 224, 0.046), inset 0 -1px 0 rgba(52, 150, 198, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(96, 205, 236, 0.01), transparent 26%), linear-gradient(135deg, rgba(9, 36, 66, 0.072), rgba(2, 14, 29, 0.1)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(58, 163, 212, 0.02), transparent 44%), linear-gradient(180deg, rgba(3, 17, 34, 0.058), rgba(1, 9, 22, 0.034)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(96, 205, 236, 0.01), transparent 24%), linear-gradient(145deg, rgba(8, 33, 61, 0.066), rgba(2, 16, 33, 0.1)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(8, 38, 70, 0.112), rgba(3, 20, 42, 0.14)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(105, 214, 240, 0.01), transparent 22%), linear-gradient(135deg, rgba(58, 163, 212, 0.016), transparent 44%), linear-gradient(315deg, rgba(91, 205, 233, 0.008), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(8, 36, 68, 0.14), rgba(3, 21, 45, 0.16)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(5, 29, 55, 0.128), rgba(3, 20, 43, 0.146)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(7, 34, 64, 0.122), rgba(2, 19, 41, 0.152)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(4, 22, 43, 0.14), rgba(2, 11, 26, 0.17)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(126, 207, 255, 0.28)",
  },
  "aether-moonwater": {
    "--aether-ink": "#03111f",
    "--aether-obsidian": "#061a2b",
    "--aether-graphite": "#0b2940",
    "--aether-smoke-mauve": "#14354c",
    "--aether-moon": "#e9fbff",
    "--aether-champagne": "#f5c7e3",
    "--glass-clear": "rgba(0, 118, 204, 0.014)",
    "--glass-ground": "rgba(0, 16, 34, 0.28)",
    "--glass-frame": "rgba(2, 34, 62, 0.18)",
    "--glass-standard": "rgba(2, 38, 70, 0.16)",
    "--glass-dense": "rgba(1, 31, 58, 0.2)",
    "--glass-thick": "rgba(2, 43, 77, 0.245)",
    "--glass-solid": "rgba(6, 23, 37, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(88, 214, 255, 0.082)",
    "--aether-border-strong": "rgba(156, 236, 255, 0.16)",
    "--accent": "#52d7ff",
    "--gold": "#f5c7e3",
    "--gold-dim": "rgba(245, 199, 227, 0.34)",
    "--gold-subtle": "rgba(245, 199, 227, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #fff4fb 0%, #f5c7e3 42%, #9adfff 100%)",
    "--text-primary": "rgba(246, 253, 255, 0.94)",
    "--text-secondary": "rgba(211, 241, 252, 0.64)",
    "--text-muted": "rgba(180, 218, 234, 0.58)",
    "--text-on-accent": "#03111f",
    "--row-hover": "rgba(82, 215, 255, 0.07)",
    "--row-hover-strong": "rgba(154, 226, 255, 0.12)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 42% -16%, rgba(90, 218, 255, 0.048), transparent 46%), radial-gradient(ellipse at 72% 18%, rgba(245, 199, 227, 0.018), transparent 36%), linear-gradient(180deg, rgba(1, 18, 39, 0.42), rgba(0, 6, 18, 0.66))",
    "--terminal-chrome-bg": "rgba(1, 20, 38, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(2, 30, 56, 0.5)",
    "--terminal-rim-warm": "rgba(156, 236, 255, 0.08)",
    "--terminal-border": "rgba(86, 216, 255, 0.07)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(176, 241, 255, 0.034), inset 0 0 0 1px rgba(75, 204, 246, 0.046), inset 0 34px 82px rgba(0, 9, 26, 0.38), inset 0 -24px 62px rgba(0, 4, 14, 0.28)",
    "--terminal-shell-shadow": "0 24px 74px rgba(0, 8, 24, 0.36), 0 0 42px rgba(48, 190, 238, 0.045)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(92, 222, 255, 0.042), inset 0 28px 72px rgba(0, 7, 22, 0.3), inset 0 -22px 54px rgba(0, 4, 13, 0.24)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 8, 24, 0.2), transparent 52px), linear-gradient(0deg, rgba(0, 6, 18, 0.18), transparent 42px), linear-gradient(90deg, rgba(74, 208, 255, 0.018), transparent 25%, transparent 74%, rgba(245, 199, 227, 0.012))",
    "--terminal-watermark-opacity": "0.05",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(82, 215, 255, 0.065))",
    "--mood-root-glow":
      "linear-gradient(120deg, rgba(12, 113, 203, 0.07), transparent 34%), linear-gradient(300deg, rgba(72, 212, 255, 0.05), transparent 40%), linear-gradient(180deg, rgba(0, 17, 42, 0.05), rgba(0, 7, 20, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(124, 226, 255, 0.006) 50%, transparent)",
    "--mood-root-texture-opacity": "0.022",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(172, 240, 255, 0.062), inset 0 0 0 1px rgba(70, 202, 246, 0.052), inset 0 -1px 0 rgba(245, 199, 227, 0.03)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(88, 214, 255, 0.008), transparent 24%), rgba(1, 18, 34, 0.14)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(48, 190, 238, 0.028), transparent 44%), linear-gradient(180deg, rgba(0, 19, 43, 0.048), rgba(0, 7, 20, 0.032)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(88, 214, 255, 0.01), transparent 24%), linear-gradient(145deg, rgba(1, 30, 56, 0.052), rgba(0, 13, 31, 0.078)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(2, 44, 76, 0.11), rgba(0, 18, 40, 0.13)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(116, 224, 255, 0.012), transparent 22%), linear-gradient(135deg, rgba(64, 190, 238, 0.016), transparent 44%), linear-gradient(315deg, rgba(245, 199, 227, 0.01), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(2, 40, 72, 0.13), rgba(0, 19, 42, 0.15)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(1, 32, 60, 0.12), rgba(0, 17, 39, 0.14)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(2, 39, 70, 0.116), rgba(0, 17, 38, 0.144)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(1, 25, 50, 0.13), rgba(0, 10, 26, 0.16)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(82, 215, 255, 0.28)",
  },
  "aether-dream": {
    "--aether-ink": "#120d20",
    "--aether-obsidian": "#191329",
    "--aether-graphite": "#251d37",
    "--aether-smoke-mauve": "#342845",
    "--aether-moon": "#f2eaff",
    "--aether-champagne": "#ffd996",
    "--glass-clear": "rgba(128, 103, 190, 0.018)",
    "--glass-ground": "rgba(23, 17, 37, 0.24)",
    "--glass-frame": "rgba(82, 67, 119, 0.12)",
    "--glass-standard": "rgba(72, 58, 108, 0.14)",
    "--glass-dense": "rgba(61, 49, 91, 0.18)",
    "--glass-thick": "rgba(84, 68, 116, 0.22)",
    "--glass-solid": "rgba(30, 23, 45, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(224, 206, 255, 0.12)",
    "--aether-border-strong": "rgba(239, 225, 255, 0.21)",
    "--accent": "#c8b6ff",
    "--gold": "#ffd996",
    "--gold-dim": "rgba(255, 217, 150, 0.36)",
    "--gold-subtle": "rgba(255, 217, 150, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0c2 0%, #ffd996 42%, #d7a95c 100%)",
    "--text-primary": "rgba(253, 248, 255, 0.92)",
    "--text-secondary": "rgba(237, 225, 255, 0.6)",
    "--text-muted": "rgba(222, 207, 245, 0.58)",
    "--text-on-accent": "#120d20",
    "--row-hover": "rgba(203, 182, 255, 0.08)",
    "--row-hover-strong": "rgba(231, 217, 255, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.055), transparent 45%), linear-gradient(180deg, rgba(18, 14, 29, 0.32), rgba(6, 4, 13, 0.52))",
    "--terminal-chrome-bg": "rgba(31, 25, 47, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(48, 39, 68, 0.48)",
    "--terminal-rim-warm": "rgba(255, 217, 150, 0.17)",
    "--terminal-border": "rgba(223, 204, 255, 0.14)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(252, 240, 255, 0.09), inset 0 0 0 1px rgba(203, 182, 255, 0.075), inset 0 30px 72px rgba(11, 7, 21, 0.25), inset 0 -22px 58px rgba(9, 6, 18, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(8, 5, 19, 0.34), 0 0 44px rgba(203, 182, 255, 0.08)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(224, 206, 255, 0.075), inset 0 26px 68px rgba(8, 4, 18, 0.2), inset 0 -20px 50px rgba(6, 4, 15, 0.16)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(8, 5, 18, 0.16), transparent 52px), linear-gradient(0deg, rgba(9, 5, 18, 0.13), transparent 42px), linear-gradient(90deg, rgba(203, 182, 255, 0.04), transparent 25%, transparent 74%, rgba(255, 217, 150, 0.024))",
    "--terminal-watermark-opacity": "0.052",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(203, 182, 255, 0.09))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(203, 182, 255, 0.052), transparent 34%), linear-gradient(305deg, rgba(255, 217, 150, 0.032), transparent 40%), linear-gradient(180deg, rgba(18, 13, 32, 0.035), rgba(18, 13, 32, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(203, 182, 255, 0.008) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(252, 240, 255, 0.12), inset 0 0 0 1px rgba(203, 182, 255, 0.07), inset 0 -1px 0 rgba(255, 217, 150, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.02), transparent 26%), linear-gradient(135deg, rgba(101, 79, 141, 0.05), rgba(32, 24, 51, 0.07)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.038), transparent 44%), linear-gradient(180deg, rgba(40, 30, 61, 0.05), rgba(18, 13, 32, 0.03)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.024), transparent 24%), linear-gradient(145deg, rgba(82, 64, 116, 0.05), rgba(33, 25, 52, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(92, 74, 126, 0.1), rgba(40, 31, 61, 0.12)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.038), transparent 22%), linear-gradient(135deg, rgba(203, 182, 255, 0.034), transparent 44%), linear-gradient(315deg, rgba(255, 217, 150, 0.018), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(86, 70, 116, 0.14), rgba(37, 29, 56, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(54, 45, 78, 0.12), rgba(35, 27, 53, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(90, 70, 105, 0.12), rgba(31, 27, 55, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(28, 18, 48, 0.11), rgba(14, 9, 30, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(203, 182, 255, 0.27)",
  },
  "aether-cute": {
    "--aether-ink": "#071916",
    "--aether-obsidian": "#0e211f",
    "--aether-graphite": "#17302e",
    "--aether-smoke-mauve": "#223b39",
    "--aether-moon": "#e8fffb",
    "--aether-champagne": "#ffd1dc",
    "--glass-clear": "rgba(91, 207, 194, 0.018)",
    "--glass-ground": "rgba(11, 31, 29, 0.24)",
    "--glass-frame": "rgba(55, 116, 110, 0.12)",
    "--glass-standard": "rgba(43, 96, 91, 0.14)",
    "--glass-dense": "rgba(34, 78, 74, 0.18)",
    "--glass-thick": "rgba(54, 112, 105, 0.22)",
    "--glass-solid": "rgba(14, 35, 33, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(195, 255, 246, 0.12)",
    "--aether-border-strong": "rgba(218, 255, 250, 0.21)",
    "--accent": "#72f0dc",
    "--gold": "#ffd1dc",
    "--gold-dim": "rgba(255, 209, 220, 0.36)",
    "--gold-subtle": "rgba(255, 209, 220, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0f5 0%, #ffd1dc 42%, #d99aaa 100%)",
    "--text-primary": "rgba(246, 255, 253, 0.92)",
    "--text-secondary": "rgba(221, 250, 245, 0.6)",
    "--text-muted": "rgba(202, 234, 229, 0.58)",
    "--text-on-accent": "#071916",
    "--row-hover": "rgba(114, 240, 220, 0.08)",
    "--row-hover-strong": "rgba(188, 255, 244, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.055), transparent 45%), linear-gradient(180deg, rgba(10, 26, 25, 0.32), rgba(3, 12, 12, 0.52))",
    "--terminal-chrome-bg": "rgba(18, 43, 41, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(30, 70, 66, 0.48)",
    "--terminal-rim-warm": "rgba(255, 209, 220, 0.17)",
    "--terminal-border": "rgba(195, 255, 246, 0.14)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(237, 255, 252, 0.09), inset 0 0 0 1px rgba(114, 240, 220, 0.075), inset 0 30px 72px rgba(4, 16, 16, 0.25), inset 0 -22px 58px rgba(3, 13, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(3, 13, 13, 0.34), 0 0 44px rgba(114, 240, 220, 0.08)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(195, 255, 246, 0.075), inset 0 26px 68px rgba(3, 12, 12, 0.2), inset 0 -20px 50px rgba(2, 9, 10, 0.16)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(2, 10, 11, 0.16), transparent 52px), linear-gradient(0deg, rgba(2, 10, 10, 0.13), transparent 42px), linear-gradient(90deg, rgba(114, 240, 220, 0.04), transparent 25%, transparent 74%, rgba(255, 209, 220, 0.024))",
    "--terminal-watermark-opacity": "0.052",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(114, 240, 220, 0.09))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(114, 240, 220, 0.052), transparent 34%), linear-gradient(305deg, rgba(255, 209, 220, 0.032), transparent 40%), linear-gradient(180deg, rgba(7, 25, 22, 0.035), rgba(7, 25, 22, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(114, 240, 220, 0.008) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(237, 255, 252, 0.12), inset 0 0 0 1px rgba(114, 240, 220, 0.07), inset 0 -1px 0 rgba(255, 209, 220, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.02), transparent 26%), linear-gradient(135deg, rgba(66, 135, 126, 0.05), rgba(18, 48, 44, 0.07)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.038), transparent 44%), linear-gradient(180deg, rgba(25, 55, 51, 0.05), rgba(7, 25, 22, 0.03)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.024), transparent 24%), linear-gradient(145deg, rgba(60, 116, 108, 0.05), rgba(17, 48, 45, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(67, 129, 120, 0.1), rgba(27, 62, 58, 0.12)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.038), transparent 22%), linear-gradient(135deg, rgba(114, 240, 220, 0.034), transparent 44%), linear-gradient(315deg, rgba(255, 209, 220, 0.018), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(64, 118, 111, 0.14), rgba(24, 57, 53, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(40, 81, 76, 0.12), rgba(25, 58, 54, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(74, 118, 110, 0.12), rgba(20, 59, 55, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(8, 34, 32, 0.11), rgba(4, 20, 20, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(114, 240, 220, 0.26)",
  },
  "aether-sakura": {
    "--aether-ink": "#24121b",
    "--aether-obsidian": "#fff7fb",
    "--aether-graphite": "#ffe9f0",
    "--aether-smoke-mauve": "#e8a6b8",
    "--aether-moon": "#fffafd",
    "--aether-champagne": "#823149",
    "--glass-clear": "rgba(255, 226, 237, 0.16)",
    "--glass-ground": "rgba(97, 37, 61, 0.34)",
    "--glass-frame": "rgba(124, 48, 76, 0.3)",
    "--glass-standard": "rgba(255, 225, 237, 0.32)",
    "--glass-dense": "rgba(255, 218, 233, 0.38)",
    "--glass-thick": "rgba(255, 212, 229, 0.46)",
    "--glass-solid": "rgba(255, 247, 251, 0.88)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(147, 55, 83, 0.22)",
    "--aether-border-strong": "rgba(130, 49, 73, 0.34)",
    "--accent": "#bd3f68",
    "--gold": "#823149",
    "--gold-dim": "rgba(130, 49, 73, 0.4)",
    "--gold-subtle": "rgba(189, 63, 104, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #ffd6df 0%, #e88fa7 42%, #823149 100%)",
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent 72%), linear-gradient(90deg, rgba(189, 63, 104, 0.08), transparent 34%, transparent 66%, rgba(252, 201, 185, 0.08)), rgba(255, 236, 245, 0.46)",
    "--chrome-frame-filter": "blur(8px) saturate(1.08) brightness(0.94) contrast(1.08)",
    "--chrome-frame-shadow":
      "inset 0 1px 0 rgba(255, 255, 255, 0.46), inset 0 -1px 0 rgba(130, 49, 73, 0.12)",
    "--chrome-control-hover-bg": "rgba(189, 63, 104, 0.1)",
    "--chrome-control-hover-border": "rgba(130, 49, 73, 0.18)",
    "--chrome-separator-bg": "linear-gradient(180deg, transparent, rgba(130, 49, 73, 0.22), transparent)",
    "--statusbar-bg": "rgba(255, 248, 251, 0.84)",
    "--statusbar-filter": "blur(1px) saturate(1.02) brightness(1) contrast(1)",
    "--statusbar-shadow":
      "inset 0 1px 0 rgba(255, 255, 255, 0.52), inset 0 -1px 0 rgba(159, 75, 97, 0.08)",
    "--material-panel-filter": "blur(1px) saturate(1.06) brightness(0.96) contrast(1.08)",
    "--terminal-shell-filter": "blur(1px) saturate(1.08) brightness(0.86) contrast(1.12)",
    "--material-panel-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.06), 0 10px 28px rgba(80, 32, 52, 0.12)",
    "--material-card-shadow": "var(--rim-top), 0 0 0 1px rgba(159, 75, 97, 0.07), 0 8px 18px rgba(80, 32, 52, 0.1)",
    "--popup-glass-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 38%), rgba(255, 242, 248, 0.9)",
    "--popup-glass-border": "rgba(130, 49, 73, 0.22)",
    "--popup-glass-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.08), 0 14px 32px rgba(80, 32, 52, 0.16)",
    "--scrim-standard-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.18), rgba(54, 25, 39, 0.28)), rgba(255, 238, 245, 0.14)",
    "--scrim-heavy-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.24), rgba(54, 25, 39, 0.34)), rgba(255, 230, 240, 0.16)",
    "--dialog-surface":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 32%), linear-gradient(145deg, rgba(252, 201, 185, 0.16), transparent 50%), rgba(255, 240, 247, 0.86)",
    "--dialog-surface-blur": "blur(18px)",
    "--settings-control-bg": "rgba(255, 250, 253, 0.72)",
    "--settings-card-bg": "rgba(255, 245, 250, 0.66)",
    "--settings-card-bg-hover": "rgba(255, 239, 247, 0.78)",
    "--settings-card-bg-active": "rgba(255, 235, 245, 0.84)",
    "--toolkit-grid-bg":
      "linear-gradient(135deg, rgba(189, 63, 104, 0.12), transparent 38%, rgba(252, 201, 185, 0.14)), rgba(255, 242, 248, 0.46)",
    "--toolkit-grid-shadow":
      "inset 0 1px 0 rgba(255, 255, 255, 0.44), inset 0 -1px 0 rgba(130, 49, 73, 0.12)",
    "--toolkit-tile-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 218, 233, 0.12)), rgba(255, 245, 250, 0.58)",
    "--toolkit-tile-primary-bg":
      "linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 14%, transparent), transparent 46%), rgba(255, 239, 247, 0.68)",
    "--toolkit-tile-hover-bg":
      "linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 13%, transparent), transparent 58%), rgba(255, 235, 245, 0.78)",
    "--toolkit-tile-text": "rgba(47, 22, 33, 0.92)",
    "--toolkit-icon-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(189, 63, 104, 0.06)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(255, 247, 251, 0.78))",
    "--toolkit-bottom-bg":
      "linear-gradient(90deg, rgba(189, 63, 104, 0.12), transparent 52%, rgba(252, 201, 185, 0.12)), rgba(255, 242, 248, 0.58)",
    "--toolkit-bottom-btn-bg": "rgba(255, 250, 253, 0.64)",
    "--text-primary": "#24121b",
    "--text-secondary": "rgba(47, 22, 33, 0.9)",
    "--text-muted": "rgba(74, 34, 49, 0.78)",
    "--text-on-accent": "#fffaff",
    "--row-hover": "rgba(189, 63, 104, 0.13)",
    "--row-hover-strong": "rgba(189, 63, 104, 0.2)",
    "--terminal-canvas-bg": "rgba(83, 33, 56, 0.52)",
    "--terminal-well-bg":
      "radial-gradient(ellipse at 44% -18%, rgba(255, 198, 219, 0.22), transparent 46%), radial-gradient(ellipse at 78% 18%, rgba(252, 201, 185, 0.14), transparent 38%), linear-gradient(180deg, rgba(111, 43, 73, 0.42), rgba(54, 22, 42, 0.58))",
    "--terminal-chrome-bg": "rgba(78, 31, 54, 0.38)",
    "--terminal-chrome-bg-focus": "rgba(91, 35, 62, 0.54)",
    "--terminal-rim-warm": "rgba(255, 205, 220, 0.22)",
    "--terminal-border": "rgba(255, 184, 210, 0.24)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255, 226, 237, 0.16), inset 0 0 0 1px rgba(255, 168, 196, 0.14), inset 0 30px 72px rgba(72, 26, 46, 0.22), inset 0 -22px 58px rgba(42, 16, 31, 0.2)",
    "--terminal-shell-shadow": "0 24px 68px rgba(80, 32, 52, 0.24), 0 0 44px rgba(189, 63, 104, 0.12)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(255, 174, 204, 0.16), inset 0 1px 0 rgba(255, 238, 245, 0.12), inset 0 26px 68px rgba(86, 32, 54, 0.2), inset 0 -20px 50px rgba(46, 18, 34, 0.18)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(255, 218, 228, 0.06), transparent 52px), linear-gradient(0deg, rgba(31, 10, 24, 0.16), transparent 42px), linear-gradient(90deg, rgba(232, 62, 122, 0.035), transparent 25%, transparent 74%, rgba(255, 210, 220, 0.03))",
    "--terminal-watermark-opacity": "0.032",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(189, 63, 104, 0.1))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(252, 201, 185, 0.24), transparent 35%), linear-gradient(300deg, rgba(189, 63, 104, 0.12), transparent 42%), linear-gradient(180deg, rgba(255, 250, 253, 0.3), rgba(255, 224, 237, 0.16))",
    "--mood-root-glow-opacity": "0.34",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(189, 63, 104, 0.01) 50%, transparent)",
    "--mood-root-texture-opacity": "0.038",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(255, 255, 255, 0.46), inset 0 0 0 1px rgba(130, 49, 73, 0.12), inset 0 -1px 0 rgba(130, 49, 73, 0.06)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.32), transparent 30%), linear-gradient(135deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.22)), rgba(255, 241, 247, 0.48)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(189, 63, 104, 0.1), transparent 44%), linear-gradient(180deg, rgba(255, 248, 252, 0.3), rgba(255, 222, 236, 0.22)), rgba(255, 244, 249, 0.28)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.28), transparent 26%), linear-gradient(145deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.24)), rgba(255, 242, 248, 0.52)",
    "--mood-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.34), rgba(255, 226, 237, 0.24)), rgba(255, 244, 249, 0.54)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 22%), linear-gradient(135deg, rgba(189, 63, 104, 0.075), transparent 44%), linear-gradient(315deg, rgba(252, 201, 185, 0.07), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.34), rgba(255, 224, 235, 0.24)), rgba(255, 244, 249, 0.54)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(255, 250, 253, 0.32), rgba(255, 224, 235, 0.24)), rgba(255, 244, 249, 0.52)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(255, 250, 253, 0.3), rgba(255, 224, 235, 0.23)), rgba(255, 244, 249, 0.52)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(255, 247, 251, 0.28), rgba(255, 224, 235, 0.22)), rgba(255, 235, 244, 0.48)",
    "--mood-selection-bg": "rgba(189, 63, 104, 0.22)",
  },
  "aether-obsidian": {
    "--aether-ink": "#090b13",
    "--aether-obsidian": "#111017",
    "--aether-graphite": "#1b1920",
    "--aether-smoke-mauve": "#28232a",
    "--aether-moon": "#c7d2ee",
    "--aether-champagne": "#d8b766",
    "--glass-clear": "rgba(10, 9, 13, 0.018)",
    "--glass-ground": "rgba(13, 12, 15, 0.24)",
    "--glass-frame": "rgba(24, 22, 27, 0.12)",
    "--glass-standard": "rgba(26, 27, 32, 0.14)",
    "--glass-dense": "rgba(27, 26, 33, 0.18)",
    "--glass-thick": "rgba(36, 36, 44, 0.22)",
    "--glass-solid": "rgba(26, 26, 26, 0.78)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(231, 211, 168, 0.065)",
    "--aether-border-strong": "rgba(231, 211, 168, 0.12)",
    "--accent": "#4fc1ff",
    "--gold": "#d8b766",
    "--gold-dim": "rgba(216, 183, 102, 0.42)",
    "--gold-subtle": "rgba(216, 183, 102, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #f4df9a 0%, #dfc27c 24%, #d8b766 52%, #b78c3f 82%, #8f682f 100%)",
    "--text-primary": "rgba(250, 246, 235, 0.9)",
    "--text-secondary": "rgba(231, 226, 214, 0.58)",
    "--text-muted": "rgba(220, 214, 204, 0.56)",
    "--text-on-accent": "#090b13",
    "--row-hover": "var(--white-6)",
    "--row-hover-strong": "var(--white-10)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.045), transparent 45%), linear-gradient(180deg, rgba(12, 13, 20, 0.34), rgba(4, 5, 9, 0.52))",
    "--terminal-chrome-bg": "rgba(16, 17, 24, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(24, 24, 31, 0.48)",
    "--terminal-rim-warm": "rgba(216, 183, 102, 0.16)",
    "--terminal-border": "rgba(216, 183, 102, 0.085)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255, 244, 214, 0.055), inset 0 0 0 1px var(--terminal-border), inset 0 28px 70px rgba(0, 0, 0, 0.22), inset 0 -20px 56px rgba(5, 7, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 70px rgba(0, 0, 0, 0.24)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(137, 220, 235, 0.045), inset 0 22px 62px rgba(0, 0, 0, 0.18), inset 0 -18px 46px rgba(0, 0, 0, 0.14)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 0, 0, 0.14), transparent 48px), linear-gradient(0deg, rgba(0, 0, 0, 0.12), transparent 42px), linear-gradient(90deg, rgba(216, 183, 102, 0.035), transparent 26%, transparent 74%, rgba(137, 220, 235, 0.026))",
    "--terminal-watermark-opacity": "0.055",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(216, 183, 102, 0.08))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(216, 183, 102, 0.045), transparent 32%), linear-gradient(300deg, rgba(137, 220, 235, 0.032), transparent 38%), linear-gradient(180deg, rgba(9, 11, 19, 0.035), rgba(9, 11, 19, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(216, 183, 102, 0.007) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(255, 244, 214, 0.1), inset 0 0 0 1px rgba(216, 183, 102, 0.055), inset 0 -1px 0 rgba(137, 220, 235, 0.035)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.018), transparent 26%), linear-gradient(135deg, rgba(42, 33, 28, 0.045), rgba(20, 23, 34, 0.065)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.024), transparent 42%), linear-gradient(180deg, rgba(18, 15, 13, 0.04), rgba(9, 11, 18, 0.026)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.024), transparent 24%), linear-gradient(145deg, rgba(34, 25, 22, 0.045), rgba(22, 26, 38, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.035), transparent 22%), linear-gradient(135deg, rgba(216, 183, 102, 0.032), transparent 42%), linear-gradient(315deg, rgba(137, 220, 235, 0.024), transparent 48%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(41, 39, 48, 0.14), rgba(21, 22, 30, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(30, 35, 42, 0.12), rgba(21, 20, 25, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(42, 34, 25, 0.12), rgba(18, 23, 35, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(21, 19, 25, 0.11), rgba(10, 10, 16, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(200, 160, 80, 0.25)",
  },
  "aether-pro": {
    "--aether-ink": "#080c10",
    "--aether-obsidian": "#0f1418",
    "--aether-graphite": "#1b2228",
    "--aether-smoke-mauve": "#273039",
    "--aether-moon": "#dce7ef",
    "--aether-champagne": "#c7b37a",
    "--glass-clear": "rgba(17, 25, 31, 0.018)",
    "--glass-ground": "rgba(13, 18, 22, 0.24)",
    "--glass-frame": "rgba(28, 36, 43, 0.12)",
    "--glass-standard": "rgba(32, 40, 48, 0.14)",
    "--glass-dense": "rgba(34, 42, 50, 0.18)",
    "--glass-thick": "rgba(45, 54, 63, 0.22)",
    "--glass-solid": "rgba(28, 34, 40, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(203, 220, 232, 0.08)",
    "--aether-border-strong": "rgba(220, 235, 245, 0.14)",
    "--accent": "#9bc7df",
    "--gold": "#c7b37a",
    "--gold-dim": "rgba(199, 179, 122, 0.34)",
    "--gold-subtle": "rgba(199, 179, 122, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #e7dba7 0%, #c7b37a 45%, #9a844b 100%)",
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.012), transparent 70%), linear-gradient(90deg, rgba(74, 184, 220, 0.016), transparent 36%, transparent 66%, rgba(199, 179, 122, 0.006)), rgba(4, 12, 21, 0.48)",
    "--text-primary": "rgba(241, 247, 250, 0.9)",
    "--text-secondary": "rgba(218, 229, 235, 0.56)",
    "--text-muted": "rgba(200, 213, 222, 0.56)",
    "--text-on-accent": "#080c10",
    "--row-hover": "rgba(155, 199, 223, 0.07)",
    "--row-hover-strong": "rgba(188, 220, 238, 0.11)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(155, 199, 223, 0.036), transparent 45%), linear-gradient(180deg, rgba(12, 17, 22, 0.32), rgba(4, 7, 10, 0.52))",
    "--terminal-chrome-bg": "rgba(21, 28, 34, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(32, 42, 49, 0.48)",
    "--terminal-rim-warm": "rgba(199, 179, 122, 0.14)",
    "--terminal-border": "rgba(203, 220, 232, 0.1)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(238, 246, 250, 0.055), inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 30px 72px rgba(0, 0, 0, 0.22), inset 0 -22px 58px rgba(0, 0, 0, 0.18)",
    "--terminal-shell-shadow": "0 24px 70px rgba(0, 0, 0, 0.28)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 24px 64px rgba(0, 0, 0, 0.18), inset 0 -18px 46px rgba(0, 0, 0, 0.14)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 0, 0, 0.14), transparent 48px), linear-gradient(0deg, rgba(0, 0, 0, 0.12), transparent 42px), linear-gradient(90deg, rgba(155, 199, 223, 0.026), transparent 26%, transparent 74%, rgba(199, 179, 122, 0.018))",
    "--terminal-watermark-opacity": "0.045",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(155, 199, 223, 0.055))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(68, 178, 218, 0.036), transparent 32%), linear-gradient(300deg, rgba(199, 179, 122, 0.018), transparent 38%), linear-gradient(180deg, rgba(2, 9, 18, 0.06), rgba(1, 7, 14, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(155, 199, 223, 0.007) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(238, 246, 250, 0.08), inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 -1px 0 rgba(199, 179, 122, 0.026)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.016), transparent 26%), linear-gradient(145deg, rgba(0, 126, 190, 0.034), transparent 48%), rgba(4, 13, 23, 0.58)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(72, 185, 220, 0.024), transparent 42%), linear-gradient(180deg, rgba(4, 13, 23, 0.22), rgba(1, 6, 12, 0.2)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.018), transparent 24%), linear-gradient(145deg, rgba(0, 126, 190, 0.042), transparent 48%), rgba(4, 13, 23, 0.66)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(5, 18, 31, 0.32), rgba(2, 9, 17, 0.38)), rgba(4, 13, 23, 0.34)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(238, 246, 250, 0.028), transparent 22%), linear-gradient(135deg, rgba(155, 199, 223, 0.022), transparent 42%), linear-gradient(315deg, rgba(199, 179, 122, 0.016), transparent 48%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(5, 18, 31, 0.34), rgba(2, 9, 17, 0.4)), rgba(4, 13, 23, 0.32)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(5, 18, 31, 0.32), rgba(2, 9, 17, 0.38)), rgba(4, 13, 23, 0.3)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(5, 18, 31, 0.31), rgba(2, 9, 17, 0.38)), rgba(4, 13, 23, 0.3)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(5, 16, 28, 0.32), rgba(3, 10, 19, 0.38)), rgba(4, 13, 23, 0.36)",
    "--mood-selection-bg": "rgba(155, 199, 223, 0.22)",
  },
};

export const MOOD_CSS_KEYS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.values(MOOD_CSS).flatMap((vars) => Object.keys(vars)))).sort(),
);
