//! Modal dialog system — centered overlay with form fields.
//!
//! Renders a dark scrim, centered dialog box with rounded corners,
//! title, input fields, and Cancel/Confirm buttons.
//! Uses the same RectInstance + GlyphInstance pipeline as the palette.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, GradientRectInstance, RectInstance};
use super::cat;

const DIALOG_WIDTH: f32 = 380.0;
const FIELD_HEIGHT: f32 = 28.0;
const BUTTON_HEIGHT: f32 = 32.0;
const PADDING: f32 = 16.0;
const CORNER_RADIUS: f32 = 12.0;
const FIELD_RADIUS: f32 = 8.0;
const LABEL_FIELD_GAP: f32 = 4.0;

/// A single input field in a dialog.
pub enum DialogField {
    /// Single-line text input.
    TextInput {
        label: String,
        value: String,
        placeholder: String,
    },
    /// Multi-line text area.
    TextArea {
        label: String,
        value: String,
        placeholder: String,
        lines: usize,
    },
}

impl DialogField {
    fn label(&self) -> &str {
        match self {
            DialogField::TextInput { label, .. } => label,
            DialogField::TextArea { label, .. } => label,
        }
    }

    fn value(&self) -> &str {
        match self {
            DialogField::TextInput { value, .. } => value,
            DialogField::TextArea { value, .. } => value,
        }
    }

    fn value_mut(&mut self) -> &mut String {
        match self {
            DialogField::TextInput { value, .. } => value,
            DialogField::TextArea { value, .. } => value,
        }
    }

    fn placeholder(&self) -> &str {
        match self {
            DialogField::TextInput { placeholder, .. } => placeholder,
            DialogField::TextArea { placeholder, .. } => placeholder,
        }
    }

    /// Height of this field's input area in pixels.
    fn input_height(&self, cell_height: f32) -> f32 {
        match self {
            DialogField::TextInput { .. } => FIELD_HEIGHT,
            DialogField::TextArea { lines, .. } => {
                let line_count = (*lines).max(2) as f32;
                (cell_height * line_count + PADDING).max(FIELD_HEIGHT)
            }
        }
    }
}

/// Result of closing a dialog.
pub enum DialogResult {
    /// User confirmed — contains the value of each field in order.
    Confirmed(Vec<String>),
    /// User cancelled.
    Cancelled,
}

/// State for a modal dialog overlay.
pub struct DialogState {
    pub visible: bool,
    pub title: String,
    pub fields: Vec<DialogField>,
    pub focused_field: usize,
    pub confirm_label: String,
}

/// Rendering output from the dialog.
pub struct DialogOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
    pub gradient_rects: Vec<GradientRectInstance>,
}

impl DialogState {
    /// Create a new hidden dialog with no fields.
    pub fn new() -> Self {
        Self {
            visible: false,
            title: String::new(),
            fields: Vec::new(),
            focused_field: 0,
            confirm_label: "Confirm".to_string(),
        }
    }

    /// Show the dialog with the given title, fields, and confirm button label.
    pub fn show(&mut self, title: String, fields: Vec<DialogField>, confirm_label: String) {
        self.visible = true;
        self.title = title;
        self.fields = fields;
        self.focused_field = 0;
        self.confirm_label = confirm_label;
    }

    /// Close the dialog without confirming (returns Cancelled).
    pub fn close(&mut self) -> DialogResult {
        self.visible = false;
        self.title.clear();
        self.fields.clear();
        self.focused_field = 0;
        DialogResult::Cancelled
    }

    /// Confirm the dialog and return field values.
    pub fn confirm(&mut self) -> DialogResult {
        let values: Vec<String> = self
            .fields
            .iter()
            .map(|f| f.value().to_string())
            .collect();
        self.visible = false;
        self.title.clear();
        self.fields.clear();
        self.focused_field = 0;
        DialogResult::Confirmed(values)
    }

    /// Insert a character (or string) into the currently focused field.
    pub fn insert_char(&mut self, ch: &str) {
        if let Some(field) = self.fields.get_mut(self.focused_field) {
            field.value_mut().push_str(ch);
        }
    }

