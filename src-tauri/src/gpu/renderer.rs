use wgpu::util::DeviceExt;

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::{Cell, CellFlags, Color, Grid};

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
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct RectInstance {
    pub pos: [f32; 2],
    pub size: [f32; 2],
    pub color: [f32; 4],
}

/// Uniform buffer shared between glyph and rect shaders.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    viewport_size: [f32; 2],
    _padding: [f32; 2],
}

/// Catppuccin Mocha ANSI color palette (matches the React theme).
const ANSI_COLORS: [[f32; 3]; 16] = [
    [0.19, 0.20, 0.27],  // 0  black    (Surface0)
    [0.95, 0.55, 0.66],  // 1  red
    [0.65, 0.89, 0.63],  // 2  green
    [0.98, 0.88, 0.53],  // 3  yellow
    [0.54, 0.71, 0.98],  // 4  blue
    [0.80, 0.62, 0.95],  // 5  magenta
    [0.58, 0.89, 0.87],  // 6  cyan
    [0.73, 0.75, 0.80],  // 7  white    (Subtext1)
    [0.36, 0.38, 0.46],  // 8  bright black  (Surface2)
    [0.95, 0.55, 0.66],  // 9  bright red
    [0.65, 0.89, 0.63],  // 10 bright green
    [0.98, 0.88, 0.53],  // 11 bright yellow
    [0.54, 0.71, 0.98],  // 12 bright blue
    [0.80, 0.62, 0.95],  // 13 bright magenta
    [0.58, 0.89, 0.87],  // 14 bright cyan
    [0.81, 0.83, 0.88],  // 15 bright white (Text)
];

const DEFAULT_FG: [f32; 4] = [0.81, 0.83, 0.88, 1.0]; // Catppuccin Text
const DEFAULT_BG: [f32; 4] = [0.0, 0.0, 0.0, 0.0];     // Transparent

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
        Color::Default => if is_fg { DEFAULT_FG } else { DEFAULT_BG },
        Color::Indexed(idx) => {
            if (idx as usize) < 16 {
                let rgb = ANSI_COLORS[idx as usize];
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
    device: wgpu::Device,
    queue: wgpu::Queue,
    glyph_pipeline: wgpu::RenderPipeline,
    rect_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniform_bind_group: wgpu::BindGroup,
    atlas_texture: wgpu::Texture,
    atlas_bind_group: wgpu::BindGroup,
    glyph_instance_buffer: wgpu::Buffer,
    rect_instance_buffer: wgpu::Buffer,
    pub width: u32,
    pub height: u32,
    max_glyph_instances: u32,
    max_rect_instances: u32,
}

impl TerminalRenderer {
    /// Initialize the full wgpu pipeline (call after device/queue are available).
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, width: u32, height: u32) -> Self {
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

        // --- Atlas texture (2048x2048 R8) ---
        let atlas_size = wgpu::Extent3d { width: 2048, height: 2048, depth_or_array_layers: 1 };
        let atlas_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("glyph_atlas"),
            size: atlas_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
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

        // --- Instance buffers (pre-allocated for max grid size) ---
        let max_glyph_instances = 300 * 100; // 300 cols × 100 rows max
        let max_rect_instances = 300 * 100 + 100; // cells + cursor + decorations

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

        Self {
            device, queue,
            glyph_pipeline, rect_pipeline,
            uniform_buffer, uniform_bind_group,
            atlas_texture, atlas_bind_group,
            glyph_instance_buffer, rect_instance_buffer,
            width, height,
            max_glyph_instances, max_rect_instances,
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
                bytes_per_row: Some(atlas.atlas_width),
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
    pub fn build_glyph_instances(
        &self,
        grid: &Grid,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
    ) -> Vec<GlyphInstance> {
        let cw = font.cell_width;
        let ch = font.cell_height;
        let mut instances = Vec::with_capacity((grid.cols * grid.rows) as usize);

        for row in 0..grid.rows as usize {
            for col in 0..grid.cols as usize {
                let cell = &grid.cells[row][col];
                if cell.c == ' ' && cell.bg == Color::Default {
                    continue; // Skip blank transparent cells
                }

                let (fg, bg) = if cell.flags.inverse {
                    (color_to_rgba(cell.bg, false), color_to_rgba(cell.fg, true))
                } else {
                    (color_to_rgba(cell.fg, true), color_to_rgba(cell.bg, false))
                };

                let entry = atlas.get_or_insert(cell.c, cell.flags, font);

                instances.push(GlyphInstance {
                    pos: [col as f32 * cw, row as f32 * ch],
                    uv_rect: entry.uv,
                    fg_color: fg,
                    bg_color: bg,
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

            rects.push(RectInstance {
                pos: [grid.cursor.col as f32 * cw, grid.cursor.row as f32 * ch],
                size: [2.0, ch], // Bar cursor (2px wide)
                color: cursor_color,
            });
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
        // Upload instance data
        if !glyph_instances.is_empty() {
            let data = bytemuck::cast_slice(glyph_instances);
            self.queue.write_buffer(&self.glyph_instance_buffer, 0, data);
        }
        if !rect_instances.is_empty() {
            let data = bytemuck::cast_slice(rect_instances);
            self.queue.write_buffer(&self.rect_instance_buffer, 0, data);
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
            if !rect_instances.is_empty() {
                pass.set_pipeline(&self.rect_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, self.rect_instance_buffer.slice(..));
                pass.draw(0..6, 0..rect_instances.len() as u32);
            }

            // 2. Draw glyphs (text)
            if !glyph_instances.is_empty() {
                pass.set_pipeline(&self.glyph_pipeline);
                pass.set_bind_group(0, &self.uniform_bind_group, &[]);
                pass.set_bind_group(1, &self.atlas_bind_group, &[]);
                pass.set_vertex_buffer(0, self.glyph_instance_buffer.slice(..));
                pass.draw(0..6, 0..glyph_instances.len() as u32);
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
