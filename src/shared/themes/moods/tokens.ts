import { DEFAULT_BG } from "../../lib/ansiPalette";
import { SAKURA_MATERIAL_CSS_KEYS } from "./material";
import type { MoodPresetId } from "./registry";
import { MOOD_SURFACE_CSS_KEYS } from "./surfaces";

export const MOOD_CSS: Record<MoodPresetId, Record<string, string>> = {
  "aelyris-sky": {
    "--aelyris-ink": "#07111d",
    "--aelyris-obsidian": "#0d1727",
    "--aelyris-graphite": "#162338",
    "--aelyris-smoke-mauve": "#20324a",
    "--aelyris-moon": "#d9ecff",
    "--aelyris-champagne": "#f0cf7a",
    "--glass-clear": "rgba(35, 104, 170, 0.014)",
    "--glass-ground": "rgba(4, 14, 27, 0.28)",
    "--glass-frame": "rgba(9, 24, 42, 0.19)",
    "--glass-standard": "rgba(8, 25, 47, 0.18)",
    "--glass-dense": "rgba(7, 22, 42, 0.22)",
    "--glass-thick": "rgba(8, 27, 50, 0.255)",
    "--glass-solid": "rgba(18, 30, 48, 0.8)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(132, 214, 244, 0.078)",
    "--aelyris-border-strong": "rgba(162, 226, 250, 0.145)",
    "--accent": "#78cfff",
    "--gold": "#f0cf7a",
    "--gold-dim": "rgba(240, 207, 122, 0.38)",
    "--gold-subtle": "rgba(240, 207, 122, 0.16)",
    "--gold-surface": "linear-gradient(180deg, #fff0b2 0%, #f6d982 36%, #d2a94f 100%)",
    "--text-primary": "#f6fbff",
    "--text-secondary": "#cfe4f3",
    "--text-muted": "#b2c8d9",
    "--text-on-accent": "#07111d",
    "--row-hover": "rgba(118, 207, 245, 0.064)",
    "--row-hover-strong": "rgba(150, 222, 250, 0.1)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 48% -18%, rgba(76, 188, 224, 0.036), transparent 44%), linear-gradient(180deg, rgba(4, 15, 29, 0.22), rgba(1, 6, 15, 0.4))",
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
      "radial-gradient(ellipse at 50% 0%, rgba(58, 163, 212, 0.02), transparent 44%), linear-gradient(180deg, rgba(3, 17, 34, 0.058), rgba(1, 9, 22, 0.034)), var(--aelyris-bg)",
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
  "aelyris-moonwater": {
    "--aelyris-ink": "#03111f",
    "--aelyris-obsidian": "#061a2b",
    "--aelyris-graphite": "#0b2940",
    "--aelyris-smoke-mauve": "#14354c",
    "--aelyris-moon": "#e9fbff",
    "--aelyris-champagne": "#f5c7e3",
    "--glass-clear": "rgba(0, 118, 204, 0.014)",
    "--glass-ground": "rgba(0, 16, 34, 0.28)",
    "--glass-frame": "rgba(2, 34, 62, 0.18)",
    "--glass-standard": "rgba(2, 38, 70, 0.16)",
    "--glass-dense": "rgba(1, 31, 58, 0.2)",
    "--glass-thick": "rgba(2, 43, 77, 0.245)",
    "--glass-solid": "rgba(6, 23, 37, 0.8)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(88, 214, 255, 0.082)",
    "--aelyris-border-strong": "rgba(156, 236, 255, 0.16)",
    "--accent": "#52d7ff",
    "--gold": "#f5c7e3",
    "--gold-dim": "rgba(245, 199, 227, 0.34)",
    "--gold-subtle": "rgba(245, 199, 227, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #fff4fb 0%, #f5c7e3 42%, #9adfff 100%)",
    "--text-primary": "#f6fdff",
    "--text-secondary": "#c6e8f3",
    "--text-muted": "#aaccdb",
    "--text-on-accent": "#03111f",
    "--row-hover": "rgba(82, 215, 255, 0.07)",
    "--row-hover-strong": "rgba(154, 226, 255, 0.12)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 42% -16%, rgba(90, 218, 255, 0.048), transparent 46%), radial-gradient(ellipse at 72% 18%, rgba(245, 199, 227, 0.018), transparent 36%), linear-gradient(180deg, rgba(1, 18, 39, 0.24), rgba(0, 6, 18, 0.42))",
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
      "radial-gradient(ellipse at 50% 0%, rgba(48, 190, 238, 0.028), transparent 44%), linear-gradient(180deg, rgba(0, 19, 43, 0.048), rgba(0, 7, 20, 0.032)), var(--aelyris-bg)",
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
  "aelyris-crystal": {
    "--aelyris-ink": "#06101a",
    "--aelyris-obsidian": "#0b1724",
    "--aelyris-graphite": "#12263a",
    "--aelyris-smoke-mauve": "#1b3448",
    "--aelyris-moon": "#effcff",
    "--aelyris-champagne": "#d8f7ff",
    "--glass-clear": "rgba(94, 206, 255, 0.012)",
    "--glass-ground": "rgba(3, 15, 28, 0.18)",
    "--glass-frame": "rgba(6, 28, 45, 0.14)",
    "--glass-standard": "rgba(5, 24, 40, 0.22)",
    "--glass-dense": "rgba(5, 24, 40, 0.28)",
    "--glass-thick": "rgba(7, 34, 54, 0.34)",
    "--glass-solid": "rgba(14, 28, 42, 0.72)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(158, 235, 255, 0.085)",
    "--aelyris-border-strong": "rgba(210, 248, 255, 0.16)",
    "--accent": "#8be9ff",
    "--gold": "#d8f7ff",
    "--gold-dim": "rgba(216, 247, 255, 0.36)",
    "--gold-subtle": "rgba(216, 247, 255, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #ffffff 0%, #d8f7ff 42%, #8be9ff 100%)",
    "--text-primary": "#f8fdff",
    "--text-secondary": "#d7edf7",
    "--text-muted": "#bcd4de",
    "--text-on-accent": "#06101a",
    "--row-hover": "rgba(139, 233, 255, 0.07)",
    "--row-hover-strong": "rgba(205, 247, 255, 0.11)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 44% -18%, rgba(139, 233, 255, 0.052), transparent 46%), radial-gradient(ellipse at 78% 14%, rgba(216, 247, 255, 0.024), transparent 38%), linear-gradient(180deg, rgba(3, 14, 28, 0.18), rgba(0, 5, 15, 0.34))",
    "--terminal-chrome-bg": "rgba(3, 14, 27, 0.22)",
    "--terminal-chrome-bg-focus": "rgba(5, 24, 40, 0.36)",
    "--terminal-rim-warm": "rgba(190, 244, 255, 0.088)",
    "--terminal-border": "rgba(139, 233, 255, 0.07)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(238, 252, 255, 0.04), inset 0 0 0 1px rgba(139, 233, 255, 0.05), inset 0 34px 74px rgba(0, 8, 22, 0.26), inset 0 -24px 58px rgba(0, 4, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(0, 8, 20, 0.28), 0 0 44px rgba(139, 233, 255, 0.045)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(139, 233, 255, 0.04), inset 0 26px 64px rgba(0, 7, 22, 0.24), inset 0 -20px 48px rgba(0, 4, 13, 0.18)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(1, 7, 18, 0.16), transparent 52px), linear-gradient(0deg, rgba(1, 7, 17, 0.12), transparent 42px), linear-gradient(90deg, rgba(139, 233, 255, 0.018), transparent 25%, transparent 74%, rgba(216, 247, 255, 0.012))",
    "--terminal-watermark-opacity": "0.034",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(139, 233, 255, 0.065))",
    "--mood-root-glow":
      "linear-gradient(122deg, rgba(139, 233, 255, 0.058), transparent 34%), linear-gradient(305deg, rgba(216, 247, 255, 0.026), transparent 42%), linear-gradient(180deg, rgba(2, 9, 20, 0.032), rgba(2, 9, 20, 0.11))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(216, 247, 255, 0.005) 50%, transparent)",
    "--mood-root-texture-opacity": "0.02",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(238, 252, 255, 0.07), inset 0 0 0 1px rgba(139, 233, 255, 0.052), inset 0 -1px 0 rgba(139, 233, 255, 0.035)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.018), transparent 24%), linear-gradient(135deg, rgba(8, 42, 66, 0.052), rgba(2, 14, 28, 0.078)), rgba(5, 24, 40, 0.22)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(139, 233, 255, 0.03), transparent 44%), linear-gradient(180deg, rgba(2, 14, 30, 0.035), rgba(2, 9, 20, 0.025)), var(--aelyris-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.018), transparent 24%), linear-gradient(145deg, rgba(8, 42, 66, 0.052), rgba(2, 14, 28, 0.078)), rgba(5, 24, 40, 0.28)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(8, 42, 66, 0.09), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.32)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.014), transparent 22%), linear-gradient(135deg, rgba(139, 233, 255, 0.02), transparent 44%), linear-gradient(315deg, rgba(216, 247, 255, 0.01), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(8, 42, 66, 0.09), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.31)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(8, 42, 66, 0.088), rgba(2, 16, 34, 0.108)), rgba(7, 34, 54, 0.31)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(8, 42, 66, 0.086), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.31)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(8, 42, 66, 0.086), rgba(2, 12, 28, 0.105)), rgba(5, 24, 40, 0.31)",
    "--mood-selection-bg": "rgba(139, 233, 255, 0.26)",
  },
  "aelyris-dream": {
    "--aelyris-ink": "#120d20",
    "--aelyris-obsidian": "#191329",
    "--aelyris-graphite": "#251d37",
    "--aelyris-smoke-mauve": "#342845",
    "--aelyris-moon": "#f2eaff",
    "--aelyris-champagne": "#ffd996",
    "--glass-clear": "rgba(128, 103, 190, 0.018)",
    "--glass-ground": "rgba(23, 17, 37, 0.24)",
    "--glass-frame": "rgba(82, 67, 119, 0.12)",
    "--glass-standard": "rgba(72, 58, 108, 0.14)",
    "--glass-dense": "rgba(61, 49, 91, 0.18)",
    "--glass-thick": "rgba(84, 68, 116, 0.22)",
    "--glass-solid": "rgba(30, 23, 45, 0.8)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(224, 206, 255, 0.12)",
    "--aelyris-border-strong": "rgba(239, 225, 255, 0.21)",
    "--accent": "#c8b6ff",
    "--gold": "#ffd996",
    "--gold-dim": "rgba(255, 217, 150, 0.36)",
    "--gold-subtle": "rgba(255, 217, 150, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0c2 0%, #ffd996 42%, #d7a95c 100%)",
    "--text-primary": "#fdf8ff",
    "--text-secondary": "#dfd3f3",
    "--text-muted": "#c8badf",
    "--text-on-accent": "#120d20",
    "--row-hover": "rgba(203, 182, 255, 0.08)",
    "--row-hover-strong": "rgba(231, 217, 255, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.055), transparent 45%), linear-gradient(180deg, rgba(18, 14, 29, 0.2), rgba(6, 4, 13, 0.36))",
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
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.038), transparent 44%), linear-gradient(180deg, rgba(40, 30, 61, 0.05), rgba(18, 13, 32, 0.03)), var(--aelyris-bg)",
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
  "aelyris-cute": {
    "--aelyris-ink": "#071916",
    "--aelyris-obsidian": "#0e211f",
    "--aelyris-graphite": "#17302e",
    "--aelyris-smoke-mauve": "#223b39",
    "--aelyris-moon": "#e8fffb",
    "--aelyris-champagne": "#ffd1dc",
    "--glass-clear": "rgba(91, 207, 194, 0.018)",
    "--glass-ground": "rgba(11, 31, 29, 0.24)",
    "--glass-frame": "rgba(55, 116, 110, 0.12)",
    "--glass-standard": "rgba(43, 96, 91, 0.14)",
    "--glass-dense": "rgba(34, 78, 74, 0.18)",
    "--glass-thick": "rgba(54, 112, 105, 0.22)",
    "--glass-solid": "rgba(14, 35, 33, 0.8)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(195, 255, 246, 0.12)",
    "--aelyris-border-strong": "rgba(218, 255, 250, 0.21)",
    "--accent": "#72f0dc",
    "--gold": "#ffd1dc",
    "--gold-dim": "rgba(255, 209, 220, 0.36)",
    "--gold-subtle": "rgba(255, 209, 220, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0f5 0%, #ffd1dc 42%, #d99aaa 100%)",
    "--text-primary": "#f6fffd",
    "--text-secondary": "#cfeae5",
    "--text-muted": "#bcd8d2",
    "--text-on-accent": "#071916",
    "--row-hover": "rgba(114, 240, 220, 0.08)",
    "--row-hover-strong": "rgba(188, 255, 244, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.055), transparent 45%), linear-gradient(180deg, rgba(10, 26, 25, 0.2), rgba(3, 12, 12, 0.36))",
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
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.038), transparent 44%), linear-gradient(180deg, rgba(25, 55, 51, 0.05), rgba(7, 25, 22, 0.03)), var(--aelyris-bg)",
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
  "aelyris-sakura": {
    "--aelyris-ink": "#24121b",
    "--aelyris-obsidian": "#fff7fb",
    "--aelyris-graphite": "#ffe9f0",
    "--aelyris-smoke-mauve": "#e8a6b8",
    "--aelyris-moon": "#fffafd",
    "--aelyris-champagne": "#823149",
    "--glass-clear": "rgba(255, 242, 248, 0.075)",
    "--glass-ground": "rgba(255, 243, 249, 0.58)",
    "--glass-frame": "rgba(255, 241, 248, 0.56)",
    "--glass-standard": "rgba(255, 240, 248, 0.68)",
    "--glass-dense": "rgba(255, 237, 246, 0.76)",
    "--glass-thick": "rgba(255, 234, 244, 0.84)",
    "--glass-solid": "rgba(255, 247, 251, 0.88)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(147, 55, 83, 0.22)",
    "--aelyris-border-strong": "rgba(130, 49, 73, 0.34)",
    "--accent": "#bd3f68",
    "--gold": "#823149",
    "--gold-dim": "rgba(130, 49, 73, 0.4)",
    "--gold-subtle": "rgba(189, 63, 104, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #ffd6df 0%, #e88fa7 42%, #823149 100%)",
    "--text-primary": "#24121b",
    "--text-secondary": "#3f2430",
    "--text-muted": "#674353",
    "--text-on-accent": "#fffaff",
    "--row-hover": "rgba(189, 63, 104, 0.13)",
    "--row-hover-strong": "rgba(189, 63, 104, 0.2)",
    "--terminal-canvas-bg": "rgba(83, 33, 56, 0.54)",
    "--terminal-raster-bg": "rgba(83, 33, 56, 0.88)",
    "--terminal-well-bg":
      "radial-gradient(ellipse at 44% -18%, rgba(255, 198, 219, 0.18), transparent 46%), radial-gradient(ellipse at 78% 18%, rgba(252, 201, 185, 0.1), transparent 38%), linear-gradient(180deg, rgba(111, 43, 73, 0.28), rgba(54, 22, 42, 0.42))",
    "--terminal-chrome-bg": "rgba(78, 31, 54, 0.42)",
    "--terminal-chrome-bg-focus": "rgba(91, 35, 62, 0.58)",
    "--terminal-rim-warm": "rgba(255, 205, 220, 0.22)",
    "--terminal-border": "rgba(255, 184, 210, 0.24)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255, 226, 237, 0.14), inset 0 0 0 1px rgba(255, 168, 196, 0.12), inset 0 30px 72px rgba(72, 26, 46, 0.16), inset 0 -22px 58px rgba(42, 16, 31, 0.15)",
    "--terminal-shell-shadow": "0 24px 68px rgba(80, 32, 52, 0.18), 0 0 44px rgba(189, 63, 104, 0.1)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(255, 174, 204, 0.14), inset 0 1px 0 rgba(255, 238, 245, 0.1), inset 0 26px 68px rgba(86, 32, 54, 0.14), inset 0 -20px 50px rgba(46, 18, 34, 0.13)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(255, 218, 228, 0.06), transparent 52px), linear-gradient(0deg, rgba(31, 10, 24, 0.16), transparent 42px), linear-gradient(90deg, rgba(232, 62, 122, 0.035), transparent 25%, transparent 74%, rgba(255, 210, 220, 0.03))",
    "--terminal-watermark-opacity": "0.032",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(189, 63, 104, 0.1))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(252, 201, 185, 0.11), transparent 35%), linear-gradient(300deg, rgba(189, 63, 104, 0.05), transparent 42%), linear-gradient(180deg, rgba(255, 250, 253, 0.08), rgba(255, 224, 237, 0.04))",
    "--mood-root-glow-opacity": "0.16",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(189, 63, 104, 0.01) 50%, transparent)",
    "--mood-root-texture-opacity": "0.038",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(255, 255, 255, 0.46), inset 0 0 0 1px rgba(130, 49, 73, 0.12), inset 0 -1px 0 rgba(130, 49, 73, 0.06)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 30%), linear-gradient(135deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.16)), rgba(255, 241, 248, 0.86)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(189, 63, 104, 0.05), transparent 44%), linear-gradient(180deg, rgba(255, 248, 252, 0.1), rgba(255, 222, 236, 0.06)), rgba(255, 248, 252, 0.06)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 26%), linear-gradient(145deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.17)), rgba(255, 241, 248, 0.88)",
    "--mood-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.36), rgba(255, 226, 237, 0.16)), rgba(255, 246, 250, 0.82)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 22%), linear-gradient(135deg, rgba(189, 63, 104, 0.075), transparent 44%), linear-gradient(315deg, rgba(252, 201, 185, 0.07), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.34), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.78)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(255, 250, 253, 0.34), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.76)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(255, 250, 253, 0.32), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.76)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(255, 247, 251, 0.3), rgba(255, 224, 235, 0.12)), rgba(255, 244, 250, 0.72)",
    "--mood-selection-bg": "rgba(189, 63, 104, 0.22)",
  },
  "aelyris-obsidian": {
    "--aelyris-ink": "#090b13",
    "--aelyris-obsidian": "#111017",
    "--aelyris-graphite": "#1b1920",
    "--aelyris-smoke-mauve": "#28232a",
    "--aelyris-moon": "#c7d2ee",
    "--aelyris-champagne": "#d8b766",
    "--glass-clear": "rgba(10, 9, 13, 0.018)",
    "--glass-ground": "rgba(13, 12, 15, 0.24)",
    "--glass-frame": "rgba(24, 22, 27, 0.12)",
    "--glass-standard": "rgba(26, 27, 32, 0.14)",
    "--glass-dense": "rgba(27, 26, 33, 0.18)",
    "--glass-thick": "rgba(36, 36, 44, 0.22)",
    "--glass-solid": "rgba(26, 26, 26, 0.78)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(231, 211, 168, 0.065)",
    "--aelyris-border-strong": "rgba(231, 211, 168, 0.12)",
    "--accent": "#4fc1ff",
    "--gold": "#d8b766",
    "--gold-dim": "rgba(216, 183, 102, 0.42)",
    "--gold-subtle": "rgba(216, 183, 102, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #f4df9a 0%, #dfc27c 24%, #d8b766 52%, #b78c3f 82%, #8f682f 100%)",
    "--text-primary": "#faf6eb",
    "--text-secondary": "#d7d2c6",
    "--text-muted": "#bdb6ab",
    "--text-on-accent": "#090b13",
    "--row-hover": "var(--white-6)",
    "--row-hover-strong": "var(--white-10)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.045), transparent 45%), linear-gradient(180deg, rgba(12, 13, 20, 0.22), rgba(4, 5, 9, 0.36))",
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
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.024), transparent 42%), linear-gradient(180deg, rgba(18, 15, 13, 0.04), rgba(9, 11, 18, 0.026)), var(--aelyris-bg)",
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
  "aelyris-pro": {
    "--aelyris-ink": "#080c10",
    "--aelyris-obsidian": "#0f1418",
    "--aelyris-graphite": "#1b2228",
    "--aelyris-smoke-mauve": "#273039",
    "--aelyris-moon": "#dce7ef",
    "--aelyris-champagne": "#c7b37a",
    "--glass-clear": "rgba(17, 25, 31, 0.018)",
    "--glass-ground": "rgba(13, 18, 22, 0.24)",
    "--glass-frame": "rgba(28, 36, 43, 0.12)",
    "--glass-standard": "rgba(32, 40, 48, 0.14)",
    "--glass-dense": "rgba(34, 42, 50, 0.18)",
    "--glass-thick": "rgba(45, 54, 63, 0.22)",
    "--glass-solid": "rgba(28, 34, 40, 0.8)",
    "--aelyris-bg": "var(--glass-clear)",
    "--aelyris-bg-sidebar": "var(--glass-standard)",
    "--aelyris-bg-elevated": "var(--glass-dense)",
    "--aelyris-bg-card": "var(--glass-thick)",
    "--aelyris-bg-surface": "var(--glass-dense)",
    "--aelyris-border": "rgba(203, 220, 232, 0.08)",
    "--aelyris-border-strong": "rgba(220, 235, 245, 0.14)",
    "--accent": "#9bc7df",
    "--gold": "#c7b37a",
    "--gold-dim": "rgba(199, 179, 122, 0.34)",
    "--gold-subtle": "rgba(199, 179, 122, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #e7dba7 0%, #c7b37a 45%, #9a844b 100%)",
    "--text-primary": "#f1f7fa",
    "--text-secondary": "#ced9df",
    "--text-muted": "#b4c2cb",
    "--text-on-accent": "#080c10",
    "--row-hover": "rgba(155, 199, 223, 0.07)",
    "--row-hover-strong": "rgba(188, 220, 238, 0.11)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(155, 199, 223, 0.036), transparent 45%), linear-gradient(180deg, rgba(12, 17, 22, 0.2), rgba(4, 7, 10, 0.36))",
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
      "linear-gradient(180deg, rgba(124, 214, 235, 0.016), transparent 26%), linear-gradient(145deg, rgba(0, 126, 190, 0.034), transparent 48%), rgba(4, 13, 23, 0.26)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(72, 185, 220, 0.024), transparent 42%), linear-gradient(180deg, rgba(4, 13, 23, 0.14), rgba(1, 6, 12, 0.12)), var(--aelyris-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.018), transparent 24%), linear-gradient(145deg, rgba(0, 126, 190, 0.042), transparent 48%), rgba(4, 13, 23, 0.3)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.26)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(238, 246, 250, 0.028), transparent 22%), linear-gradient(135deg, rgba(155, 199, 223, 0.022), transparent 42%), linear-gradient(315deg, rgba(199, 179, 122, 0.016), transparent 48%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(5, 18, 31, 0.24), rgba(2, 9, 17, 0.3)), rgba(4, 13, 23, 0.24)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.22)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.22)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(5, 16, 28, 0.24), rgba(3, 10, 19, 0.3)), rgba(4, 13, 23, 0.28)",
    "--mood-selection-bg": "rgba(155, 199, 223, 0.22)",
  },
};

export const MOOD_CSS_KEYS: readonly string[] = Object.freeze(
  Array.from(
    new Set([
      ...Object.values(MOOD_CSS).flatMap((vars) => Object.keys(vars)),
      ...MOOD_SURFACE_CSS_KEYS,
      ...SAKURA_MATERIAL_CSS_KEYS,
    ]),
  ).sort(),
);
