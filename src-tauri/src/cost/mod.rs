//! Cost Manager — runaway prevention for the autonomous loop.
//!
//! See docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 7. Hard caps bound the fleet; when a cap is reached the loop
//! must **block new agent spawn** (concurrency / budget) and **halt cleanly**
//! (budget). This module is the pure decision logic; the spawn gate wires it
//! into the agent-spawn path. Fed by `AgentSession` cost/token telemetry.

pub mod manager;

pub use manager::CostManager;

use serde::{Deserialize, Serialize};

pub const MIN_CONFIGURED_AGENTS: usize = 1;
pub const MAX_CONFIGURED_AGENTS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CostCapsPolicy {
    pub min_agents: usize,
    pub max_agents: usize,
}

impl Default for CostCapsPolicy {
    fn default() -> Self {
        Self {
            min_agents: MIN_CONFIGURED_AGENTS,
            max_agents: MAX_CONFIGURED_AGENTS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("invalid_cost_caps: {field}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct CostCapsValidationError {
    pub code: &'static str,
    pub field: &'static str,
    pub message: String,
}

impl CostCapsValidationError {
    fn new(field: &'static str, message: impl Into<String>) -> Self {
        Self {
            code: "invalid_cost_caps",
            field,
            message: message.into(),
        }
    }
}

/// Hard caps. `None` means "no limit on this axis". The default fleet size is a
/// controlled-but-bounded 4 concurrent agents — the spec's binding default
/// (AELYRIS_COCKPIT_REQUIREMENTS BR7: `max_agents` default 4; worker batch 3-4),
/// favouring controlled parallel engineering over a dense stress fleet, while
/// still being a hard ceiling the loop never exceeds (BR7 runaway protection). It
/// stays runtime-configurable (`cost_set_caps`), so an operator who wants a denser
/// fleet can raise it; there is no budget ceiling until the operator sets one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CostCaps {
    pub max_agents: Option<usize>,
    pub max_tokens: Option<u64>,
    pub max_cost_usd: Option<f64>,
    pub max_runtime_secs: Option<u64>,
}

impl Default for CostCaps {
    fn default() -> Self {
        Self {
            max_agents: Some(4),
            max_tokens: None,
            max_cost_usd: None,
            max_runtime_secs: None,
        }
    }
}

/// Current fleet resource usage.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct CostUsage {
    pub active_agents: usize,
    pub tokens_used: u64,
    pub cost_usd: f64,
    pub runtime_secs: u64,
}

/// Which cap is binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostLimit {
    Agents,
    Tokens,
    Cost,
    Runtime,
}

impl CostLimit {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Agents => "agents",
            Self::Tokens => "tokens",
            Self::Cost => "cost",
            Self::Runtime => "runtime",
        }
    }
}

/// Outcome of a spawn check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpawnDecision {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_by: Option<CostLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl SpawnDecision {
    fn allow() -> Self {
        Self {
            allowed: true,
            blocked_by: None,
            reason: None,
        }
    }

    fn block(limit: CostLimit, reason: String) -> Self {
        Self {
            allowed: false,
            blocked_by: Some(limit),
            reason: Some(reason),
        }
    }
}

impl CostCaps {
    pub fn validate_for_update(
        &self,
        policy: CostCapsPolicy,
    ) -> Result<(), CostCapsValidationError> {
        let max_agents = self.max_agents.ok_or_else(|| {
            CostCapsValidationError::new(
                "max_agents",
                "a bounded agent cap is required for cockpit/runtime updates",
            )
        })?;
        if !(policy.min_agents..=policy.max_agents).contains(&max_agents) {
            return Err(CostCapsValidationError::new(
                "max_agents",
                format!(
                    "must be between {} and {}",
                    policy.min_agents, policy.max_agents
                ),
            ));
        }
        if self.max_tokens == Some(0) {
            return Err(CostCapsValidationError::new(
                "max_tokens",
                "must be absent or a positive integer",
            ));
        }
        if let Some(max_cost_usd) = self.max_cost_usd {
            if !max_cost_usd.is_finite() || max_cost_usd <= 0.0 {
                return Err(CostCapsValidationError::new(
                    "max_cost_usd",
                    "must be absent or a finite positive number",
                ));
            }
        }
        if self.max_runtime_secs == Some(0) {
            return Err(CostCapsValidationError::new(
                "max_runtime_secs",
                "must be absent or a positive integer",
            ));
        }
        Ok(())
    }

    /// Decide whether **one more** agent may spawn. Blocks when the agent
    /// concurrency cap is full or any budget cap is already met/exceeded
    /// (spawning more would only deepen the overrun).
    pub fn can_spawn(&self, usage: &CostUsage) -> SpawnDecision {
        if let Some(max) = self.max_agents {
            if usage.active_agents >= max {
                return SpawnDecision::block(
                    CostLimit::Agents,
                    format!("agent cap reached: {}/{max} active", usage.active_agents),
                );
            }
        }
        if let Some(limit) = self.over_budget(usage) {
            return SpawnDecision::block(limit, format!("{} budget cap reached", limit.as_str()));
        }
        SpawnDecision::allow()
    }

