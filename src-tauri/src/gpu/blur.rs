//! Gaussian blur pipeline for backdrop-filter effects.
//!
//! Two-pass separable blur: horizontal then vertical.
//! Used to blur the scene behind floating UI elements (palette, menus).

use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct BlurUniforms {
    direction: [f32; 2],
    tex_size: [f32; 2],
}

/// Manages the 2-pass Gaussian blur pipeline and intermediate textures.
pub struct BlurPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    // Intermediate texture for horizontal pass output
    intermediate: Option<BlurTexture>,
    width: u32,
    height: u32,
}

struct BlurTexture {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

impl BlurPipeline {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("blur_shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/blur.wgsl").into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("blur_bgl"),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("blur_pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("blur_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
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

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Self {
            pipeline,
            bind_group_layout,
            sampler,
            intermediate: None,
            width: 0,
            height: 0,
        }
    }

    /// Ensure intermediate textures are the right size.
    fn ensure_textures(&mut self, device: &wgpu::Device, width: u32, height: u32, format: wgpu::TextureFormat) {
        if self.width == width && self.height == height && self.intermediate.is_some() {
            return;
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("blur_intermediate"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.intermediate = Some(BlurTexture { _texture: texture, view });
        self.width = width;
        self.height = height;
    }

    /// Run 2-pass blur: source → intermediate (horizontal) → output (vertical).
    ///
    /// * `source_view` — the scene texture to blur
    /// * `output_view` — where to write the blurred result
    /// * `passes` — number of blur iterations (1 = mild, 2-3 = strong)
    pub fn blur(
        &mut self,
        device: &wgpu::Device,
        _queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        source_view: &wgpu::TextureView,
        output_view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        passes: u32,
    ) {
        self.ensure_textures(device, width, height, format);
        let intermediate = self.intermediate.as_ref().unwrap();

        let tex_size = [width as f32, height as f32];

        // For multiple passes, ping-pong between source/intermediate
        let current_source = source_view;

        for pass in 0..passes {
            let is_last_vertical = pass == passes - 1;

            // Horizontal pass: current_source → intermediate
            let h_uniforms = BlurUniforms { direction: [1.0, 0.0], tex_size };
            let h_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("blur_h_uniform"),
                contents: bytemuck::bytes_of(&h_uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let h_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("blur_h_bg"),
                layout: &self.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(current_source) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                    wgpu::BindGroupEntry { binding: 2, resource: h_buf.as_entire_binding() },
                ],
            });

            {
                let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("blur_horizontal"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &intermediate.view,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    ..Default::default()
                });
                rp.set_pipeline(&self.pipeline);
                rp.set_bind_group(0, &h_bg, &[]);
                rp.draw(0..3, 0..1);
            }

            // Vertical pass: intermediate → output (or intermediate for next iteration)
            let v_uniforms = BlurUniforms { direction: [0.0, 1.0], tex_size };
            let v_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("blur_v_uniform"),
                contents: bytemuck::bytes_of(&v_uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let v_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("blur_v_bg"),
                layout: &self.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&intermediate.view) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                    wgpu::BindGroupEntry { binding: 2, resource: v_buf.as_entire_binding() },
                ],
            });

            let target_view = if is_last_vertical { output_view } else { current_source };
            {
                let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("blur_vertical"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: target_view,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    ..Default::default()
                });
                rp.set_pipeline(&self.pipeline);
                rp.set_bind_group(0, &v_bg, &[]);
                rp.draw(0..3, 0..1);
            }
        }
    }
}
