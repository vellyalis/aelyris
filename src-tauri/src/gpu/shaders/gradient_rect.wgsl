// Gradient rectangle shader — gradient fill, rounded corners (SDF), drop shadow.
//
// A dedicated pipeline for rects that need:
// - Linear gradient fill (arbitrary angle)
// - SDF-based anti-aliased rounded corners
// - Soft drop shadow (gaussian-like SDF falloff)
//
// Separate from rect.wgsl to avoid breaking the existing pipeline layout.

struct Uniforms {
    viewport_size: vec2<f32>,
    _padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct GradientRectInstance {
    @location(0) pos: vec2<f32>,
    @location(1) size: vec2<f32>,
    @location(2) color_start: vec4<f32>,
    @location(3) color_end: vec4<f32>,
    @location(4) corner_radius: f32,
    @location(5) gradient_angle: f32,   // radians (0 = top-to-bottom, PI/2 = left-to-right)
    @location(6) shadow_blur: f32,      // shadow blur radius (px). 0 = no shadow
    @location(7) shadow_alpha: f32,     // shadow opacity (0..1)
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color_start: vec4<f32>,
    @location(1) color_end: vec4<f32>,
    @location(2) local_pos: vec2<f32>,
    @location(3) rect_size: vec2<f32>,
    @location(4) radius: f32,
    @location(5) gradient_angle: f32,
    @location(6) shadow_blur: f32,
    @location(7) shadow_alpha: f32,
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
    instance: GradientRectInstance,
) -> VertexOutput {
    let quad = QUAD_POS[vertex_index];

    // Expand the quad by shadow_blur on each side so the shadow has room to render.
    let expand = instance.shadow_blur;
    let expanded_size = instance.size + vec2<f32>(expand * 2.0);
    let expanded_pos = instance.pos - vec2<f32>(expand);

    let pixel_pos = expanded_pos + quad * expanded_size;

    let ndc = vec2<f32>(
        pixel_pos.x / uniforms.viewport_size.x * 2.0 - 1.0,
        1.0 - pixel_pos.y / uniforms.viewport_size.y * 2.0,
    );

    // local_pos relative to the original (non-expanded) rect origin.
    // This means local_pos goes from -expand to size+expand.
    let local = quad * expanded_size - vec2<f32>(expand);

    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    out.color_start = instance.color_start;
    out.color_end = instance.color_end;
    out.local_pos = local;
    out.rect_size = instance.size;
    out.radius = instance.corner_radius;
    out.gradient_angle = instance.gradient_angle;
    out.shadow_blur = instance.shadow_blur;
    out.shadow_alpha = instance.shadow_alpha;
    return out;
}

// SDF for a rounded rectangle centered at origin.
fn rounded_rect_sdf(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let half_size = in.rect_size * 0.5;
    let centered = in.local_pos - half_size;

    // --- Drop shadow ---
    if in.shadow_blur > 0.0 {
        let shadow_dist = rounded_rect_sdf(centered, half_size, in.radius);
        // Outside the rect: draw shadow
        if shadow_dist > 0.0 {
            let shadow_factor = 1.0 - smoothstep(0.0, in.shadow_blur, shadow_dist);
            let shadow_a = shadow_factor * in.shadow_alpha;
            // Shadow color: black with falloff alpha (premultiplied)
            return vec4<f32>(0.0, 0.0, 0.0, shadow_a);
        }
    }

    // --- SDF for outer shape (anti-aliased rounded corners) ---
    let dist = rounded_rect_sdf(centered, half_size, in.radius);
    let aa = 1.0 - smoothstep(-1.0, 0.5, dist);

    // --- Gradient ---
    // Normalize local_pos to 0..1 UV space
    let uv = in.local_pos / in.rect_size;

    var fill: vec4<f32>;
    if in.gradient_angle == 0.0 && in.color_start.r == in.color_end.r
       && in.color_start.g == in.color_end.g && in.color_start.b == in.color_end.b
       && in.color_start.a == in.color_end.a {
        // Solid color fast path
        fill = in.color_start;
    } else {
        // Linear gradient along the given angle
        let angle = in.gradient_angle;
        let dir = vec2<f32>(cos(angle), sin(angle));
        let centered_uv = uv - vec2<f32>(0.5);
        let t = clamp(dot(centered_uv, dir) + 0.5, 0.0, 1.0);
        fill = mix(in.color_start, in.color_end, vec4<f32>(t));
    }

    let final_alpha = fill.a * aa;
    return vec4<f32>(fill.rgb * final_alpha, final_alpha);
}
