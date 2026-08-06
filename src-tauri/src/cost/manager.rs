use std::sync::Mutex;

use crate::db::ManagedDb;

use super::{
    persistence, CostCaps, CostCapsPersistenceError, CostCapsPolicy, CostCapsUpdateError,
    CostLimit, CostUsage, SpawnDecision,
};

struct CostManagerState {
    caps: CostCaps,
    db: Option<ManagedDb>,
}

impl Default for CostManagerState {
    fn default() -> Self {
        Self {
            caps: CostCaps::default(),
            db: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CostCapsRestoreOutcome {
    Missing,
    Restored(CostCaps),
    Rejected(CostCapsPersistenceError),
}

/// Thread-safe owner of the configurable cost caps, managed in Tauri state.
/// The spawn decision (`can_spawn`) is pure and takes the caller-computed
/// usage, so the controller/cockpit can gate a launch against live caps without
/// the manager needing a handle on the fleet.
pub struct CostManager {
    state: Mutex<CostManagerState>,
}

impl Default for CostManager {
    fn default() -> Self {
        Self {
            state: Mutex::new(CostManagerState::default()),
        }
    }
}

impl CostManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CostManagerState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn caps(&self) -> CostCaps {
        self.lock().caps
    }

    pub fn policy(&self) -> CostCapsPolicy {
        CostCapsPolicy::default()
    }

    pub fn attach_db(&self, db: ManagedDb) -> CostCapsRestoreOutcome {
        let restored = persistence::load(&db, self.policy());
        let mut state = self.lock();
        state.db = Some(db);
        match restored {
            Ok(Some(caps)) => {
                state.caps = caps;
                CostCapsRestoreOutcome::Restored(caps)
            }
            Ok(None) => {
                state.caps = CostCaps::default();
                CostCapsRestoreOutcome::Missing
            }
            Err(error) => {
                state.caps = CostCaps::default();
                CostCapsRestoreOutcome::Rejected(error)
            }
        }
    }

    pub fn set_caps(&self, caps: CostCaps) -> Result<CostCaps, CostCapsUpdateError> {
        caps.validate_for_update(self.policy())?;
        let mut state = self.lock();
        let db = state
            .db
            .as_ref()
            .ok_or_else(CostCapsPersistenceError::unavailable)?;
        persistence::save(db, caps)?;
        state.caps = caps;
        Ok(caps)
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
    use crate::db::Database;

    fn durable_manager() -> (CostManager, ManagedDb) {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        let manager = CostManager::new();
        assert_eq!(
            manager.attach_db(db.clone()),
            CostCapsRestoreOutcome::Missing
        );
        (manager, db)
    }

    #[test]
    fn default_caps_then_configurable() {
        let (mgr, _) = durable_manager();
        assert_eq!(mgr.caps().max_agents, Some(4));
        mgr.set_caps(CostCaps {
            max_agents: Some(12),
            ..CostCaps::default()
        })
        .unwrap();
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
        let (mgr, _) = durable_manager(); // max_agents = 4
        let at_cap = CostUsage {
            active_agents: 4,
            ..Default::default()
        };
        assert!(!mgr.can_spawn(&at_cap).allowed);

        mgr.set_caps(CostCaps {
            max_agents: Some(12),
            ..CostCaps::default()
        })
        .unwrap();
        assert!(mgr.can_spawn(&at_cap).allowed);
    }

    #[test]
    fn invalid_cap_update_does_not_mutate_the_current_owner() {
        let (mgr, _) = durable_manager();
        let before = mgr.caps();
        let error = mgr
            .set_caps(CostCaps {
                max_agents: None,
                ..before
            })
            .unwrap_err();
        assert!(matches!(
            error,
            CostCapsUpdateError::Validation(ref validation)
                if validation.field == "max_agents"
        ));
        assert_eq!(mgr.caps().max_agents, before.max_agents);
    }

    #[test]
    fn cap_update_without_durable_database_fails_without_mutation() {
        let mgr = CostManager::new();
        let before = mgr.caps();
        let error = mgr
            .set_caps(CostCaps {
                max_agents: Some(8),
                ..before
            })
            .unwrap_err();

        assert!(matches!(error, CostCapsUpdateError::Persistence(_)));
        assert_eq!(mgr.caps(), before);
    }

    #[test]
    fn persistence_failure_preserves_the_previous_runtime_caps() {
        let (mgr, db) = durable_manager();
        let accepted = mgr
            .set_caps(CostCaps {
                max_agents: Some(6),
                ..CostCaps::default()
            })
            .unwrap();
        db.with(|database| {
            database
                .conn()
                .execute_batch(
                    "CREATE TRIGGER reject_cost_caps_update
                     BEFORE UPDATE ON cost_caps_state
                     BEGIN
                         SELECT RAISE(ABORT, 'simulated persistence failure');
                     END;",
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();

        let error = mgr
            .set_caps(CostCaps {
                max_agents: Some(9),
                ..accepted
            })
            .unwrap_err();

        assert!(matches!(error, CostCapsUpdateError::Persistence(_)));
        assert_eq!(mgr.caps(), accepted);
    }

    #[test]
    fn saved_caps_restore_into_a_new_manager_after_database_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("aelyris.db");
        let saved = CostCaps {
            max_agents: Some(7),
            max_tokens: Some(50_000),
            max_cost_usd: Some(2.5),
            max_runtime_secs: Some(900),
        };

        {
            let db = ManagedDb::new(Database::open(&db_path).unwrap());
            let manager = CostManager::new();
            assert_eq!(manager.attach_db(db), CostCapsRestoreOutcome::Missing);
            assert_eq!(manager.set_caps(saved).unwrap(), saved);
        }

        let restored = CostManager::new();
        let outcome = restored.attach_db(ManagedDb::new(Database::open(&db_path).unwrap()));
        assert_eq!(outcome, CostCapsRestoreOutcome::Restored(saved));
        assert_eq!(restored.caps(), saved);
    }

    #[test]
    fn malformed_persisted_caps_restore_bounded_defaults_with_diagnostic() {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        db.with(|database| {
            database
                .conn()
                .execute(
                    "INSERT INTO cost_caps_state (
                        singleton_id, schema_version, caps_json, updated_at_ms
                     ) VALUES (1, 1, ?1, 1)",
                    [r#"{"max_agents":null,"max_tokens":null,"max_cost_usd":null,"max_runtime_secs":null}"#],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let manager = CostManager::new();

        let outcome = manager.attach_db(db);

        assert!(matches!(outcome, CostCapsRestoreOutcome::Rejected(_)));
        assert_eq!(manager.caps(), CostCaps::default());
    }
}