    /// The first budget cap (tokens / cost / runtime) that is met or exceeded,
    /// if any. Used to halt the loop cleanly. The agent cap is a concurrency
    /// limit, not a halt condition, so it is intentionally excluded here.
    pub fn over_budget(&self, usage: &CostUsage) -> Option<CostLimit> {
        if let Some(max) = self.max_tokens {
            if usage.tokens_used >= max {
                return Some(CostLimit::Tokens);
            }
        }
        if let Some(max) = self.max_cost_usd {
            if usage.cost_usd >= max {
                return Some(CostLimit::Cost);
            }
        }
        if let Some(max) = self.max_runtime_secs {
            if usage.runtime_secs >= max {
                return Some(CostLimit::Runtime);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_allows_spawn_under_agent_cap() {
        let caps = CostCaps::default();
        let usage = CostUsage {
            active_agents: 3,
            ..Default::default()
        };
        let decision = caps.can_spawn(&usage);
        assert!(decision.allowed);
        assert_eq!(decision.blocked_by, None);
    }

    #[test]
    fn blocks_spawn_at_agent_cap() {
        let caps = CostCaps::default(); // max_agents = 4
        let usage = CostUsage {
            active_agents: 4,
            ..Default::default()
        };
        let decision = caps.can_spawn(&usage);
        assert!(!decision.allowed);
        assert_eq!(decision.blocked_by, Some(CostLimit::Agents));
        assert!(decision.reason.unwrap().contains("4/4"));
    }

    #[test]
    fn blocks_spawn_over_token_budget() {
        let caps = CostCaps {
            max_agents: None,
            max_tokens: Some(1_000),
            max_cost_usd: None,
            max_runtime_secs: None,
        };
        let usage = CostUsage {
            tokens_used: 1_000,
            ..Default::default()
        };
        assert_eq!(caps.can_spawn(&usage).blocked_by, Some(CostLimit::Tokens));
        assert_eq!(caps.over_budget(&usage), Some(CostLimit::Tokens));
    }

    #[test]
    fn blocks_spawn_over_cost_budget() {
        let caps = CostCaps {
            max_agents: None,
            max_tokens: None,
            max_cost_usd: Some(5.0),
            max_runtime_secs: None,
        };
        let usage = CostUsage {
            cost_usd: 5.01,
            ..Default::default()
        };
        assert_eq!(caps.can_spawn(&usage).blocked_by, Some(CostLimit::Cost));
    }

    #[test]
    fn agent_cap_does_not_count_as_over_budget() {
        let caps = CostCaps::default();
        let usage = CostUsage {
            active_agents: 99,
            ..Default::default()
        };
        // At capacity, but the loop is not over a *budget* cap, so it should
        // not halt — it just cannot spawn more right now.
        assert_eq!(caps.over_budget(&usage), None);
        assert!(!caps.can_spawn(&usage).allowed);
    }

    #[test]
    fn unlimited_caps_always_allow() {
        let caps = CostCaps {
            max_agents: None,
            max_tokens: None,
            max_cost_usd: None,
            max_runtime_secs: None,
        };
        let usage = CostUsage {
            active_agents: 1_000,
            tokens_used: u64::MAX,
            cost_usd: 1_000_000.0,
            runtime_secs: u64::MAX,
        };
        assert!(caps.can_spawn(&usage).allowed);
        assert_eq!(caps.over_budget(&usage), None);
    }

    #[test]
    fn runtime_budget_halts() {
        let caps = CostCaps {
            max_agents: Some(10),
            max_tokens: None,
            max_cost_usd: None,
            max_runtime_secs: Some(3_600),
        };
        let usage = CostUsage {
            active_agents: 1,
            runtime_secs: 3_600,
            ..Default::default()
        };
        assert_eq!(caps.over_budget(&usage), Some(CostLimit::Runtime));
        assert_eq!(caps.can_spawn(&usage).blocked_by, Some(CostLimit::Runtime));
    }

    #[test]
    fn runtime_cap_updates_require_bounded_agents_and_positive_optional_axes() {
        let policy = CostCapsPolicy::default();
        assert!(CostCaps::default().validate_for_update(policy).is_ok());

        for invalid in [
            CostCaps {
                max_agents: None,
                ..CostCaps::default()
            },
            CostCaps {
                max_agents: Some(0),
                ..CostCaps::default()
            },
            CostCaps {
                max_agents: Some(MAX_CONFIGURED_AGENTS + 1),
                ..CostCaps::default()
            },
            CostCaps {
                max_tokens: Some(0),
                ..CostCaps::default()
            },
            CostCaps {
                max_cost_usd: Some(0.0),
                ..CostCaps::default()
            },
            CostCaps {
                max_cost_usd: Some(f64::NAN),
                ..CostCaps::default()
            },
            CostCaps {
                max_runtime_secs: Some(0),
                ..CostCaps::default()
            },
        ] {
            assert!(invalid.validate_for_update(policy).is_err(), "{invalid:?}");
        }
    }
}
