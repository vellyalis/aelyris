// Glyph rendering shader — instanced quads textured from the glyph atlas.
//
// Each instance represents one terminal cell. The vertex shader positions
// the quad, and the fragment shader samples the glyph alpha from the atlas
// texture, combining it with the foreground color.

struct Uniforms {
    viewport_size: vec2<f32>,  // Viewport dimensions in pixels
    _padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var atlas_texture: texture_2d<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct GlyphInstance {
    @location(0) pos: vec2<f32>,       // Cell position (pixels, top-left)
    @location(1) uv_rect: vec4<f32>,   // Atlas UV: (u0, v0, u1, v1)
    @location(2) fg_color: vec4<f32>,  // Foreground RGBA
    @location(3) bg_color: vec4<f32>,  // Background RGBA (a=0 → transparent)
    @location(4) size: vec2<f32>,      // Glyph size (pixels)
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) fg_color: vec4<f32>,
    @location(2) bg_color: vec4<f32>,
};

// Quad vertices: two triangles forming a rectangle.
// Vertex index 0-5 maps to corners via this lookup.
var<private> QUAD_POS: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),  // top-left
    vec2<f32>(1.0, 0.0),  // top-right
    vec2<f32>(0.0, 1.0),  // bottom-left
    vec2<f32>(1.0, 0.0),  // top-right
    vec2<f32>(1.0, 1.0),  // bottom-right
    vec2<f32>(0.0, 1.0),  // bottom-left
);

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    instance: GlyphInstance,
) -> VertexOutput {
    let quad = QUAD_POS[vertex_index];

    // Pixel position of this vertex
    let pixel_pos = instance.pos + quad * instance.size;

    // Convert pixel coordinates to NDC: (0,0)=top-left → (-1,1), (w,h) → (1,-1)
    let ndc = vec2<f32>(
        pixel_pos.x / uniforms.viewport_size.x * 2.0 - 1.0,
        1.0 - pixel_pos.y / uniforms.viewport_size.y * 2.0,
    );

    // Interpolate UV from the atlas rect
    let uv = vec2<f32>(
        mix(instance.uv_rect.x, instance.uv_rect.z, quad.x),
        mix(instance.uv_rect.y, instance.uv_rect.w, quad.y),
    );

    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    out.uv = uv;
    out.fg_color = instance.fg_color;
    out.bg_color = instance.bg_color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample glyph alpha from the atlas (R8 texture, alpha in .r channel)
    let glyph_alpha = textureSample(atlas_texture, atlas_sampler, in.uv).r;

    // Blend: background first, then foreground glyph on top
    let fg = vec4<f32>(in.fg_color.rgb, in.fg_color.a * glyph_alpha);

    // Premultiplied alpha compositing: fg over bg
    let result = fg + in.bg_color * (1.0 - fg.a);
    return result;
}
