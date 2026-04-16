//! Dynamic theme system with 7 preset themes.
//!
//! Colors are runtime-switchable via `set_theme()`.
//! The active theme is stored in a global RwLock.

use std::sync::RwLock;

/// All color slots used by UI and terminal rendering.
#[derive(Clone)]
pub struct Theme {
    pub name: &'static str,
    // Base
    pub bg: [f32; 4],
    pub mantle: [f32; 4],
    pub crust: [f32; 4],
    // Surface
    pub surface0: [f32; 4],
    pub surface1: [f32; 4],
    pub surface2: [f32; 4],
    // Overlay
    pub overlay0: [f32; 4],
    pub overlay1: [f32; 4],
    // Text
    pub text: [f32; 4],
    pub subtext1: [f32; 4],
    pub subtext0: [f32; 4],
    // Accent colors (non-premultiplied)
    pub red: [f32; 4],
    pub green: [f32; 4],
    pub blue: [f32; 4],
    pub yellow: [f32; 4],
    pub peach: [f32; 4],
    pub mauve: [f32; 4],
    pub teal: [f32; 4],
    pub sky: [f32; 4],
    pub pink: [f32; 4],
    pub flamingo: [f32; 4],
    pub rosewater: [f32; 4],
    pub maroon: [f32; 4],
    pub lavender: [f32; 4],
    // Terminal ANSI palette (16 colors, RGB only)
    pub ansi: [[f32; 3]; 16],
    // Chrome-specific (premultiplied)
    pub tab_bar_bg: [f32; 4],
    pub tab_active: [f32; 4],
    pub status_bg: [f32; 4],
    pub close_hover: [f32; 4],
    pub btn_hover: [f32; 4],
}

fn c(r: u8, g: u8, b: u8) -> [f32; 4] {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0]
}

fn c3(r: u8, g: u8, b: u8) -> [f32; 3] {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0]
}

fn pm(r: u8, g: u8, b: u8, a: u8) -> [f32; 4] {
    let af = a as f32 / 255.0;
    [r as f32 / 255.0 * af, g as f32 / 255.0 * af, b as f32 / 255.0 * af, af]
}

pub fn catppuccin_mocha() -> Theme {
    Theme {
        name: "catppuccin-mocha",
        bg: [0.0, 0.0, 0.0, 0.0],
        mantle: c(24, 24, 37),
        crust: c(17, 17, 27),
        surface0: c(49, 50, 68),
        surface1: c(69, 71, 90),
        surface2: c(88, 91, 112),
        overlay0: [0.42, 0.44, 0.53, 1.0],
        overlay1: [0.53, 0.55, 0.63, 1.0],
        text: [0.81, 0.83, 0.88, 1.0],
        subtext1: [0.73, 0.76, 0.87, 1.0],
        subtext0: [0.65, 0.68, 0.78, 1.0],
        red: c(243, 139, 168),
        green: c(166, 227, 161),
        blue: c(137, 180, 250),
        yellow: c(249, 226, 175),
        peach: c(250, 179, 135),
        mauve: c(203, 166, 247),
        teal: c(148, 226, 213),
        sky: c(137, 220, 235),
        pink: c(245, 194, 231),
        flamingo: c(242, 205, 205),
        rosewater: c(245, 224, 220),
        maroon: c(235, 160, 172),
        lavender: c(180, 190, 254),
        ansi: [
            c3(49, 50, 68), c3(243, 139, 168), c3(166, 227, 161), c3(249, 226, 175),
            c3(137, 180, 250), c3(203, 166, 247), c3(148, 226, 213), c3(186, 194, 222),
            c3(88, 91, 112), c3(243, 139, 168), c3(166, 227, 161), c3(249, 226, 175),
            c3(137, 180, 250), c3(203, 166, 247), c3(148, 226, 213), c3(205, 214, 244),
        ],
        tab_bar_bg: pm(20, 20, 33, 235),
        tab_active: pm(49, 50, 68, 245),
        status_bg: pm(24, 24, 37, 235),
        close_hover: pm(200, 60, 60, 180),
        btn_hover: pm(69, 71, 90, 120),
    }
}

