// Rectangle shader — cursor, selection highlight, underline, strikethrough.
//
// Draws solid-color rectangles with alpha blending. Used for:
// - Cursor (block/bar/underline)
// - Selection highlight (semi-transparent overlay)
// - Underline and strikethrough decorations

struct Uniforms {
    viewport_size: vec2<f32>,
    _padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct RectInstance {
    @location(0) pos: vec2<f32>,   // Top-left corner (pixels)
    @location(1) size: vec2<f32>,  // Width, height (pixels)
    @location(2) color: vec4<f32>, // RGBA color
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

var<private> QUAD_POS: array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 1.0),
);

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    instance: RectInstance,
) -> VertexOutput {
    let quad = QUAD_POS[vertex_index];
    let pixel_pos = instance.pos + quad * instance.size;

    let ndc = vec2<f32>(
        pixel_pos.x / uniforms.viewport_size.x * 2.0 - 1.0,
        1.0 - pixel_pos.y / uniforms.viewport_size.y * 2.0,
    );

    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    out.color = instance.color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Output premultiplied RGBA for hardware PREMULTIPLIED_ALPHA_BLENDING
    return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
}
