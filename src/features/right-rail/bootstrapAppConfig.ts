import type { WallpaperSettings } from "../../shared/store/appStore";
import type { AccentOverrides } from "../../shared/themes/catppuccin";
import type { MoodMaterialOverrides, MoodPresetId } from "../../shared/themes/moods";
import type { RightRailGuardrailSelection, RightRailWidgetId } from "./rightRailModel";

export type BootstrapAppConfig = {
  appearance: {
    theme: string;
    mood_preset?: string;
    opacity?: number;
    ui_font_family?: string;
    terminal_font_family?: string;
    font_size?: number;
    terminal_text_clarity?: "glass" | "balanced" | "solid";
    terminal_surface_opacity?: number;
    line_height?: number;
    ligatures?: boolean;
    window_effect?: string;
    theme_overrides?: Record<string, AccentOverrides>;
    mood_material_overrides?: Partial<Record<MoodPresetId, MoodMaterialOverrides>>;
    wallpaper_settings_by_mood?: Partial<Record<MoodPresetId, Partial<WallpaperSettings>>>;
  };
  terminal?: { default_shell?: string; cursor_style?: string; cursor_blink?: boolean };
  ghost_diff?: { live_mode?: boolean };
  workspace_profile?: {
    global_defaults?: {
      pane_layout?: {
        right_rail_guardrail_profile?: RightRailGuardrailSelection;
        right_rail_widgets?: Partial<Record<RightRailWidgetId, boolean>>;
      };
    };
  };
};