    /// Delete the last character from the currently focused field.
    pub fn backspace(&mut self) {
        if let Some(field) = self.fields.get_mut(self.focused_field) {
            field.value_mut().pop();
        }
    }

    /// Move focus to the next field (wraps around).
    pub fn focus_next(&mut self) {
        if !self.fields.is_empty() {
            self.focused_field = (self.focused_field + 1) % self.fields.len();
        }
    }

    /// Build the visual output for one frame.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
        window_h: f32,
    ) -> DialogOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let mut gradient_rects = Vec::new();

        if !self.visible {
            return DialogOutput { rects, glyphs, gradient_rects };
        }

        // Calculate total dialog height
        let title_row_h = font.cell_height + PADDING;
        let fields_h: f32 = self
            .fields
            .iter()
            .map(|f| font.cell_height + LABEL_FIELD_GAP + f.input_height(font.cell_height) + PADDING)
            .sum();
        let buttons_h = BUTTON_HEIGHT + PADDING;
        let dialog_h = PADDING + title_row_h + fields_h + buttons_h + PADDING;

        let dialog_x = (window_w - DIALOG_WIDTH) / 2.0;
        let dialog_y = (window_h - dialog_h) / 2.0;

        // Dark scrim overlay — rgba(0,0,0,0.5)
        rects.push(RectInstance::new(
            [0.0, 0.0],
            [window_w, window_h],
            [0.0, 0.0, 0.0, 0.5],
        ));

        // GPU SDF shadow (24px blur) + glass-solid background
        gradient_rects.push(GradientRectInstance::shadowed(
            [dialog_x, dialog_y],
            [DIALOG_WIDTH, dialog_h],
            cat::GLASS_SOLID,
            CORNER_RADIUS,
            24.0, 0.5,
        ));

        // Border: 1px rgba(255,255,255,0.1)
        rects.push(RectInstance::bordered(
            [dialog_x, dialog_y],
            [DIALOG_WIDTH, dialog_h],
            [0.0, 0.0, 0.0, 0.0],
            CORNER_RADIUS,
            1.0,
            0.1,
        ));

        let mut cursor_y = dialog_y + PADDING;

        // Title text — 15px, weight 600, rgba(255,255,255,0.88) text-primary
        let title_text_y = cursor_y + (font.cell_height - font.cell_height) / 2.0;
        let text_primary: [f32; 4] = [0.88, 0.88, 0.88, 0.88];
        super::render_text(
            font,
            atlas,
            &self.title,
            dialog_x + PADDING,
            title_text_y,
            text_primary,
            &mut glyphs,
        );
        cursor_y += title_row_h;

        // Fields
        let inner_w = DIALOG_WIDTH - PADDING * 2.0;
        for (i, field) in self.fields.iter().enumerate() {
            let is_focused = i == self.focused_field;

            // Label — text-secondary
            let text_secondary: [f32; 4] = [0.5, 0.5, 0.5, 0.5];
            super::render_text(
                font,
                atlas,
                field.label(),
                dialog_x + PADDING,
                cursor_y,
                text_secondary,
                &mut glyphs,
            );
            cursor_y += font.cell_height + LABEL_FIELD_GAP;

            let input_h = field.input_height(font.cell_height);

            // Input field background: rgba(255,255,255,0.04)
            // Border: 1px rgba(255,255,255,0.1), focus border: gold #c8a050
            // Corner radius: 8 (FIELD_RADIUS)
            let field_bg: [f32; 4] = [0.04, 0.04, 0.04, 0.04]; // rgba(255,255,255,0.04)
            rects.push(RectInstance::rounded(
                [dialog_x + PADDING, cursor_y],
                [inner_w, input_h],
                field_bg,
                FIELD_RADIUS,
            ));

            // Field border (4 thin rects)
            {
                let border_color = if is_focused {
                    // gold #c8a050 — focus border
                    [200.0 / 255.0, 160.0 / 255.0, 80.0 / 255.0, 1.0]
                } else {
                    // rgba(255,255,255,0.1)
                    [0.1, 0.1, 0.1, 0.1]
                };
                let bx = dialog_x + PADDING;
                let by = cursor_y;
                // Top
                rects.push(RectInstance::new([bx, by], [inner_w, 1.0], border_color));
                // Bottom
                rects.push(RectInstance::new(
                    [bx, by + input_h - 1.0],
                    [inner_w, 1.0],
                    border_color,
                ));
                // Left
                rects.push(RectInstance::new([bx, by], [1.0, input_h], border_color));
                // Right
                rects.push(RectInstance::new(
                    [bx + inner_w - 1.0, by],
                    [1.0, input_h],
                    border_color,
                ));
            }

            // Field text or placeholder
            let text_y = cursor_y + (input_h - font.cell_height) / 2.0;
            let text_x = dialog_x + PADDING + 6.0;
            let text_muted: [f32; 4] = [0.3, 0.3, 0.3, 0.3]; // rgba(255,255,255,0.3)
            if field.value().is_empty() {
                super::render_text(
                    font,
                    atlas,
                    field.placeholder(),
                    text_x,
                    text_y,
                    text_muted,
                    &mut glyphs,
                );
            } else {
                super::render_text(
                    font,
                    atlas,
                    field.value(),
                    text_x,
                    text_y,
                    text_primary,
                    &mut glyphs,
                );
            }

            // Text cursor for focused field
            if is_focused {
                let cursor_x = text_x + field.value().chars().count() as f32 * font.cell_width;
                rects.push(RectInstance::new(
                    [cursor_x, text_y],
                    [2.0, font.cell_height],
                    text_primary,
                ));
            }

            cursor_y += input_h + PADDING;
        }

        // Buttons row at bottom
        let button_y = cursor_y;
        let button_w = 90.0;
        let button_gap = 8.0;
        let buttons_total_w = button_w * 2.0 + button_gap;
        let buttons_x = dialog_x + DIALOG_WIDTH - PADDING - buttons_total_w;

        // Cancel button — transparent bg, 1px border rgba(255,255,255,0.1), radius 8
        let cancel_x = buttons_x;
        // Draw border for cancel button (4 thin rects)
        {
            let bcolor: [f32; 4] = [0.1, 0.1, 0.1, 0.1]; // rgba(255,255,255,0.1)
            rects.push(RectInstance::new([cancel_x, button_y], [button_w, 1.0], bcolor));
            rects.push(RectInstance::new([cancel_x, button_y + BUTTON_HEIGHT - 1.0], [button_w, 1.0], bcolor));
            rects.push(RectInstance::new([cancel_x, button_y], [1.0, BUTTON_HEIGHT], bcolor));
            rects.push(RectInstance::new([cancel_x + button_w - 1.0, button_y], [1.0, BUTTON_HEIGHT], bcolor));
        }
        let cancel_text = "Cancel";
        let cancel_text_x =
            cancel_x + (button_w - cancel_text.chars().count() as f32 * font.cell_width) / 2.0;
        let cancel_text_y = button_y + (BUTTON_HEIGHT - font.cell_height) / 2.0;
        super::render_text(
            font,
            atlas,
            cancel_text,
            cancel_text_x,
            cancel_text_y,
            text_primary,
            &mut glyphs,
        );

        // Confirm button — 18K gold gradient, dark text, radius 8
        let confirm_x = cancel_x + button_w + button_gap;
        let dark_text: [f32; 4] = [0.1, 0.1, 0.1, 1.0]; // dark text on gold
        gradient_rects.push(GradientRectInstance::gold_button(
            [confirm_x, button_y],
            [button_w, BUTTON_HEIGHT],
            FIELD_RADIUS,
        ));
        let confirm_text_x = confirm_x
            + (button_w - self.confirm_label.chars().count() as f32 * font.cell_width) / 2.0;
        let confirm_text_y = button_y + (BUTTON_HEIGHT - font.cell_height) / 2.0;
        super::render_text(
            font,
            atlas,
            &self.confirm_label,
            confirm_text_x,
            confirm_text_y,
            dark_text,
            &mut glyphs,
        );

        DialogOutput { rects, glyphs, gradient_rects }
    }
}

impl Default for DialogState {
    fn default() -> Self {
        Self::new()
    }
}
