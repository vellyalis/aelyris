//! Lightweight animation engine for GPU-rendered UI.
//!
//! Provides `AnimatedValue` with three easing modes:
//! spring physics, ease-out cubic, and linear interpolation.
//! All computations are pure — no external dependencies.

const DT: f32 = 1.0 / 60.0;
const THRESHOLD: f32 = 0.01;

/// Easing mode that drives how `AnimatedValue` interpolates.
#[derive(Clone, Debug)]
pub enum EasingMode {
    /// Damped spring simulation (physically-based).
    Spring { stiffness: f32, damping: f32 },
    /// CSS-style ease-out cubic curve over a fixed frame count.
    EaseOutCubic {
        duration_frames: u32,
        elapsed: u32,
        origin: f32,
    },
    /// Simple linear interpolation over a fixed frame count.
    Linear {
        duration_frames: u32,
        elapsed: u32,
        origin: f32,
    },
}

/// A single animated scalar value.
#[derive(Clone, Debug)]
pub struct AnimatedValue {
    pub current: f32,
    pub target: f32,
    pub velocity: f32,
    pub easing: EasingMode,
}

impl AnimatedValue {
    /// Create a spring-based animated value.
    pub fn spring(initial: f32, stiffness: f32, damping: f32) -> Self {
        Self {
            current: initial,
            target: initial,
            velocity: 0.0,
            easing: EasingMode::Spring { stiffness, damping },
        }
    }

    /// Create a spring-based animated value with default parameters (stiffness=300, damping=30).
    pub fn spring_default(initial: f32) -> Self {
        Self::spring(initial, 300.0, 30.0)
    }

    /// Create an ease-out cubic animated value.
    pub fn ease_out(initial: f32, duration_frames: u32) -> Self {
        Self {
            current: initial,
            target: initial,
            velocity: 0.0,
            easing: EasingMode::EaseOutCubic {
                duration_frames,
                elapsed: 0,
                origin: initial,
            },
        }
    }

    /// Create a linear animated value.
    pub fn linear(initial: f32, duration_frames: u32) -> Self {
        Self {
            current: initial,
            target: initial,
            velocity: 0.0,
            easing: EasingMode::Linear {
                duration_frames,
                elapsed: 0,
                origin: initial,
            },
        }
    }

    /// Set a new target value. Resets elapsed frames for timed easings,
    /// captures the current position as the new origin, and clears velocity
    /// for spring mode.
    pub fn set_target(&mut self, target: f32) {
        self.target = target;
        match &mut self.easing {
            EasingMode::Spring { .. } => {
                self.velocity = 0.0;
            }
            EasingMode::EaseOutCubic { elapsed, origin, .. } => {
                *origin = self.current;
                *elapsed = 0;
            }
            EasingMode::Linear { elapsed, origin, .. } => {
                *origin = self.current;
                *elapsed = 0;
            }
        }
    }

    /// Returns `true` if the animation has not yet settled.
    pub fn is_animating(&self) -> bool {
        (self.current - self.target).abs() > THRESHOLD
    }

    /// Immediately snap to the target value, stopping all motion.
    pub fn snap(&mut self) {
        self.current = self.target;
        self.velocity = 0.0;
        match &mut self.easing {
            EasingMode::Spring { .. } => {}
            EasingMode::EaseOutCubic {
                duration_frames,
                elapsed,
                origin,
            } => {
                *elapsed = *duration_frames;
                *origin = self.target;
            }
            EasingMode::Linear {
                duration_frames,
                elapsed,
                origin,
            } => {
                *elapsed = *duration_frames;
                *origin = self.target;
            }
        }
    }

    /// Advance the animation by one frame (dt = 1/60 s).
    pub fn tick(&mut self) {
        if !self.is_animating() {
            self.current = self.target;
            return;
        }

        match &mut self.easing {
            EasingMode::Spring {
                stiffness,
                damping,
            } => {
                let displacement = self.current - self.target;
                let spring_force = -(*stiffness) * displacement;
                let damping_force = -(*damping) * self.velocity;
                let acceleration = spring_force + damping_force;

                self.velocity += acceleration * DT;
                self.current += self.velocity * DT;
            }
            EasingMode::EaseOutCubic {
                duration_frames,
                elapsed,
                origin,
            } => {
                if *elapsed >= *duration_frames {
                    self.current = self.target;
                    return;
                }
                *elapsed += 1;
                let t = *elapsed as f32 / *duration_frames as f32;
                let ease = 1.0 - (1.0 - t).powi(3);
                self.current = *origin + (self.target - *origin) * ease;
            }
            EasingMode::Linear {
                duration_frames,
                elapsed,
                origin,
            } => {
                if *elapsed >= *duration_frames {
                    self.current = self.target;
                    return;
                }
                *elapsed += 1;
                let t = *elapsed as f32 / *duration_frames as f32;
                self.current = *origin + (self.target - *origin) * t;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spring_converges_within_30_frames() {
        let mut val = AnimatedValue::spring_default(0.0);
        val.set_target(100.0);

        for _ in 0..30 {
            val.tick();
        }

        assert!(
            (val.current - 100.0).abs() < 1.0,
            "Spring should be within 1.0 of target after 30 frames, got {}",
            val.current
        );
    }

    #[test]
    fn ease_out_cubic_reaches_target_at_duration() {
        let frames = 20;
        let mut val = AnimatedValue::ease_out(0.0, frames);
        val.set_target(100.0);

        for _ in 0..frames {
            val.tick();
        }

        assert!(
            (val.current - 100.0).abs() < THRESHOLD,
            "EaseOutCubic should reach target at duration_frames, got {}",
            val.current
        );
    }

    #[test]
    fn linear_reaches_target_at_duration() {
        let frames = 20;
        let mut val = AnimatedValue::linear(0.0, frames);
        val.set_target(100.0);

        for _ in 0..frames {
            val.tick();
        }

        assert!(
            (val.current - 100.0).abs() < THRESHOLD,
            "Linear should reach target at duration_frames, got {}",
            val.current
        );
    }

    #[test]
    fn is_animating_false_when_snapped() {
        let mut val = AnimatedValue::spring_default(0.0);
        val.set_target(100.0);
        val.snap();

        assert!(
            !val.is_animating(),
            "is_animating() should be false after snap()"
        );
        assert_eq!(val.current, 100.0);
    }

    #[test]
    fn is_animating_true_before_convergence() {
        let mut val = AnimatedValue::spring_default(0.0);
        val.set_target(100.0);
        val.tick();

        assert!(
            val.is_animating(),
            "is_animating() should be true during animation"
        );
    }

    #[test]
    fn snap_stops_all_motion() {
        let mut val = AnimatedValue::spring_default(0.0);
        val.set_target(50.0);
        val.tick();
        val.tick();
        val.snap();

        assert_eq!(val.current, 50.0);
        assert_eq!(val.velocity, 0.0);
    }

    #[test]
    fn linear_midpoint_is_half() {
        let frames = 10;
        let mut val = AnimatedValue::linear(0.0, frames);
        val.set_target(100.0);

        for _ in 0..5 {
            val.tick();
        }

        assert!(
            (val.current - 50.0).abs() < 0.5,
            "Linear midpoint should be ~50.0, got {}",
            val.current
        );
    }

    #[test]
    fn ease_out_starts_fast() {
        let frames = 20;
        let mut val = AnimatedValue::ease_out(0.0, frames);
        val.set_target(100.0);

        for _ in 0..5 {
            val.tick();
        }

        assert!(
            val.current > 25.0,
            "EaseOutCubic should move faster at start, got {} (expected > 25.0)",
            val.current
        );
    }
}
