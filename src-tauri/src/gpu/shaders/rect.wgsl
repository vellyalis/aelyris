// Rectangle shader — solid/gradient fill, rounded corners (SDF), borders.
//
// Features:
// - Solid color or linear gradient fill
// - SDF-based anti-aliased rounded corners
// - SDF-based anti-aliased borders with brightness adjustment

struct Uniforms {
    viewport_size: vec2<f32>,
    _padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct RectInstance {
    @location(0) pos: vec2<f32>,
    @location(1) size: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) border_radius: f32,
    @location(4) border_width: f32,
    @location(5) border_brightness: f32,
    @location(6) gradient_angle: f32,
    @location(7) color2: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) local_pos: vec2<f32>,
    @location(2) rect_size: vec2<f32>,
    @location(3) radius: f32,
    @location(4) border_width: f32,
    @location(5) border_brightness: f32,
    @location(6) gradient_angle: f32,
    @location(7) color2: vec4<f32>,
    @location(8) uv: vec2<f32>,            // 0..1 normalized position
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
    out.border_width = instance.border_width;
    out.border_brightness = instance.border_brightness;
    out.gradient_angle = instance.gradient_angle;
    out.color2 = instance.color2;
    out.uv = quad;
    return out;
}

// SDF for a rounded rectangle centered at origin.
fn rounded_rect_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // --- Determine fill color (solid or gradient) ---
    var fill = in.color;
    if in.gradient_angle != 0.0 {
        // Linear gradient: project UV onto gradient direction
        let angle = in.gradient_angle;
        let dir = vec2<f32>(cos(angle), sin(angle));
        // Shift UV to -0.5..0.5, project onto direction, remap to 0..1
        let centered_uv = in.uv - vec2<f32>(0.5);
        let t = clamp(dot(centered_uv, dir) + 0.5, 0.0, 1.0);
        fill = mix(in.color, in.color2, vec4<f32>(t));
    }

    // --- Fast path: no rounding and no border ---
    if in.radius <= 0.0 && in.border_width <= 0.0 {
        return vec4<f32>(fill.rgb * fill.a, fill.a);
    }

    // --- SDF for outer shape ---
    let half_size = in.rect_size * 0.5;
    let centered = in.local_pos - half_size;
    let dist = rounded_rect_sdf(centered, half_size, in.radius);
    let aa = 1.0 - smoothstep(-1.0, 0.5, dist);

    // --- Border ---
    if in.border_width > 0.0 {
        let bw = in.border_width;
        let inner_radius = max(in.radius - bw, 0.0);
        let inner_half = half_size - vec2<f32>(bw);
        let inner_dist = rounded_rect_sdf(centered, inner_half, inner_radius);
        let inner_aa = 1.0 - smoothstep(-1.0, 0.5, inner_dist);

        let border_mask = aa - inner_aa;

        if border_mask > 0.001 {
            let bb = in.border_brightness;
            let bc = clamp(fill.rgb + vec3<f32>(bb * 0.15), vec3<f32>(0.0), vec3<f32>(1.0));
            let border_alpha = fill.a * border_mask;
            let fill_alpha = fill.a * inner_aa;
            let out_rgb = bc * border_alpha + fill.rgb * fill_alpha;
            let out_a = border_alpha + fill_alpha * (1.0 - border_alpha);
            return vec4<f32>(out_rgb, out_a);
        }
    }

    let final_alpha = fill.a * aa;
    return vec4<f32>(fill.rgb * final_alpha, final_alpha);
}
