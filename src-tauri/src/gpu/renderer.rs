use std::sync::Arc;
use wgpu::util::DeviceExt;

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::{Cell, Color, Grid};

/// Per-instance data for each terminal cell (sent to glyph shader).
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GlyphInstance {
    pub pos: [f32; 2],
    pub uv_rect: [f32; 4],
    pub fg_color: [f32; 4],
    pub bg_color: [f32; 4],
    pub size: [f32; 2],
}

/// Per-instance data for rectangles (cursor, selection, decorations).
///
/// Supports: solid fill, rounded corners (SDF), borders, and linear gradients.
/// 64 bytes per instance — GPU aligned.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct RectInstance {
    pub pos: [f32; 2],
    pub size: [f32; 2],
    pub color: [f32; 4],
    /// Corner radius (px). 0 = sharp.
    pub border_radius: f32,
    /// Border thickness (px). 0 = no border.
    pub border_width: f32,
    /// Border brightness adjustment (-1..1). Lightens/darkens fill color for border.
    pub border_brightness: f32,
    /// Gradient angle (radians). 0 = no gradient. PI/2 = top-to-bottom.
    pub gradient_angle: f32,
    /// Gradient end color (premultiplied RGBA). Ignored when gradient_angle == 0.
    pub color2: [f32; 4],
}

impl RectInstance {
    /// Solid rect with sharp corners.
    pub fn new(pos: [f32; 2], size: [f32; 2], color: [f32; 4]) -> Self {
        Self {
            pos, size, color,
            border_radius: 0.0, border_width: 0.0, border_brightness: 0.0,
            gradient_angle: 0.0, color2: [0.0; 4],
        }
    }

    /// Rounded corners.
    pub fn rounded(pos: [f32; 2], size: [f32; 2], color: [f32; 4], radius: f32) -> Self {
        Self {
            pos, size, color,
            border_radius: radius, border_width: 0.0, border_brightness: 0.0,
            gradient_angle: 0.0, color2: [0.0; 4],
        }
    }

    /// Rounded corners with a border.
    pub fn bordered(
        pos: [f32; 2], size: [f32; 2], color: [f32; 4],
        radius: f32, border_width: f32, border_brightness: f32,
    ) -> Self {
        Self {
            pos, size, color,
            border_radius: radius, border_width, border_brightness,
            gradient_angle: 0.0, color2: [0.0; 4],
        }
    }

    /// Linear gradient fill (top-to-bottom by default).
    pub fn gradient(
        pos: [f32; 2], size: [f32; 2],
        color_start: [f32; 4], color_end: [f32; 4],
        radius: f32, angle: f32,
    ) -> Self {
        Self {
            pos, size, color: color_start,
            border_radius: radius, border_width: 0.0, border_brightness: 0.0,
            gradient_angle: angle, color2: color_end,
        }
    }
}

/// Per-instance data for gradient rectangles (shadows, gradient fills, rounded corners).
///
/// Separate pipeline from RectInstance so existing rect layout is untouched.
/// 64 bytes per instance — GPU aligned.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GradientRectInstance {
    pub pos: [f32; 2],
    pub size: [f32; 2],
    pub color_start: [f32; 4],
    pub color_end: [f32; 4],
    pub corner_radius: f32,
    pub gradient_angle: f32,    // radians (0 = top-to-bottom, PI/2 = left-to-right)
    pub shadow_blur: f32,       // shadow blur radius (px). 0 = no shadow
    pub shadow_alpha: f32,      // shadow opacity (0..1)
}

impl GradientRectInstance {
    /// Solid color with drop shadow.
    pub fn shadowed(
        pos: [f32; 2], size: [f32; 2], color: [f32; 4],
        radius: f32, shadow_blur: f32, shadow_alpha: f32,
    ) -> Self {
        Self {
            pos, size,
            color_start: color,
            color_end: color,
            corner_radius: radius,
            gradient_angle: 0.0,
            shadow_blur,
            shadow_alpha,
        }
    }

