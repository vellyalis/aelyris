// Gaussian blur shader — separable 2-pass (horizontal then vertical).
//
// Samples the input texture with a 9-tap Gaussian kernel.
// Pass direction is controlled by the `direction` uniform:
//   (1,0) = horizontal pass, (0,1) = vertical pass.

struct BlurUniforms {
    direction: vec2<f32>,  // (1,0) or (0,1)
    tex_size: vec2<f32>,   // texture dimensions in pixels
};

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(0) @binding(2) var<uniform> blur_uniforms: BlurUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Full-screen triangle (3 vertices cover the entire screen)
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    var uv = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0),
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[vi], 0.0, 1.0);
    out.uv = uv[vi];
    return out;
}

// 9-tap Gaussian weights (sigma ≈ 4)
const OFFSETS: array<f32, 5> = array<f32, 5>(0.0, 1.0, 2.0, 3.0, 4.0);
const WEIGHTS: array<f32, 5> = array<f32, 5>(
    0.2270270270,
    0.1945945946,
    0.1216216216,
    0.0540540541,
    0.0162162162,
);

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Passthrough mode: if direction is zero, just sample and return (blit)
    if dot(blur_uniforms.direction, blur_uniforms.direction) < 0.001 {
        return textureSample(input_tex, input_sampler, in.uv);
    }

    let pixel_step = blur_uniforms.direction / blur_uniforms.tex_size;

    var result = textureSample(input_tex, input_sampler, in.uv) * WEIGHTS[0];

    for (var i = 1u; i < 5u; i++) {
        let offset = pixel_step * OFFSETS[i];
        result += textureSample(input_tex, input_sampler, in.uv + offset) * WEIGHTS[i];
        result += textureSample(input_tex, input_sampler, in.uv - offset) * WEIGHTS[i];
    }

    return result;
}