pub fn catppuccin_latte() -> Theme {
    Theme {
        name: "catppuccin-latte",
        bg: c(239, 241, 245),
        mantle: c(230, 233, 239),
        crust: c(220, 224, 232),
        surface0: c(204, 208, 218),
        surface1: c(188, 192, 204),
        surface2: c(172, 176, 190),
        overlay0: [0.61, 0.64, 0.69, 1.0],
        overlay1: [0.53, 0.55, 0.60, 1.0],
        text: [0.30, 0.32, 0.38, 1.0],
        subtext1: [0.36, 0.39, 0.45, 1.0],
        subtext0: [0.43, 0.45, 0.51, 1.0],
        red: c(210, 15, 57),
        green: c(64, 160, 43),
        blue: c(30, 102, 245),
        yellow: c(223, 142, 29),
        peach: c(254, 100, 11),
        mauve: c(136, 57, 239),
        teal: c(23, 146, 153),
        sky: c(4, 165, 229),
        pink: c(234, 118, 203),
        flamingo: c(221, 120, 120),
        rosewater: c(220, 138, 120),
        maroon: c(230, 69, 83),
        lavender: c(114, 135, 253),
        ansi: [
            c3(204, 208, 218), c3(210, 15, 57), c3(64, 160, 43), c3(223, 142, 29),
            c3(30, 102, 245), c3(136, 57, 239), c3(23, 146, 153), c3(92, 95, 119),
            c3(172, 176, 190), c3(210, 15, 57), c3(64, 160, 43), c3(223, 142, 29),
            c3(30, 102, 245), c3(136, 57, 239), c3(23, 146, 153), c3(76, 79, 105),
        ],
        tab_bar_bg: pm(230, 233, 239, 245),
        tab_active: pm(204, 208, 218, 255),
        status_bg: pm(230, 233, 239, 245),
        close_hover: pm(210, 15, 57, 180),
        btn_hover: pm(172, 176, 190, 120),
    }
}

pub fn dracula() -> Theme {
    Theme {
        name: "dracula",
        bg: c(40, 42, 54),
        mantle: c(33, 34, 44),
        crust: c(25, 26, 34),
        surface0: c(55, 57, 72),
        surface1: c(68, 71, 90),
        surface2: c(80, 83, 105),
        overlay0: [0.38, 0.40, 0.50, 1.0],
        overlay1: [0.45, 0.48, 0.58, 1.0],
        text: c(248, 248, 242),
        subtext1: c(220, 220, 210),
        subtext0: c(190, 190, 180),
        red: c(255, 85, 85),
        green: c(80, 250, 123),
        blue: c(98, 114, 164),
        yellow: c(241, 250, 140),
        peach: c(255, 184, 108),
        mauve: c(189, 147, 249),
        teal: c(139, 233, 253),
        sky: c(139, 233, 253),
        pink: c(255, 121, 198),
        flamingo: c(255, 121, 198),
        rosewater: c(255, 146, 208),
        maroon: c(255, 85, 85),
        lavender: c(189, 147, 249),
        ansi: [
            c3(33, 34, 44), c3(255, 85, 85), c3(80, 250, 123), c3(241, 250, 140),
            c3(189, 147, 249), c3(255, 121, 198), c3(139, 233, 253), c3(248, 248, 242),
            c3(98, 114, 164), c3(255, 110, 110), c3(105, 255, 148), c3(255, 255, 165),
            c3(214, 172, 255), c3(255, 146, 218), c3(164, 255, 255), c3(255, 255, 255),
        ],
        tab_bar_bg: pm(33, 34, 44, 240),
        tab_active: pm(55, 57, 72, 245),
        status_bg: pm(33, 34, 44, 240),
        close_hover: pm(255, 85, 85, 180),
        btn_hover: pm(68, 71, 90, 120),
    }
}

