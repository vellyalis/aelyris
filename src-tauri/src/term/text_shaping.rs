//! Native terminal text-shaping boundary.
//!
//! This module owns the renderer-independent shaping contract. The current
//! winit/wgpu proof still uses a `fontdue` atlas for presentation, but Windows
//! builds now have a DirectWrite-backed shaping/fallback boundary that can feed
//! the renderer without pretending the visual dogfood is complete.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use windows_core::{implement, ComObject, Interface};

const TEXT_SHAPING_SCHEMA: &str = "aelyris.native.text-shaping.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    pub attrs: u16,
    pub bold: bool,
    pub italic: bool,
}

impl Default for CellStyle {
    fn default() -> Self {
        Self {
            attrs: 0,
            bold: false,
            italic: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeInput {
    pub text: String,
    pub style: CellStyle,
    pub cell_width_px: u16,
    pub cell_height_px: u16,
    pub allow_ligatures: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextShapingBackend {
    PolicyFallback,
    SystemDeferred,
    SystemDirectWrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LigaturePolicy {
    DisabledUntilSystemShaper,
    DirectWriteLayoutNoTerminalLigatureClaim,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontFallbackClass {
    PrimaryMonospace,
    Japanese,
    Emoji,
    Powerline,
    NerdFont,
    BoxDrawing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFaceRef {
    pub family: String,
    pub fallback_class: FontFallbackClass,
    pub source: String,
    pub font_file_path: Option<String>,
    pub font_collection_index: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphCluster {
    pub text: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub cell_advance: u16,
    pub fallback_class: FontFallbackClass,
    pub font: FontFaceRef,
    pub fallback_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub backend: TextShapingBackend,
    pub implemented: bool,
    pub release_blocking: bool,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTextShapingPolicy {
    pub schema: String,
    pub policy_backend: BackendStatus,
    pub required_system_backend: BackendStatus,
    pub system_capability: SystemTextShapingCapability,
    pub ligature_policy: LigaturePolicy,
    pub required_fallback_classes: Vec<FontFallbackClass>,
    pub ready_for_native_shaping_claim: bool,
    pub renderer_integration_ready: bool,
    pub visual_fixture_ready: bool,
    pub release_blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapedRun {
    pub schema: String,
    pub backend: TextShapingBackend,
    pub system_shaper_ready: bool,
    pub real_font_fallback_ready: bool,
    pub renderer_integration_ready: bool,
    pub visual_fixture_ready: bool,
    pub ready_for_native_shaping_claim: bool,
    pub ligatures_used: bool,
    pub clusters: Vec<GlyphCluster>,
    pub release_blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTextShapingCapability {
    pub schema: String,
    pub backend: TextShapingBackend,
    pub available: bool,
    pub directwrite_factory: bool,
    pub system_font_collection: bool,
    pub text_layout: bool,
    pub system_font_fallback: bool,
    pub renderer_integration_ready: bool,
    pub visual_fixture_ready: bool,
    pub ready_for_native_shaping_claim: bool,
    pub detail: String,
    pub blockers: Vec<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TextShapeError {
    #[error("native text shaping requires non-zero cell metrics, got {width_px}x{height_px}")]
    InvalidCellMetrics { width_px: u16, height_px: u16 },
    #[error("system text shaper is unavailable: {reason}")]
    SystemShaperUnavailable { reason: String },
}

pub trait TextShaper {
    fn shape_run(&self, input: &ShapeInput) -> Result<ShapedRun, TextShapeError>;
    fn resolve_fallback(&self, ch: char, style: &CellStyle) -> FontFaceRef;
    fn policy(&self) -> TerminalTextShapingPolicy;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PolicyTextShaper;

impl TextShaper for PolicyTextShaper {
    fn shape_run(&self, input: &ShapeInput) -> Result<ShapedRun, TextShapeError> {
        if input.cell_width_px == 0 || input.cell_height_px == 0 {
            return Err(TextShapeError::InvalidCellMetrics {
                width_px: input.cell_width_px,
                height_px: input.cell_height_px,
            });
        }

        let mut clusters: Vec<GlyphCluster> = Vec::new();
        for (start_byte, ch) in input.text.char_indices() {
            let end_byte = start_byte + ch.len_utf8();
            if is_combining_mark(ch) {
                if let Some(previous) = clusters.last_mut() {
                    previous.text.push(ch);
                    previous.end_byte = end_byte;
                    continue;
                }
            }

            let fallback_class = classify_char(ch);
            let font = self.resolve_fallback(ch, &input.style);
            let fallback_required = fallback_class != FontFallbackClass::PrimaryMonospace;
            clusters.push(GlyphCluster {
                text: ch.to_string(),
                start_byte,
                end_byte,
                cell_advance: cell_advance(ch),
                fallback_class,
                font,
                fallback_required,
            });
        }

        Ok(ShapedRun {
            schema: TEXT_SHAPING_SCHEMA.to_string(),
            backend: TextShapingBackend::PolicyFallback,
            system_shaper_ready: false,
            real_font_fallback_ready: false,
            renderer_integration_ready: false,
            visual_fixture_ready: false,
            ready_for_native_shaping_claim: false,
            ligatures_used: false,
            clusters,
            release_blockers: terminal_text_shaping_policy().release_blockers,
        })
    }

    fn resolve_fallback(&self, ch: char, _style: &CellStyle) -> FontFaceRef {
        let fallback_class = classify_char(ch);
        let (family, source) = match fallback_class {
            FontFallbackClass::PrimaryMonospace => ("Cascadia Mono", "primary-terminal-monospace"),
            FontFallbackClass::Japanese => ("Yu Gothic UI", "windows-cjk-fallback-required"),
            FontFallbackClass::Emoji => ("Segoe UI Emoji", "windows-color-emoji-fallback-required"),
            FontFallbackClass::Powerline => (
                "CaskaydiaCove Nerd Font",
                "powerline-private-use-fallback-required",
            ),
            FontFallbackClass::NerdFont => (
                "CaskaydiaCove Nerd Font",
                "nerd-font-private-use-fallback-required",
            ),
            FontFallbackClass::BoxDrawing => {
                ("Cascadia Mono", "box-drawing-terminal-glyph-required")
            }
        };
        FontFaceRef {
            family: family.to_string(),
            fallback_class,
            source: source.to_string(),
            font_file_path: None,
            font_collection_index: None,
        }
    }

    fn policy(&self) -> TerminalTextShapingPolicy {
        terminal_text_shaping_policy()
    }
}

#[cfg(target_os = "windows")]
#[implement(windows::Win32::Graphics::DirectWrite::IDWriteTextAnalysisSource)]
struct DirectWriteAnalysisSource {
    text: Vec<u16>,
    locale: Vec<u16>,
}

#[cfg(target_os = "windows")]
impl DirectWriteAnalysisSource {
    fn new(text: &str, locale: &str) -> Self {
        Self {
            text: text.encode_utf16().collect(),
            locale: utf16_null(locale),
        }
    }

    fn text_at(&self, text_position: u32) -> (*mut u16, u32) {
        let position = text_position as usize;
        if position >= self.text.len() {
            (std::ptr::null_mut(), 0)
        } else {
            (
                self.text[position..].as_ptr() as *mut u16,
                (self.text.len() - position).min(u32::MAX as usize) as u32,
            )
        }
    }
}

#[cfg(target_os = "windows")]
#[allow(non_snake_case)]
impl windows::Win32::Graphics::DirectWrite::IDWriteTextAnalysisSource_Impl
    for DirectWriteAnalysisSource_Impl
{
    fn GetTextAtPosition(
        &self,
        textposition: u32,
        textstring: *mut *mut u16,
        textlength: *mut u32,
    ) -> windows_core::Result<()> {
        let (ptr, len) = self.text_at(textposition);
        unsafe {
            if !textstring.is_null() {
                *textstring = ptr;
            }
            if !textlength.is_null() {
                *textlength = len;
            }
        }
        Ok(())
    }

    fn GetTextBeforePosition(
        &self,
        textposition: u32,
        textstring: *mut *mut u16,
        textlength: *mut u32,
    ) -> windows_core::Result<()> {
        let position = (textposition as usize).min(self.text.len());
        unsafe {
            if !textstring.is_null() {
                *textstring = if position == 0 {
                    std::ptr::null_mut()
                } else {
                    self.text.as_ptr() as *mut u16
                };
            }
            if !textlength.is_null() {
                *textlength = position.min(u32::MAX as usize) as u32;
            }
        }
        Ok(())
    }

    fn GetParagraphReadingDirection(
        &self,
    ) -> windows::Win32::Graphics::DirectWrite::DWRITE_READING_DIRECTION {
        windows::Win32::Graphics::DirectWrite::DWRITE_READING_DIRECTION_LEFT_TO_RIGHT
    }

    fn GetLocaleName(
        &self,
        textposition: u32,
        textlength: *mut u32,
        localename: *mut *mut u16,
    ) -> windows_core::Result<()> {
        let remaining = self
            .text
            .len()
            .saturating_sub(textposition as usize)
            .min(u32::MAX as usize) as u32;
        unsafe {
            if !textlength.is_null() {
                *textlength = remaining;
            }
            if !localename.is_null() {
                *localename = self.locale.as_ptr() as *mut u16;
            }
        }
        Ok(())
    }

    fn GetNumberSubstitution(
        &self,
        textposition: u32,
        textlength: *mut u32,
        numbersubstitution: windows_core::OutRef<
            windows::Win32::Graphics::DirectWrite::IDWriteNumberSubstitution,
        >,
    ) -> windows_core::Result<()> {
        let remaining = self
            .text
            .len()
            .saturating_sub(textposition as usize)
            .min(u32::MAX as usize) as u32;
        unsafe {
            if !textlength.is_null() {
                *textlength = remaining;
            }
        }
        numbersubstitution.write(None)
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
pub struct DirectWriteTextShaper {
    factory: windows::Win32::Graphics::DirectWrite::IDWriteFactory,
}

#[cfg(target_os = "windows")]
impl DirectWriteTextShaper {
    pub fn new() -> Result<Self, TextShapeError> {
        use windows::Win32::Graphics::DirectWrite::{
            DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
        };

        let factory = unsafe {
            DWriteCreateFactory::<IDWriteFactory>(DWRITE_FACTORY_TYPE_SHARED).map_err(|err| {
                TextShapeError::SystemShaperUnavailable {
                    reason: format!("DWriteCreateFactory failed: {err}"),
                }
            })?
        };

        Ok(Self { factory })
    }

    fn system_font_collection(
        &self,
    ) -> Result<windows::Win32::Graphics::DirectWrite::IDWriteFontCollection, TextShapeError> {
        let mut collection = None;
        unsafe {
            self.factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|err| TextShapeError::SystemShaperUnavailable {
                    reason: format!("GetSystemFontCollection failed: {err}"),
                })?;
        }
        collection.ok_or_else(|| TextShapeError::SystemShaperUnavailable {
            reason: "DirectWrite returned no system font collection".to_string(),
        })
    }

    fn create_text_layout(
        &self,
        input: &ShapeInput,
    ) -> Result<windows::Win32::Graphics::DirectWrite::IDWriteTextLayout, TextShapeError> {
        use windows::core::PCWSTR;
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_ITALIC, DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_WEIGHT_BOLD, DWRITE_FONT_WEIGHT_NORMAL,
        };

        let text = input.text.encode_utf16().collect::<Vec<_>>();
        let locale = utf16_null("ja-jp");
        let font_style = if input.style.italic {
            DWRITE_FONT_STYLE_ITALIC
        } else {
            DWRITE_FONT_STYLE_NORMAL
        };
        let font_weight = if input.style.bold {
            DWRITE_FONT_WEIGHT_BOLD
        } else {
            DWRITE_FONT_WEIGHT_NORMAL
        };
        let family = self
            .first_available_family(FontFallbackClass::PrimaryMonospace)
            .unwrap_or_else(|| "Consolas".to_string());
        let family = utf16_null(&family);
        let format = unsafe {
            self.factory
                .CreateTextFormat(
                    PCWSTR(family.as_ptr()),
                    None,
                    font_weight,
                    font_style,
                    DWRITE_FONT_STRETCH_NORMAL,
                    f32::from(input.cell_height_px).max(10.0),
                    PCWSTR(locale.as_ptr()),
                )
                .map_err(|err| TextShapeError::SystemShaperUnavailable {
                    reason: format!("CreateTextFormat failed: {err}"),
                })?
        };
        unsafe {
            self.factory
                .CreateTextLayout(
                    &text,
                    &format,
                    f32::from(input.cell_width_px).max(1.0) * 4096.0,
                    f32::from(input.cell_height_px).max(1.0) * 4.0,
                )
                .map_err(|err| TextShapeError::SystemShaperUnavailable {
                    reason: format!("CreateTextLayout failed: {err}"),
                })
        }
    }

    fn first_available_family(&self, fallback_class: FontFallbackClass) -> Option<String> {
        for family in fallback_candidates(fallback_class) {
            if self.family_exists(family) {
                return Some((*family).to_string());
            }
        }
        None
    }

    fn family_exists(&self, family: &str) -> bool {
        use windows::core::{BOOL, PCWSTR};

        let Ok(collection) = self.system_font_collection() else {
            return false;
        };
        let wide = utf16_null(family);
        let mut index = 0u32;
        let mut exists = BOOL(0);
        unsafe {
            collection
                .FindFamilyName(PCWSTR(wide.as_ptr()), &mut index, &mut exists)
                .is_ok()
                && exists.as_bool()
        }
    }

    fn resolve_directwrite_fallback(&self, ch: char, style: &CellStyle) -> Option<FontFaceRef> {
        use windows::core::{BOOL, PCWSTR};
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_ITALIC, DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_WEIGHT_BOLD, DWRITE_FONT_WEIGHT_NORMAL,
        };

        let collection = self.system_font_collection().ok()?;
        let fallback_class = classify_char(ch);
        let font_style = if style.italic {
            DWRITE_FONT_STYLE_ITALIC
        } else {
            DWRITE_FONT_STYLE_NORMAL
        };
        let font_weight = if style.bold {
            DWRITE_FONT_WEIGHT_BOLD
        } else {
            DWRITE_FONT_WEIGHT_NORMAL
        };

        for family in fallback_candidates(fallback_class) {
            let wide = utf16_null(family);
            let mut index = 0u32;
            let mut exists = BOOL(0);
            unsafe {
                collection
                    .FindFamilyName(PCWSTR(wide.as_ptr()), &mut index, &mut exists)
                    .ok()?;
            }
            if !exists.as_bool() {
                continue;
            }
            let font_family = unsafe { collection.GetFontFamily(index).ok()? };
            let font = unsafe {
                font_family
                    .GetFirstMatchingFont(font_weight, DWRITE_FONT_STRETCH_NORMAL, font_style)
                    .ok()?
            };
            let supports_char = unsafe { font.HasCharacter(ch as u32).ok()?.as_bool() };
            if supports_char || fallback_class == FontFallbackClass::PrimaryMonospace {
                let font_file = directwrite_font_file_ref(&font);
                return Some(FontFaceRef {
                    family: family.to_string(),
                    fallback_class,
                    source: "directwrite-installed-family-candidate".to_string(),
                    font_file_path: font_file.as_ref().map(|file| file.path.clone()),
                    font_collection_index: font_file.map(|file| file.collection_index),
                });
            }
        }

        None
    }

    fn resolve_mapped_font_fallback(&self, text: &str, style: &CellStyle) -> Option<FontFaceRef> {
        use windows::core::PCWSTR;
        use windows::Win32::Graphics::DirectWrite::{
            IDWriteFactory2, IDWriteTextAnalysisSource, DWRITE_FONT_STRETCH_NORMAL,
            DWRITE_FONT_STYLE_ITALIC, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_BOLD,
            DWRITE_FONT_WEIGHT_NORMAL,
        };

        let fallback_class = classify_cluster(text);
        if fallback_class == FontFallbackClass::PrimaryMonospace {
            return self
                .first_available_family(fallback_class)
                .map(|family| FontFaceRef {
                    family,
                    fallback_class,
                    source: "directwrite-primary-family".to_string(),
                    font_file_path: None,
                    font_collection_index: None,
                });
        }

        let factory2 = self.factory.cast::<IDWriteFactory2>().ok()?;
        let fallback = unsafe { factory2.GetSystemFontFallback().ok()? };
        let collection = self.system_font_collection().ok()?;
        let base_family = self
            .first_available_family(FontFallbackClass::PrimaryMonospace)
            .unwrap_or_else(|| "Consolas".to_string());
        let base_family = utf16_null(&base_family);
        let source: IDWriteTextAnalysisSource =
            ComObject::new(DirectWriteAnalysisSource::new(text, "ja-jp")).into_interface();
        let text_len = text.encode_utf16().count().min(u32::MAX as usize) as u32;
        if text_len == 0 {
            return None;
        }
        let font_style = if style.italic {
            DWRITE_FONT_STYLE_ITALIC
        } else {
            DWRITE_FONT_STYLE_NORMAL
        };
        let font_weight = if style.bold {
            DWRITE_FONT_WEIGHT_BOLD
        } else {
            DWRITE_FONT_WEIGHT_NORMAL
        };
        let mut mapped_length = 0u32;
        let mut mapped_font = None;
        let mut scale = 1.0f32;
        unsafe {
            fallback
                .MapCharacters(
                    &source,
                    0,
                    text_len,
                    &collection,
                    PCWSTR(base_family.as_ptr()),
                    font_weight,
                    font_style,
                    DWRITE_FONT_STRETCH_NORMAL,
                    &mut mapped_length,
                    &mut mapped_font,
                    &mut scale,
                )
                .ok()?;
        }
        let mapped_font = mapped_font?;
        let family = directwrite_font_family_name(&mapped_font)
            .unwrap_or_else(|| "DirectWrite mapped font".to_string());
        let font_file = directwrite_font_file_ref(&mapped_font);

        Some(FontFaceRef {
            family,
            fallback_class,
            source: format!("directwrite-map-characters:len={mapped_length}:scale={scale:.3}"),
            font_file_path: font_file.as_ref().map(|file| file.path.clone()),
            font_collection_index: font_file.map(|file| file.collection_index),
        })
    }

    fn resolve_fallback_for_cluster(&self, text: &str, style: &CellStyle) -> FontFaceRef {
        self.resolve_mapped_font_fallback(text, style)
            .or_else(|| {
                representative_char_for_fallback(text)
                    .and_then(|ch| self.resolve_directwrite_fallback(ch, style))
            })
            .unwrap_or_else(|| {
                representative_char_for_fallback(text)
                    .map(|ch| PolicyTextShaper.resolve_fallback(ch, style))
                    .unwrap_or_else(|| PolicyTextShaper.resolve_fallback(' ', style))
            })
    }
}

#[cfg(target_os = "windows")]
impl TextShaper for DirectWriteTextShaper {
    fn shape_run(&self, input: &ShapeInput) -> Result<ShapedRun, TextShapeError> {
        if input.cell_width_px == 0 || input.cell_height_px == 0 {
            return Err(TextShapeError::InvalidCellMetrics {
                width_px: input.cell_width_px,
                height_px: input.cell_height_px,
            });
        }

        let layout = self.create_text_layout(input)?;
        let utf16_len = input.text.encode_utf16().count().max(1);
        let mut metrics = vec![
                windows::Win32::Graphics::DirectWrite::DWRITE_CLUSTER_METRICS::default();
                utf16_len
            ];
        let mut actual_cluster_count = 0u32;
        unsafe {
            layout
                .GetClusterMetrics(Some(&mut metrics), &mut actual_cluster_count)
                .map_err(|err| TextShapeError::SystemShaperUnavailable {
                    reason: format!("GetClusterMetrics failed: {err}"),
                })?;
        }

        let mut clusters = Vec::new();
        let mut utf16_offset = 0usize;
        for metric in metrics.into_iter().take(actual_cluster_count as usize) {
            let length = usize::from(metric.length).max(1);
            let start_byte = byte_index_for_utf16_offset(&input.text, utf16_offset);
            let end_byte = byte_index_for_utf16_offset(&input.text, utf16_offset + length);
            utf16_offset += length;
            let text = input.text[start_byte..end_byte].to_string();
            let ch = representative_char_for_fallback(&text).unwrap_or(' ');
            let fallback_class = classify_cluster(&text);
            let font = self.resolve_fallback_for_cluster(&text, &input.style);
            let cell_advance = ((metric.width / f32::from(input.cell_width_px))
                .ceil()
                .max(f32::from(cell_advance(ch)))) as u16;

            clusters.push(GlyphCluster {
                text,
                start_byte,
                end_byte,
                cell_advance,
                fallback_class,
                font,
                fallback_required: fallback_class != FontFallbackClass::PrimaryMonospace,
            });
        }

        Ok(ShapedRun {
            schema: TEXT_SHAPING_SCHEMA.to_string(),
            backend: TextShapingBackend::SystemDirectWrite,
            system_shaper_ready: true,
            real_font_fallback_ready: clusters.iter().all(|cluster| {
                !cluster.fallback_required
                    || cluster
                        .font
                        .source
                        .starts_with("directwrite-map-characters")
            }),
            renderer_integration_ready: false,
            visual_fixture_ready: false,
            ready_for_native_shaping_claim: false,
            ligatures_used: false,
            clusters,
            release_blockers: terminal_text_shaping_policy().release_blockers,
        })
    }

    fn resolve_fallback(&self, ch: char, style: &CellStyle) -> FontFaceRef {
        self.resolve_directwrite_fallback(ch, style)
            .unwrap_or_else(|| PolicyTextShaper.resolve_fallback(ch, style))
    }

    fn policy(&self) -> TerminalTextShapingPolicy {
        terminal_text_shaping_policy()
    }
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Default, Clone, Copy)]
pub struct DirectWriteTextShaper;

#[cfg(not(target_os = "windows"))]
impl DirectWriteTextShaper {
    pub fn new() -> Result<Self, TextShapeError> {
        Err(TextShapeError::SystemShaperUnavailable {
            reason: "DirectWrite is only available on Windows".to_string(),
        })
    }
}

#[cfg(not(target_os = "windows"))]
impl TextShaper for DirectWriteTextShaper {
    fn shape_run(&self, _input: &ShapeInput) -> Result<ShapedRun, TextShapeError> {
        Err(TextShapeError::SystemShaperUnavailable {
            reason: "DirectWrite is only available on Windows".to_string(),
        })
    }

    fn resolve_fallback(&self, ch: char, style: &CellStyle) -> FontFaceRef {
        PolicyTextShaper.resolve_fallback(ch, style)
    }

    fn policy(&self) -> TerminalTextShapingPolicy {
        terminal_text_shaping_policy()
    }
}

pub fn terminal_text_shaping_policy() -> TerminalTextShapingPolicy {
    let system_capability = system_text_shaping_capability();
    let system_ready = system_capability.available;
    let mut release_blockers = Vec::new();
    if !system_ready {
        release_blockers.push(
            "native renderer must shape runs through a system-backed text shaper".to_string(),
        );
        release_blockers.push(
            "native renderer must resolve Japanese, emoji, Powerline, Nerd Font, and box-drawing fallback without '?' substitution".to_string(),
        );
    }
    if !system_capability.system_font_fallback {
        release_blockers.push(
            "native renderer must use real DirectWrite font fallback mapping, not only installed-family candidate checks".to_string(),
        );
    }
    if !system_capability.renderer_integration_ready {
        release_blockers.push(
            "winit/wgpu native renderer must consume DirectWrite shaped runs instead of the fontdue '?' atlas fallback".to_string(),
        );
    }
    if !system_capability.visual_fixture_ready {
        release_blockers.push(
            "native visual regression must prove ligature/no-ligature and fallback glyph cases"
                .to_string(),
        );
    }

    TerminalTextShapingPolicy {
        schema: TEXT_SHAPING_SCHEMA.to_string(),
        policy_backend: BackendStatus {
            backend: TextShapingBackend::PolicyFallback,
            implemented: true,
            release_blocking: false,
            detail: "classifies terminal glyph fallback requirements for tests and artifacts"
                .to_string(),
        },
        required_system_backend: BackendStatus {
            backend: if system_ready {
                TextShapingBackend::SystemDirectWrite
            } else {
                TextShapingBackend::SystemDeferred
            },
            implemented: system_ready,
            release_blocking: !system_ready,
            detail: if system_ready {
                "Windows DirectWrite text layout is available behind the terminal shaping trait; real font fallback mapping remains release-blocking"
                    .to_string()
            } else {
                "Windows DirectWrite text layout is not available to this build".to_string()
            },
        },
        system_capability,
        ligature_policy: if system_ready {
            LigaturePolicy::DirectWriteLayoutNoTerminalLigatureClaim
        } else {
            LigaturePolicy::DisabledUntilSystemShaper
        },
        required_fallback_classes: vec![
            FontFallbackClass::Japanese,
            FontFallbackClass::Emoji,
            FontFallbackClass::Powerline,
            FontFallbackClass::NerdFont,
            FontFallbackClass::BoxDrawing,
        ],
        ready_for_native_shaping_claim: false,
        renderer_integration_ready: false,
        visual_fixture_ready: false,
        release_blockers,
    }
}

pub fn system_text_shaping_capability() -> SystemTextShapingCapability {
    #[cfg(target_os = "windows")]
    {
        return system_text_shaping_capability_windows();
    }

    #[cfg(not(target_os = "windows"))]
    {
        SystemTextShapingCapability {
            schema: TEXT_SHAPING_SCHEMA.to_string(),
            backend: TextShapingBackend::SystemDirectWrite,
            available: false,
            directwrite_factory: false,
            system_font_collection: false,
            text_layout: false,
            system_font_fallback: false,
            renderer_integration_ready: false,
            visual_fixture_ready: false,
            ready_for_native_shaping_claim: false,
            detail: "DirectWrite system shaping is unavailable on this target/build".to_string(),
            blockers: vec![
                "wire DirectWrite shaped clusters into the winit/wgpu glyph atlas path".to_string(),
                "produce native visual fallback glyph and ligature policy fixtures".to_string(),
            ],
        }
    }
}

#[cfg(target_os = "windows")]
fn system_text_shaping_capability_windows() -> SystemTextShapingCapability {
    let shaper = DirectWriteTextShaper::new();
    let directwrite_factory = shaper.is_ok();
    let system_font_collection = shaper
        .as_ref()
        .is_ok_and(|shaper| shaper.system_font_collection().is_ok());
    let text_layout = shaper
        .as_ref()
        .is_ok_and(|shaper| directwrite_sample_layout_has_clusters(shaper));
    let installed_candidate_coverage = shaper.as_ref().is_ok_and(|shaper| {
        [
            FontFallbackClass::Japanese,
            FontFallbackClass::Emoji,
            FontFallbackClass::Powerline,
            FontFallbackClass::NerdFont,
            FontFallbackClass::BoxDrawing,
        ]
        .into_iter()
        .all(|class| shaper.first_available_family(class).is_some())
    });
    let system_font_fallback = shaper
        .as_ref()
        .is_ok_and(directwrite_sample_fallback_mapping_ready);
    let available = directwrite_factory && system_font_collection && text_layout;

    SystemTextShapingCapability {
        schema: TEXT_SHAPING_SCHEMA.to_string(),
        backend: TextShapingBackend::SystemDirectWrite,
        available,
        directwrite_factory,
        system_font_collection,
        text_layout,
        system_font_fallback,
        renderer_integration_ready: false,
        visual_fixture_ready: false,
        ready_for_native_shaping_claim: false,
        detail: if available {
            format!(
                "DirectWrite factory, system font collection, and sample text layout are available; installed fallback candidate coverage is {installed_candidate_coverage}; IDWriteFontFallback sample mapping is {system_font_fallback}; renderer fallback rasterization and visual dogfood remain pending"
            )
        } else {
            "DirectWrite system shaping is unavailable on this target/build".to_string()
        },
        blockers: vec![
            "map all fallback clusters through real DirectWrite font fallback, not only installed-family candidate checks".to_string(),
            "rasterize DirectWrite-resolved fallback glyphs into the winit/wgpu glyph atlas"
                .to_string(),
            "produce native visual fallback glyph and ligature policy fixtures".to_string(),
        ],
    }
}

#[cfg(target_os = "windows")]
fn directwrite_sample_layout_has_clusters(shaper: &DirectWriteTextShaper) -> bool {
    let input = ShapeInput {
        text: "A\u{65e5}\u{1f680}\u{2500}".to_string(),
        style: CellStyle::default(),
        cell_width_px: 9,
        cell_height_px: 18,
        allow_ligatures: false,
    };
    let Ok(layout) = shaper.create_text_layout(&input) else {
        return false;
    };
    let utf16_len = input.text.encode_utf16().count().max(1);
    let mut metrics =
        vec![windows::Win32::Graphics::DirectWrite::DWRITE_CLUSTER_METRICS::default(); utf16_len];
    let mut actual_cluster_count = 0u32;
    unsafe {
        layout
            .GetClusterMetrics(Some(&mut metrics), &mut actual_cluster_count)
            .is_ok()
            && actual_cluster_count > 0
    }
}

#[cfg(target_os = "windows")]
fn directwrite_sample_fallback_mapping_ready(shaper: &DirectWriteTextShaper) -> bool {
    ["\u{65e5}", "\u{1f680}", "\u{2500}"]
        .into_iter()
        .all(|sample| {
            shaper
                .resolve_mapped_font_fallback(sample, &CellStyle::default())
                .is_some_and(|font| font.source.starts_with("directwrite-map-characters"))
        })
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectWriteFontFileRef {
    path: String,
    collection_index: u32,
}

#[cfg(target_os = "windows")]
fn directwrite_font_file_ref(
    font: &windows::Win32::Graphics::DirectWrite::IDWriteFont,
) -> Option<DirectWriteFontFileRef> {
    use windows::Win32::Graphics::DirectWrite::{IDWriteFontFile, IDWriteLocalFontFileLoader};

    let face = unsafe { font.CreateFontFace().ok()? };
    let collection_index = unsafe { face.GetIndex() };
    let mut file_count = 0u32;
    unsafe {
        face.GetFiles(&mut file_count, None).ok()?;
    }
    if file_count == 0 {
        return None;
    }

    let mut files = vec![None::<IDWriteFontFile>; file_count as usize];
    unsafe {
        face.GetFiles(&mut file_count, Some(files.as_mut_ptr()))
            .ok()?;
    }
    let font_file = files.into_iter().flatten().next()?;
    let loader = unsafe { font_file.GetLoader().ok()? };
    let local_loader = loader.cast::<IDWriteLocalFontFileLoader>().ok()?;
    let mut key_ptr: *mut core::ffi::c_void = core::ptr::null_mut();
    let mut key_size = 0u32;
    unsafe {
        font_file
            .GetReferenceKey(&mut key_ptr, &mut key_size)
            .ok()?;
    }
    if key_ptr.is_null() || key_size == 0 {
        return None;
    }

    let path_len = unsafe {
        local_loader
            .GetFilePathLengthFromKey(key_ptr.cast_const(), key_size)
            .ok()?
    };
    let mut buffer = vec![0u16; path_len.saturating_add(1) as usize];
    unsafe {
        local_loader
            .GetFilePathFromKey(key_ptr.cast_const(), key_size, &mut buffer)
            .ok()?;
    }
    let path = String::from_utf16_lossy(&buffer[..path_len as usize]);
    if path.is_empty() {
        return None;
    }

    Some(DirectWriteFontFileRef {
        path,
        collection_index,
    })
}

#[cfg(target_os = "windows")]
fn directwrite_font_family_name(
    font: &windows::Win32::Graphics::DirectWrite::IDWriteFont,
) -> Option<String> {
    let family = unsafe { font.GetFontFamily().ok()? };
    let names = unsafe { family.GetFamilyNames().ok()? };
    let len = unsafe { names.GetStringLength(0).ok()? };
    let mut buffer = vec![0u16; len.saturating_add(1) as usize];
    unsafe {
        names.GetString(0, &mut buffer).ok()?;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

fn fallback_candidates(fallback_class: FontFallbackClass) -> &'static [&'static str] {
    match fallback_class {
        FontFallbackClass::PrimaryMonospace => &["Cascadia Mono", "Cascadia Code", "Consolas"],
        FontFallbackClass::Japanese => &["Yu Gothic UI", "Yu Gothic", "Meiryo", "MS Gothic"],
        FontFallbackClass::Emoji => &["Segoe UI Emoji", "Segoe UI Symbol"],
        FontFallbackClass::Powerline => &[
            "CaskaydiaCove Nerd Font",
            "CaskaydiaCove Nerd Font Mono",
            "Cascadia Code PL",
            "Segoe UI Symbol",
        ],
        FontFallbackClass::NerdFont => &[
            "CaskaydiaCove Nerd Font",
            "CaskaydiaCove Nerd Font Mono",
            "Cascadia Code PL",
            "Segoe UI Symbol",
        ],
        FontFallbackClass::BoxDrawing => &["Cascadia Mono", "Cascadia Code", "Consolas"],
    }
}

fn utf16_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn byte_index_for_utf16_offset(text: &str, target_offset: usize) -> usize {
    if target_offset == 0 {
        return 0;
    }

    let mut offset = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if offset >= target_offset {
            return byte_index;
        }
        offset += ch.len_utf16();
    }
    text.len()
}

pub fn classify_char(ch: char) -> FontFallbackClass {
    let code = ch as u32;
    match code {
        0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff => {
            FontFallbackClass::Japanese
        }
        0x1f000..=0x1faff | 0x2600..=0x27bf => FontFallbackClass::Emoji,
        0xe0a0..=0xe0ff => FontFallbackClass::Powerline,
        0xe700..=0xf8ff => FontFallbackClass::NerdFont,
        0x2500..=0x257f => FontFallbackClass::BoxDrawing,
        _ => FontFallbackClass::PrimaryMonospace,
    }
}

fn classify_cluster(text: &str) -> FontFallbackClass {
    let mut best = FontFallbackClass::PrimaryMonospace;
    for class in text.chars().map(classify_char) {
        best = match (best, class) {
            (_, FontFallbackClass::Emoji) => FontFallbackClass::Emoji,
            (FontFallbackClass::Emoji, _) => FontFallbackClass::Emoji,
            (_, FontFallbackClass::Japanese) => FontFallbackClass::Japanese,
            (FontFallbackClass::Japanese, _) => FontFallbackClass::Japanese,
            (_, FontFallbackClass::NerdFont) => FontFallbackClass::NerdFont,
            (FontFallbackClass::NerdFont, _) => FontFallbackClass::NerdFont,
            (_, FontFallbackClass::Powerline) => FontFallbackClass::Powerline,
            (FontFallbackClass::Powerline, _) => FontFallbackClass::Powerline,
            (_, FontFallbackClass::BoxDrawing) => FontFallbackClass::BoxDrawing,
            (FontFallbackClass::BoxDrawing, _) => FontFallbackClass::BoxDrawing,
            _ => FontFallbackClass::PrimaryMonospace,
        };
    }
    best
}

fn representative_char_for_fallback(text: &str) -> Option<char> {
    let cluster_class = classify_cluster(text);
    text.chars()
        .find(|ch| classify_char(*ch) == cluster_class)
        .or_else(|| text.chars().next())
}

fn cell_advance(ch: char) -> u16 {
    if is_combining_mark(ch) {
        0
    } else if matches!(
        classify_char(ch),
        FontFallbackClass::Japanese | FontFallbackClass::Emoji
    ) {
        2
    } else {
        1
    }
}

fn is_combining_mark(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0300..=0x036f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff | 0xfe20..=0xfe2f
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(text: &str) -> ShapeInput {
        ShapeInput {
            text: text.to_string(),
            style: CellStyle::default(),
            cell_width_px: 9,
            cell_height_px: 18,
            allow_ligatures: true,
        }
    }

    #[test]
    fn policy_keeps_native_shaping_claim_blocked_until_system_shaper() {
        let policy = terminal_text_shaping_policy();

        assert_eq!(policy.schema, TEXT_SHAPING_SCHEMA);
        assert!(policy.policy_backend.implemented);
        #[cfg(target_os = "windows")]
        {
            assert!(policy.required_system_backend.implemented);
            assert!(!policy.required_system_backend.release_blocking);
            assert_eq!(
                policy.ligature_policy,
                LigaturePolicy::DirectWriteLayoutNoTerminalLigatureClaim
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(!policy.required_system_backend.implemented);
            assert!(policy.required_system_backend.release_blocking);
            assert_eq!(
                policy.ligature_policy,
                LigaturePolicy::DisabledUntilSystemShaper
            );
        }
        assert!(!policy.renderer_integration_ready);
        assert!(!policy.visual_fixture_ready);
        assert!(!policy.ready_for_native_shaping_claim);
        if !policy.system_capability.system_font_fallback {
            assert!(policy
                .release_blockers
                .iter()
                .any(|blocker| blocker.contains("real DirectWrite font fallback mapping")));
        }
        assert!(policy
            .release_blockers
            .iter()
            .any(|blocker| blocker.contains("visual regression")));
    }

    #[test]
    fn policy_shaper_classifies_required_fallbacks() {
        let shaper = PolicyTextShaper;
        let run = shaper
            .shape_run(&input("\u{65e5}\u{1f680}\u{e0b0}\u{e700}\u{2500}a"))
            .expect("shape run");
        let classes = run
            .clusters
            .iter()
            .map(|cluster| cluster.fallback_class)
            .collect::<Vec<_>>();

        assert_eq!(
            classes,
            vec![
                FontFallbackClass::Japanese,
                FontFallbackClass::Emoji,
                FontFallbackClass::Powerline,
                FontFallbackClass::NerdFont,
                FontFallbackClass::BoxDrawing,
                FontFallbackClass::PrimaryMonospace,
            ]
        );
        assert_eq!(run.backend, TextShapingBackend::PolicyFallback);
        assert!(!run.system_shaper_ready);
        assert!(!run.real_font_fallback_ready);
        assert!(!run.ready_for_native_shaping_claim);
        assert!(!run.ligatures_used);
        assert_eq!(
            run.clusters.iter().filter(|c| c.fallback_required).count(),
            5
        );
        assert_eq!(run.clusters[0].cell_advance, 2);
        assert_eq!(run.clusters[1].cell_advance, 2);
    }

    #[test]
    fn combining_marks_stay_with_previous_cluster() {
        let shaper = PolicyTextShaper;
        let run = shaper.shape_run(&input("e\u{0301}x")).expect("shape run");

        assert_eq!(run.clusters.len(), 2);
        assert_eq!(run.clusters[0].text, "e\u{0301}");
        assert_eq!(run.clusters[0].cell_advance, 1);
        assert_eq!(run.clusters[1].text, "x");
    }

    #[test]
    fn utf16_offsets_keep_surrogate_pairs_intact() {
        let text = "a\u{1f680}b";

        assert_eq!(byte_index_for_utf16_offset(text, 0), 0);
        assert_eq!(byte_index_for_utf16_offset(text, 1), "a".len());
        assert_eq!(byte_index_for_utf16_offset(text, 3), "a\u{1f680}".len());
        assert_eq!(byte_index_for_utf16_offset(text, 4), text.len());
    }

    #[test]
    fn cluster_classification_uses_full_cluster_text() {
        assert_eq!(
            classify_cluster("a\u{1f680}\u{fe0f}"),
            FontFallbackClass::Emoji
        );
        assert_eq!(
            representative_char_for_fallback("a\u{65e5}"),
            Some('\u{65e5}')
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn directwrite_shaper_shapes_system_clusters_without_unlocking_visual_claim() {
        let shaper = DirectWriteTextShaper::new().expect("DirectWrite shaper");
        let run = shaper
            .shape_run(&input("A\u{65e5}\u{1f680}\u{2500}"))
            .expect("directwrite shape run");

        assert_eq!(run.backend, TextShapingBackend::SystemDirectWrite);
        assert!(run.system_shaper_ready);
        assert!(!run.renderer_integration_ready);
        assert!(!run.visual_fixture_ready);
        assert!(!run.ready_for_native_shaping_claim);
        assert_eq!(
            run.real_font_fallback_ready,
            run.clusters.iter().all(|cluster| {
                !cluster.fallback_required
                    || cluster
                        .font
                        .source
                        .starts_with("directwrite-map-characters")
            })
        );
        assert!(!run.ligatures_used);
        assert!(run
            .clusters
            .iter()
            .any(|cluster| cluster.fallback_class == FontFallbackClass::Japanese));
        assert!(run
            .clusters
            .iter()
            .any(|cluster| cluster.fallback_class == FontFallbackClass::Emoji));
    }

    #[test]
    fn rejects_zero_cell_metrics() {
        let shaper = PolicyTextShaper;
        let err = shaper
            .shape_run(&ShapeInput {
                text: "a".to_string(),
                style: CellStyle::default(),
                cell_width_px: 0,
                cell_height_px: 18,
                allow_ligatures: false,
            })
            .expect_err("zero width must fail");

        assert!(matches!(
            err,
            TextShapeError::InvalidCellMetrics {
                width_px: 0,
                height_px: 18
            }
        ));
    }
}
