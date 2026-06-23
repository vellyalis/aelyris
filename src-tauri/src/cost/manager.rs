use std::sync::Mutex;

use super::{CostCaps, CostLimit, CostUsage, SpawnDecision};

/// Thread-safe owner of the configurable cost caps, managed in Tauri state.
/// The spawn decision (`can_spawn`) is pure and takes the caller-computed
/// usage, so the controller/cockpit can gate a launch against live caps without
/// the manager needing a handle on the fleet.
#[derive(Default)]
pub struct CostManager {
    caps: Mutex<CostCaps>,
}

impl CostManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CostCaps> {
        self.caps
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn caps(&self) -> CostCaps {
        *self.lock()
    }

    pub fn set_caps(&self, caps: CostCaps) {
        *self.lock() = caps;
    }

    pub fn can_spawn(&self, usage: &CostUsage) -> SpawnDecision {
        self.caps().can_spawn(usage)
    }

    /// Spawn-path guard: block a new agent when the live fleet is at the agent
    /// cap. Only the agent-count axis is enforced here (the spawn site has the
    /// live count but not token/cost telemetry); budget halts are the loop's
    /// job via `can_spawn` with full usage. Returns the block reason on refusal.
    pub fn guard_spawn(&self, active_agents: usize) -> Result<(), String> {
        let usage = CostUsage {
            active_agents,
            ..Default::default()
        };
        let decision = self.can_spawn(&usage);
        if decision.allowed {
            Ok(())
        } else {
            Err(decision
                .reason
                .unwrap_or_else(|| "cost cap reached".to_string()))
        }
    }

    pub fn over_budget(&self, usage: &CostUsage) -> Option<CostLimit> {
        self.caps().over_budget(usage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_caps_then_configurable() {
        let mgr = CostManager::new();
        assert_eq!(mgr.caps().max_agents, Some(4));
        mgr.set_caps(CostCaps {
            max_agents: Some(12),
            ..CostCaps::default()
        });
        assert_eq!(mgr.caps().max_agents, Some(12));
    }

    #[test]
    fn guard_spawn_blocks_at_cap_and_allows_under() {
        let mgr = CostManager::new(); // max_agents = 4
        assert!(mgr.guard_spawn(3).is_ok());
        assert!(mgr.guard_spawn(4).unwrap_err().contains("4/4"));
    }

    #[test]
    fn can_spawn_uses_current_caps() {
        let mgr = CostManager::new(); // max_agents = 4
        let at_cap = CostUsage {
            active_agents: 4,
            ..Default::default()
        };
        assert!(!mgr.can_spawn(&at_cap).allowed);

        mgr.set_caps(CostCaps {
            max_agents: Some(12),
            ..CostCaps::default()
        });
        assert!(mgr.can_spawn(&at_cap).allowed);
    }
}
