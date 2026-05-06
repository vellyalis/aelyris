//! Microbenchmarks for the native terminal engine.
//!
//! Run with: `cargo bench --bench term_engine`
//!
//! What this measures:
//! - `advance_ascii`        — steady-state throughput on pure printable text.
//! - `advance_colored`      — same character count but with SGR colour runs.
//! - `advance_with_osc133`  — ASCII interspersed with OSC 133 prompt marks
//!                            (the pre-scan in `TermEngine::advance` adds a
//!                            byte loop on top of alacritty's parser, so
//!                            this catches any regression in that hot path).
//! - `snapshot`             — full grid snapshot cost at 80×24 and 200×50.
//! - `diff_no_change`       — `DiffTracker::diff` when nothing changed; this
//!                            is the common case between two frames.
//! - `diff_one_row_change`  — the next common case: a single shell line was
//!                            repainted.
//!
//! We deliberately do NOT benchmark the full PTY pipeline (spawn → read →
//! feed → render) here — that sits under portable-pty's OS thread and
//! alacritty, neither of which is worth re-benchmarking. The bottleneck
//! Aether owns is the engine wrapper, so that's what these benches cover.

use aether_terminal_lib::term::{DiffTracker, TermEngine};
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};

fn make_ascii_chunk(bytes: usize) -> Vec<u8> {
    let line = b"Lorem ipsum dolor sit amet consectetur adipiscing elit\n";
    let mut out = Vec::with_capacity(bytes);
    while out.len() < bytes {
        out.extend_from_slice(line);
    }
    out.truncate(bytes);
    out
}

fn make_colored_chunk(bytes: usize) -> Vec<u8> {
    // SGR colour runs surrounding 32-byte text blocks — realistic for the
    // kind of output Claude / Codex streams produce in the terminal.
    let mut out = Vec::with_capacity(bytes);
    while out.len() < bytes {
        out.extend_from_slice(b"\x1b[38;5;214m");
        out.extend_from_slice(b"warn: something interesting happened");
        out.extend_from_slice(b"\x1b[0m\n");
    }
    out.truncate(bytes);
    out
}

fn make_osc133_chunk(prompts: usize) -> Vec<u8> {
    // Each synthetic prompt cycle is one prompt-start, 40 bytes of command
    // text, output-start, 160 bytes of output, command-end.
    let mut out = Vec::new();
    for i in 0..prompts {
        out.extend_from_slice(b"\x1b]133;A\x07$ ");
        out.extend_from_slice(b"cargo build --release --timings\n");
        out.extend_from_slice(b"\x1b]133;C\x07");
        for _ in 0..4 {
            out.extend_from_slice(b"   Compiling aether-terminal v0.2.2\n");
        }
        if i % 4 == 0 {
            out.extend_from_slice(b"\x1b]133;D;1\x07");
        } else {
            out.extend_from_slice(b"\x1b]133;D;0\x07");
        }
    }
    out
}

fn bench_advance(c: &mut Criterion) {
    let mut group = c.benchmark_group("advance");
    for &kib in &[4usize, 64, 256] {
        let bytes = kib * 1024;
        group.throughput(Throughput::Bytes(bytes as u64));

        let ascii = make_ascii_chunk(bytes);
        group.bench_with_input(
            BenchmarkId::new("ascii", format!("{kib}KiB")),
            &ascii,
            |b, input| {
                b.iter_batched(
                    || TermEngine::new(120, 40).expect("engine"),
                    |mut engine| {
                        engine.advance(black_box(input));
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );

        let colored = make_colored_chunk(bytes);
        group.bench_with_input(
            BenchmarkId::new("colored", format!("{kib}KiB")),
            &colored,
            |b, input| {
                b.iter_batched(
                    || TermEngine::new(120, 40).expect("engine"),
                    |mut engine| {
                        engine.advance(black_box(input));
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();

    let mut osc_group = c.benchmark_group("advance_osc133");
    for &prompts in &[1usize, 10, 100] {
        let chunk = make_osc133_chunk(prompts);
        osc_group.throughput(Throughput::Bytes(chunk.len() as u64));
        osc_group.bench_with_input(BenchmarkId::from_parameter(prompts), &chunk, |b, input| {
            b.iter_batched(
                || TermEngine::new(120, 40).expect("engine"),
                |mut engine| {
                    engine.advance(black_box(input));
                },
                criterion::BatchSize::SmallInput,
            );
        });
    }
    osc_group.finish();
}

fn bench_snapshot(c: &mut Criterion) {
    let mut group = c.benchmark_group("snapshot");
    for &(cols, rows) in &[(80usize, 24usize), (200, 50)] {
        let mut engine = TermEngine::new(cols, rows).expect("engine");
        // Paint every cell so the snapshot has real content to serialise.
        let fill = make_colored_chunk(cols * rows);
        engine.advance(&fill);

        group.bench_function(BenchmarkId::from_parameter(format!("{cols}x{rows}")), |b| {
            b.iter(|| black_box(engine.snapshot()));
        });
    }
    group.finish();
}

fn bench_diff(c: &mut Criterion) {
    let mut group = c.benchmark_group("diff");

    // Pre-state: fill a 120x40 grid with colored output.
    let build_engine = || {
        let mut engine = TermEngine::new(120, 40).expect("engine");
        engine.advance(&make_colored_chunk(120 * 40));
        engine
    };

    group.bench_function("no_change", |b| {
        let engine = build_engine();
        let mut tracker = DiffTracker::new();
        // Prime the tracker so the first "diff" returns a full frame and
        // subsequent calls reflect the no-change hot path.
        let _ = tracker.diff(&engine);
        b.iter(|| black_box(tracker.diff(&engine)));
    });

    group.bench_function("one_row_change", |b| {
        let engine = build_engine();
        let mut tracker = DiffTracker::new();
        let _ = tracker.diff(&engine);
        // Alternate between engines so the diff reports one row changed
        // every iteration instead of collapsing to no-change after the
        // first call.
        let mut alt = build_engine();
        alt.advance(b"\n\r\x1b[38;5;203mONE-ROW-CHANGE\x1b[0m");
        let _ = tracker.diff(&alt);
        b.iter(|| black_box(tracker.diff(&engine)));
    });
    group.finish();
}

criterion_group!(benches, bench_advance, bench_snapshot, bench_diff);
criterion_main!(benches);
