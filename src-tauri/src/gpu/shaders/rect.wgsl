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
    @location(4) extra: vec3<f32>,         // [border_width, border_brightness, _unused]
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) local_pos: vec2<f32>,     // Position within the rect (pixels)
    @location(2) rect_size: vec2<f32>,     // Rect size for SDF calculation
    @location(3) radius: f32,
    @location(4) border_width: f32,
    @location(5) border_brightness: f32,
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
    out.border_width = instance.extra.x;
    out.border_brightness = instance.extra.y;
    return out;
}

// SDF for a rounded rectangle centered at origin.
fn rounded_rect_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let bw = in.border_width;
    let bb = in.border_brightness;

    // Fast path: no rounding and no border
    if in.radius <= 0.0 && bw <= 0.0 {
        return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
    }

    // SDF-based rounded corners with anti-aliasing
    let half_size = in.rect_size * 0.5;
    let centered = in.local_pos - half_size;
    let dist = rounded_rect_sdf(centered, half_size, in.radius);

    // Smooth anti-aliased outer edge (1px feather)
    let aa = 1.0 - smoothstep(-1.0, 0.5, dist);

    // Border rendering: if border_width > 0, the border is drawn at the inner edge
    if bw > 0.0 {
        let inner_radius = max(in.radius - bw, 0.0);
        let inner_half = half_size - vec2<f32>(bw);
        let inner_dist = rounded_rect_sdf(centered, inner_half, inner_radius);
        let inner_aa = 1.0 - smoothstep(-1.0, 0.5, inner_dist);

        // border_mask: 1 in border zone, 0 in fill zone
        let border_mask = aa - inner_aa;

        if border_mask > 0.001 {
            // Derive border color from fill color adjusted by brightness
            let bc = clamp(in.color.rgb + vec3<f32>(bb * 0.15), vec3<f32>(0.0), vec3<f32>(1.0));
            let border_alpha = in.color.a * border_mask;
            let fill_alpha = in.color.a * inner_aa;

            // Composite: border behind fill
            let out_rgb = bc * border_alpha + in.color.rgb * fill_alpha;
            let out_a = border_alpha + fill_alpha * (1.0 - border_alpha);
            return vec4<f32>(out_rgb, out_a);
        }
    }

    let final_alpha = in.color.a * aa;
    return vec4<f32>(in.color.rgb * final_alpha, final_alpha);
}