    /// Vertical gradient (top to bottom).
    pub fn gradient_v(
        pos: [f32; 2], size: [f32; 2],
        top: [f32; 4], bottom: [f32; 4],
        radius: f32,
    ) -> Self {
        Self {
            pos, size,
            color_start: top,
            color_end: bottom,
            corner_radius: radius,
            gradient_angle: std::f32::consts::FRAC_PI_2,
            shadow_blur: 0.0,
            shadow_alpha: 0.0,
        }
    }

    /// Vertical gradient with drop shadow.
    pub fn gradient_v_shadowed(
        pos: [f32; 2], size: [f32; 2],
        top: [f32; 4], bottom: [f32; 4],
        radius: f32, shadow_blur: f32, shadow_alpha: f32,
    ) -> Self {
        Self {
            pos, size,
            color_start: top,
            color_end: bottom,
            corner_radius: radius,
            gradient_angle: std::f32::consts::FRAC_PI_2,
            shadow_blur,
            shadow_alpha,
        }
    }

    /// Gold button gradient (18K gold surface).
    pub fn gold_button(pos: [f32; 2], size: [f32; 2], radius: f32) -> Self {
        Self::gradient_v(
            pos, size,
            [0.91, 0.77, 0.50, 1.0],  // #e8c580 top
            [0.66, 0.50, 0.19, 1.0],  // #a88030 bottom
            radius,
        )
    }
}

/// Uniform buffer shared between glyph and rect shaders.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    viewport_size: [f32; 2],
    _padding: [f32; 2],
}

/// Get ANSI color palette from the active theme.
fn ansi_colors() -> [[f32; 3]; 16] {
    crate::ui::theme::current().ansi
}

/// Get default foreground from the active theme.
fn default_fg() -> [f32; 4] {
    crate::ui::theme::current().text
}

const DEFAULT_BG: [f32; 4] = [0.0, 0.0, 0.0, 0.0]; // Transparent (theme-independent)

/// Resolve foreground and background colors for a cell, handling inverse.
pub fn resolve_cell_colors(cell: &Cell) -> ([f32; 4], [f32; 4]) {
    if cell.flags.inverse {
        (color_to_rgba(cell.bg, false), color_to_rgba(cell.fg, true))
    } else {
        (color_to_rgba(cell.fg, true), color_to_rgba(cell.bg, false))
    }
}

fn color_to_rgba(c: Color, is_fg: bool) -> [f32; 4] {
    match c {
        Color::Default => if is_fg { default_fg() } else { DEFAULT_BG },
        Color::Indexed(idx) => {
            if (idx as usize) < 16 {
                let colors = ansi_colors();
                let rgb = colors[idx as usize];
                [rgb[0], rgb[1], rgb[2], 1.0]
            } else if idx < 232 {
                // 216 color cube (16..231)
                let idx = idx - 16;
                let r = (idx / 36) as f32 / 5.0;
                let g = ((idx % 36) / 6) as f32 / 5.0;
                let b = (idx % 6) as f32 / 5.0;
                [r, g, b, 1.0]
            } else {
                // Grayscale (232..255)
                let v = ((idx - 232) as f32 * 10.0 + 8.0) / 255.0;
                [v, v, v, 1.0]
            }
        }
        Color::Rgb(r, g, b) => [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0],
    }
}

/// The wgpu terminal renderer with full GPU pipeline.
pub struct TerminalRenderer {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    glyph_pipeline: wgpu::RenderPipeline,
    rect_pipeline: wgpu::RenderPipeline,
    gradient_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniform_bind_group: wgpu::BindGroup,
    atlas_texture: wgpu::Texture,
    atlas_bind_group: wgpu::BindGroup,
    glyph_instance_buffer: wgpu::Buffer,
    rect_instance_buffer: wgpu::Buffer,
    gradient_instance_buffer: wgpu::Buffer,
    pub width: u32,
    pub height: u32,
    max_glyph_instances: u32,
    max_rect_instances: u32,
    max_gradient_instances: u32,
}