pub fn tokyo_night() -> Theme {
    Theme {
        name: "tokyo-night",
        bg: c(26, 27, 38),
        mantle: c(22, 22, 30),
        crust: c(18, 18, 24),
        surface0: c(41, 46, 66),
        surface1: c(55, 59, 79),
        surface2: c(68, 73, 93),
        overlay0: [0.33, 0.35, 0.44, 1.0],
        overlay1: [0.40, 0.42, 0.53, 1.0],
        text: c(169, 177, 214),
        subtext1: c(150, 160, 200),
        subtext0: c(130, 140, 180),
        red: c(247, 118, 142),
        green: c(158, 206, 106),
        blue: c(122, 162, 247),
        yellow: c(224, 175, 104),
        peach: c(255, 158, 100),
        mauve: c(187, 154, 247),
        teal: c(115, 218, 202),
        sky: c(125, 207, 255),
        pink: c(255, 119, 168),
        flamingo: c(255, 119, 168),
        rosewater: c(255, 150, 190),
        maroon: c(219, 75, 75),
        lavender: c(187, 154, 247),
        ansi: [
            c3(65, 72, 104), c3(247, 118, 142), c3(158, 206, 106), c3(224, 175, 104),
            c3(122, 162, 247), c3(187, 154, 247), c3(115, 218, 202), c3(169, 177, 214),
            c3(86, 95, 137), c3(247, 118, 142), c3(158, 206, 106), c3(224, 175, 104),
            c3(122, 162, 247), c3(187, 154, 247), c3(115, 218, 202), c3(192, 202, 245),
        ],
        tab_bar_bg: pm(22, 22, 30, 240),
        tab_active: pm(41, 46, 66, 245),
        status_bg: pm(22, 22, 30, 240),
        close_hover: pm(247, 118, 142, 180),
        btn_hover: pm(55, 59, 79, 120),
    }
}

pub fn nord() -> Theme {
    Theme {
        name: "nord",
        bg: c(46, 52, 64),
        mantle: c(40, 46, 58),
        crust: c(36, 40, 52),
        surface0: c(59, 66, 82),
        surface1: c(67, 76, 94),
        surface2: c(76, 86, 106),
        overlay0: [0.38, 0.42, 0.50, 1.0],
        overlay1: [0.44, 0.49, 0.58, 1.0],
        text: c(236, 239, 244),
        subtext1: c(220, 225, 232),
        subtext0: c(200, 205, 215),
        red: c(191, 97, 106),
        green: c(163, 190, 140),
        blue: c(129, 161, 193),
        yellow: c(235, 203, 139),
        peach: c(208, 135, 112),
        mauve: c(180, 142, 173),
        teal: c(143, 188, 187),
        sky: c(136, 192, 208),
        pink: c(180, 142, 173),
        flamingo: c(208, 135, 112),
        rosewater: c(220, 160, 140),
        maroon: c(191, 97, 106),
        lavender: c(129, 161, 193),
        ansi: [
            c3(59, 66, 82), c3(191, 97, 106), c3(163, 190, 140), c3(235, 203, 139),
            c3(129, 161, 193), c3(180, 142, 173), c3(143, 188, 187), c3(229, 233, 240),
            c3(76, 86, 106), c3(191, 97, 106), c3(163, 190, 140), c3(235, 203, 139),
            c3(129, 161, 193), c3(180, 142, 173), c3(143, 188, 187), c3(236, 239, 244),
        ],
        tab_bar_bg: pm(40, 46, 58, 240),
        tab_active: pm(59, 66, 82, 245),
        status_bg: pm(40, 46, 58, 240),
        close_hover: pm(191, 97, 106, 180),
        btn_hover: pm(67, 76, 94, 120),
    }
}

