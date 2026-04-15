// Rectangle shader — solid-color quads with optional rounded corners.
//
// Uses SDF (Signed Distance Field) for smooth anti-aliased rounded corners.
// border_radius = 0 → sharp corners (original behavior).

struct Uniforms {
    viewport_size: vec2<f32>,
    _padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct RectInstance {
    @location(0) pos: vec2<f32>,           // Top-left corner (pixels)
    @location(1) size: vec2<f32>,          // Width, height (pixels)
    @location(2) color: vec4<f32>,         // RGBA color (premultiplied)
    @location(3) border_radius: f32,       // Corner radius (pixels)
    @location(4) _pad: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) local_pos: vec2<f32>,     // Position within the rect (pixels)
    @location(2) rect_size: vec2<f32>,     // Rect size for SDF calculation
    @location(3) radius: f32,
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
    out.local_pos = quad * instance.size;
    out.rect_size = instance.size;
    out.radius = instance.border_radius;
    return out;
}

// SDF for a rounded rectangle centered at origin.
fn rounded_rect_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Fast path: no rounding
    if in.radius <= 0.0 {
        return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
    }

    // SDF-based rounded corners with anti-aliasing
    let half_size = in.rect_size * 0.5;
    let centered = in.local_pos - half_size;
    let dist = rounded_rect_sdf(centered, half_size, in.radius);

    // Smooth anti-aliased edge (1px feather)
    let aa = 1.0 - smoothstep(-1.0, 0.5, dist);

    let final_alpha = in.color.a * aa;
    return vec4<f32>(in.color.rgb * final_alpha, final_alpha);
}