impl TerminalRenderer {
    /// Initialize the full wgpu pipeline (call after device/queue are available).
    pub fn new(device: Arc<wgpu::Device>, queue: Arc<wgpu::Queue>, width: u32, height: u32) -> Self {
        // --- Uniform buffer ---
        let uniforms = Uniforms {
            viewport_size: [width as f32, height as f32],
            _padding: [0.0; 2],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // --- Atlas texture (2048x2048 RGBA8 for subpixel AA) ---
        let atlas_size = wgpu::Extent3d { width: 2048, height: 2048, depth_or_array_layers: 1 };
        let atlas_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("glyph_atlas"),
            size: atlas_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let atlas_view = atlas_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let atlas_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // --- Bind group layouts ---
        let uniform_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniform_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let atlas_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("atlas_bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniform_bg"),
            layout: &uniform_bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let atlas_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("atlas_bg"),
            layout: &atlas_bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&atlas_view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&atlas_sampler) },
            ],
        });

        // --- Glyph pipeline ---
        let glyph_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("glyph_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/glyph.wgsl").into()),
        });

        let glyph_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("glyph_pipeline_layout"),
            bind_group_layouts: &[&uniform_bgl, &atlas_bgl],
            push_constant_ranges: &[],
        });

        let glyph_instance_attrs = wgpu::vertex_attr_array![
            0 => Float32x2,  // pos
            1 => Float32x4,  // uv_rect
            2 => Float32x4,  // fg_color
            3 => Float32x4,  // bg_color
            4 => Float32x2,  // size
        ];

        let glyph_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("glyph_pipeline"),
            layout: Some(&glyph_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &glyph_shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GlyphInstance>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &glyph_instance_attrs,
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &glyph_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8Unorm,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // --- Rect pipeline ---
        let rect_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("rect_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/rect.wgsl").into()),
        });

        let rect_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("rect_pipeline_layout"),
            bind_group_layouts: &[&uniform_bgl],
            push_constant_ranges: &[],
        });

        let rect_instance_attrs = wgpu::vertex_attr_array![
            0 => Float32x2,  // pos
            1 => Float32x2,  // size
            2 => Float32x4,  // color
            3 => Float32,    // border_radius
            4 => Float32,    // border_width
            5 => Float32,    // border_brightness
            6 => Float32,    // gradient_angle
            7 => Float32x4,  // color2 (gradient end)
        ];

        let rect_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("rect_pipeline"),
            layout: Some(&rect_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &rect_shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<RectInstance>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &rect_instance_attrs,
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &rect_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8Unorm,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // --- Gradient rect pipeline ---
        let gradient_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gradient_rect_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/gradient_rect.wgsl").into()),
        });

        let gradient_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gradient_pipeline_layout"),
            bind_group_layouts: &[&uniform_bgl],
            push_constant_ranges: &[],
        });

        let gradient_instance_attrs = wgpu::vertex_attr_array![
            0 => Float32x2,  // pos
            1 => Float32x2,  // size
            2 => Float32x4,  // color_start
            3 => Float32x4,  // color_end
            4 => Float32,    // corner_radius
            5 => Float32,    // gradient_angle
            6 => Float32,    // shadow_blur
            7 => Float32,    // shadow_alpha
        ];

        let gradient_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("gradient_pipeline"),
            layout: Some(&gradient_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &gradient_shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GradientRectInstance>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &gradient_instance_attrs,
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &gradient_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8Unorm,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // --- Instance buffers (pre-allocated for max grid size) ---
        let max_glyph_instances = 300 * 100; // 300 cols × 100 rows max
        let max_rect_instances = 300 * 100 + 100; // cells + cursor + decorations
        let max_gradient_instances: u32 = 256; // UI chrome: panels, buttons, cards

        let glyph_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("glyph_instances"),
            size: (max_glyph_instances as usize * std::mem::size_of::<GlyphInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let rect_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("rect_instances"),
            size: (max_rect_instances as usize * std::mem::size_of::<RectInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let gradient_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("gradient_instances"),
            size: (max_gradient_instances as usize * std::mem::size_of::<GradientRectInstance>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            device, queue,
            glyph_pipeline, rect_pipeline, gradient_pipeline,
            uniform_buffer, uniform_bind_group,
            atlas_texture, atlas_bind_group,
            glyph_instance_buffer, rect_instance_buffer, gradient_instance_buffer,
            width, height,
            max_glyph_instances, max_rect_instances, max_gradient_instances,
        }
    }

    /// Upload atlas pixel data to the GPU texture.
    pub fn upload_atlas(&self, atlas: &GlyphAtlas) {
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.atlas_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &atlas.pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(atlas.atlas_width * 4),
                rows_per_image: Some(atlas.atlas_height),
            },
            wgpu::Extent3d {
                width: atlas.atlas_width,
                height: atlas.atlas_height,
                depth_or_array_layers: 1,
            },
        );
    }

    /// Update viewport size (call on resize).
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        let uniforms = Uniforms {
            viewport_size: [width as f32, height as f32],
            _padding: [0.0; 2],
        };
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
    }

    /// Build glyph instances from the terminal grid.
    /// Applies font bearing for correct baseline positioning.
    /// Cell backgrounds are handled separately by build_bg_rects.
    pub fn build_glyph_instances(
        &self,
        grid: &Grid,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
    ) -> Vec<GlyphInstance> {
        let cw = font.cell_width;
        let ch = font.cell_height;
        let baseline = font.baseline;
        let mut instances = Vec::with_capacity((grid.cols * grid.rows) as usize);

        for row in 0..grid.rows as usize {
            for col in 0..grid.cols as usize {
                let cell = &grid.cells[row][col];
                if cell.c <= ' ' { continue; }

                let entry = atlas.get_or_insert(cell.c, cell.flags, font);
                if entry.width == 0 || entry.height == 0 { continue; }

                let (fg, _bg) = resolve_cell_colors(cell);

                let x = col as f32 * cw + entry.bearing_x;
                let y = row as f32 * ch + baseline - entry.bearing_y - entry.height as f32;

                instances.push(GlyphInstance {
                    pos: [x, y],
                    uv_rect: entry.uv,
                    fg_color: fg,
                    bg_color: [0.0, 0.0, 0.0, 0.0],
                    size: [entry.width as f32, entry.height as f32],
                });
            }
        }

        instances
    }

    /// Build rect instances for cursor and selection.
    pub fn build_cursor_rect(
        &self,
        grid: &Grid,
        font: &FontManager,
        cursor_visible: bool,
    ) -> Vec<RectInstance> {
        let mut rects = Vec::new();

        if cursor_visible && grid.cursor.visible {
            let cw = font.cell_width;
            let ch = font.cell_height;
            let cursor_color = [0.81, 0.83, 0.88, 0.8]; // Semi-transparent white

            rects.push(RectInstance::new(
                [grid.cursor.col as f32 * cw, grid.cursor.row as f32 * ch],
                [2.0, ch],
                cursor_color,
            ));
        }

        rects
    }

    /// Render a frame to the given surface texture view.
    pub fn render_frame(
        &self,
        view: &wgpu::TextureView,
        glyph_instances: &[GlyphInstance],
        rect_instances: &[RectInstance],
        clear_color: wgpu::Color,
    ) {
        self.render_frame_full(view, glyph_instances, rect_instances, &[], clear_color);
    }

    /// Render a frame with all three pipelines: rects, gradient rects, then glyphs.
    pub fn render_frame_full(
        &self,
        view: &wgpu::TextureView,
        glyph_instances: &[GlyphInstance],
        rect_instances: &[RectInstance],
        gradient_instances: &[GradientRectInstance],
        clear_color: wgpu::Color,
    ) {
        // Upload instance data (clamped to buffer capacity)
        let glyph_count = glyph_instances.len().min(self.max_glyph_instances as usize);
        let rect_count = rect_instances.len().min(self.max_rect_instances as usize);
        let gradient_count = gradient_instances.len().min(self.max_gradient_instances as usize);
        if glyph_count > 0 {
            let data = bytemuck::cast_slice(&glyph_instances[..glyph_count]);
            self.queue.write_buffer(&self.glyph_instance_buffer, 0, data);
        }
        if rect_count > 0 {
            let data = bytemuck::cast_slice(&rect_instances[..rect_count]);
            self.queue.write_buffer(&self.rect_instance_buffer, 0, data);
        }
        if gradient_count > 0 {
            let data = bytemuck::cast_slice(&gradient_instances[..gradient_count]);
            self.queue.write_buffer(&self.gradient_instance_buffer, 0, data);
        }

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("terminal_render"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("terminal_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear_color),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });

            // 1. Draw background rects + cursor/selection
            if rect_count > 0 {
                pass.set_pipeline(&self.rect_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, self.rect_instance_buffer.slice(..));
                pass.draw(0..6, 0..rect_count as u32);
            }

            // 2. Draw gradient rects (panels, buttons, cards with shadows)
            if gradient_count > 0 {
                pass.set_pipeline(&self.gradient_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, self.gradient_instance_buffer.slice(..));
                pass.draw(0..6, 0..gradient_count as u32);
            }

            // 3. Draw glyphs (text)
            if glyph_count > 0 {
                pass.set_pipeline(&self.glyph_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_bind_group(1, &self.atlas_bind_group, &[]);
                pass.set_vertex_buffer(0, self.glyph_instance_buffer.slice(..));
                pass.draw(0..6, 0..glyph_count as u32);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
    }

    /// Render gradient rects as a standalone pass (load existing content, no clear).
    ///
    /// Useful for overlaying gradient panels on top of an already-rendered frame.
    pub fn render_gradient_rects(
        &self,
        view: &wgpu::TextureView,
        instances: &[GradientRectInstance],
    ) {
        let count = instances.len().min(self.max_gradient_instances as usize);
        if count == 0 { return; }

        let data = bytemuck::cast_slice(&instances[..count]);
        self.queue.write_buffer(&self.gradient_instance_buffer, 0, data);

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("gradient_rect_pass"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("gradient_rects"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });

            pass.set_pipeline(&self.gradient_pipeline);
            pass.set_bind_group(0, &self.uniform_bind_group, &[]);
            pass.set_vertex_buffer(0, self.gradient_instance_buffer.slice(..));
            pass.draw(0..6, 0..count as u32);
        }

        self.queue.submit(std::iter::once(encoder.finish()));
    }

    /// Render overlay rects + glyphs on top of existing content (no clear).
    ///
    /// Used for rendering palette/menus AFTER a blur pass.
    pub fn render_overlay(
        &self,
        view: &wgpu::TextureView,
        glyph_instances: &[GlyphInstance],
        rect_instances: &[RectInstance],
        gradient_instances: &[GradientRectInstance],
    ) {
        let glyph_count = glyph_instances.len().min(self.max_glyph_instances as usize);
        let rect_count = rect_instances.len().min(self.max_rect_instances as usize);
        let gradient_count = gradient_instances.len().min(self.max_gradient_instances as usize);

        if glyph_count > 0 {
            self.queue.write_buffer(&self.glyph_instance_buffer, 0, bytemuck::cast_slice(&glyph_instances[..glyph_count]));
        }
        if rect_count > 0 {
            self.queue.write_buffer(&self.rect_instance_buffer, 0, bytemuck::cast_slice(&rect_instances[..rect_count]));
        }
        if gradient_count > 0 {
            self.queue.write_buffer(&self.gradient_instance_buffer, 0, bytemuck::cast_slice(&gradient_instances[..gradient_count]));
        }

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("overlay_pass"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("overlay"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });

            if rect_count > 0 {
                pass.set_pipeline(&self.rect_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, self.rect_instance_buffer.slice(..));
                pass.draw(0..6, 0..rect_count as u32);
            }
            if gradient_count > 0 {
                pass.set_pipeline(&self.gradient_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, self.gradient_instance_buffer.slice(..));
                pass.draw(0..6, 0..gradient_count as u32);
            }
            if glyph_count > 0 {
                pass.set_pipeline(&self.glyph_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_bind_group(1, &self.atlas_bind_group, &[]);
                pass.set_vertex_buffer(0, self.glyph_instance_buffer.slice(..));
                pass.draw(0..6, 0..glyph_count as u32);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
    }

    /// Access the device (for creating surfaces etc.).
    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    /// Access the queue.
    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }
}