pub fn gruvbox() -> Theme {
    Theme {
        name: "gruvbox",
        bg: c(40, 40, 40),
        mantle: c(30, 30, 30),
        crust: c(24, 24, 24),
        surface0: c(60, 56, 54),
        surface1: c(80, 73, 69),
        surface2: c(102, 92, 84),
        overlay0: [0.50, 0.44, 0.40, 1.0],
        overlay1: [0.57, 0.51, 0.47, 1.0],
        text: c(235, 219, 178),
        subtext1: c(213, 196, 161),
        subtext0: c(189, 174, 147),
        red: c(251, 73, 52),
        green: c(184, 187, 38),
        blue: c(131, 165, 152),
        yellow: c(250, 189, 47),
        peach: c(254, 128, 25),
        mauve: c(211, 134, 155),
        teal: c(142, 192, 124),
        sky: c(131, 165, 152),
        pink: c(211, 134, 155),
        flamingo: c(254, 128, 25),
        rosewater: c(235, 219, 178),
        maroon: c(204, 36, 29),
        lavender: c(131, 165, 152),
        ansi: [
            c3(40, 40, 40), c3(204, 36, 29), c3(152, 151, 26), c3(215, 153, 33),
            c3(69, 133, 136), c3(177, 98, 134), c3(104, 157, 106), c3(168, 153, 132),
            c3(146, 131, 116), c3(251, 73, 52), c3(184, 187, 38), c3(250, 189, 47),
            c3(131, 165, 152), c3(211, 134, 155), c3(142, 192, 124), c3(235, 219, 178),
        ],
        tab_bar_bg: pm(30, 30, 30, 240),
        tab_active: pm(60, 56, 54, 245),
        status_bg: pm(30, 30, 30, 240),
        close_hover: pm(251, 73, 52, 180),
        btn_hover: pm(80, 73, 69, 120),
    }
}

pub fn one_dark() -> Theme {
    Theme {
        name: "one-dark",
        bg: c(40, 44, 52),
        mantle: c(33, 37, 43),
        crust: c(28, 31, 37),
        surface0: c(50, 56, 66),
        surface1: c(62, 68, 81),
        surface2: c(76, 82, 99),
        overlay0: [0.38, 0.40, 0.46, 1.0],
        overlay1: [0.45, 0.48, 0.54, 1.0],
        text: c(171, 178, 191),
        subtext1: c(152, 159, 172),
        subtext0: c(130, 137, 150),
        red: c(224, 108, 117),
        green: c(152, 195, 121),
        blue: c(97, 175, 239),
        yellow: c(229, 192, 123),
        peach: c(209, 154, 102),
        mauve: c(198, 120, 221),
        teal: c(86, 182, 194),
        sky: c(97, 175, 239),
        pink: c(198, 120, 221),
        flamingo: c(209, 154, 102),
        rosewater: c(224, 108, 117),
        maroon: c(190, 80, 70),
        lavender: c(97, 175, 239),
        ansi: [
            c3(50, 56, 66), c3(224, 108, 117), c3(152, 195, 121), c3(229, 192, 123),
            c3(97, 175, 239), c3(198, 120, 221), c3(86, 182, 194), c3(171, 178, 191),
            c3(92, 99, 112), c3(224, 108, 117), c3(152, 195, 121), c3(229, 192, 123),
            c3(97, 175, 239), c3(198, 120, 221), c3(86, 182, 194), c3(200, 207, 220),
        ],
        tab_bar_bg: pm(33, 37, 43, 240),
        tab_active: pm(50, 56, 66, 245),
        status_bg: pm(33, 37, 43, 240),
        close_hover: pm(224, 108, 117, 180),
        btn_hover: pm(62, 68, 81, 120),
    }
}

/// Global active theme.
static ACTIVE_THEME: RwLock<Option<Theme>> = RwLock::new(None);

/// Get the current theme (defaults to Catppuccin Mocha).
pub fn current() -> Theme {
    let guard = ACTIVE_THEME.read().unwrap();
    guard.clone().unwrap_or_else(catppuccin_mocha)
}

/// Set the active theme by name.
pub fn set_theme(name: &str) {
    let theme = match name {
        "catppuccin-mocha" => catppuccin_mocha(),
        "catppuccin-latte" => catppuccin_latte(),
        "dracula" => dracula(),
        "tokyo-night" => tokyo_night(),
        "nord" => nord(),
        "gruvbox" => gruvbox(),
        "one-dark" => one_dark(),
        _ => catppuccin_mocha(),
    };
    *ACTIVE_THEME.write().unwrap() = Some(theme);
}

/// List all available theme names.
pub fn available_themes() -> Vec<&'static str> {
    vec![
        "catppuccin-mocha",
        "catppuccin-latte",
        "dracula",
        "tokyo-night",
        "nord",
        "gruvbox",
        "one-dark",
    ]
}
