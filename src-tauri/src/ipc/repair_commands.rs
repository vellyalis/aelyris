//! Phase 3A-1: IPC for the auto-repair pipeline.
//!
//! Exposes the `AutoRepairManager` state (registered in `lib.rs`) to the
//! frontend — list jobs, trigger manually, and toggle the global on/off
//! flag that the PTY reader reads on every chunk.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::watchdog::auto_repair::AutoRepairManager;
use crate::watchdog::{self, AutoRepairConfig, ErrorContext, RepairJobInfo, WatchdogRules};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoRepairConfigDto {
    pub enabled: bool,
    pub pattern: String,
}

impl From<AutoRepairConfig> for AutoRepairConfigDto {
    fn from(cfg: AutoRepairConfig) -> Self {
        Self {
            enabled: cfg.enabled,
            pattern: cfg.pattern,
        }
    }
}

impl From<AutoRepairConfigDto> for AutoRepairConfig {
    fn from(dto: AutoRepairConfigDto) -> Self {
        Self {
            enabled: dto.enabled,
            pattern: dto.pattern,
        }
    }
}

/// Snapshot of all active / recent repair jobs.
#[tauri::command]
pub fn list_repair_jobs(app: AppHandle) -> Vec<RepairJobInfo> {
    let Some(state) = app.try_state::<Arc<Mutex<AutoRepairManager>>>() else {
        return Vec::new();
    };
    let Ok(mgr) = state.inner().lock() else {
        return Vec::new();
    };
    mgr.jobs()
}

/// Manually trigger a repair job — used when a user right-clicks an error
/// line and asks for an on-demand fix attempt.
#[tauri::command]
pub fn trigger_repair_manual(
    app: AppHandle,
    error_line: String,
    source_pane: String,
    repo_path: String,
) -> Result<Option<String>, String> {
    let state = app
        .try_state::<Arc<Mutex<AutoRepairManager>>>()
        .ok_or_else(|| "AutoRepairManager state missing".to_string())?;
    let mut mgr = state
        .inner()
        .lock()
        .map_err(|_| "auto-repair mutex poisoned".to_string())?;
    let ctx = ErrorContext {
        matched_line: error_line,
        source_pane,
    };
    Ok(mgr.trigger(ctx, &PathBuf::from(repo_path)))
}

/// Return the current auto-repair config. Reads from the in-memory managed
/// state — falls back to disk if the state is missing (tests / early boot).
#[tauri::command]
pub fn get_auto_repair_config(app: AppHandle) -> AutoRepairConfigDto {
    if let Some(state) = app.try_state::<Arc<Mutex<AutoRepairConfig>>>() {
        if let Ok(cfg) = state.inner().lock() {
            return cfg.clone().into();
        }
    }
    watchdog::load_watchdog_rules().auto_repair.into()
}

/// Persist a new auto-repair config. Either field is optional so the
/// StatusBar can flip just `enabled` without shipping the whole pattern.
/// The in-memory managed state is updated so the PTY reader (which checks
/// the config on every chunk) picks up changes without a restart.
#[tauri::command]
pub fn set_auto_repair_config(
    app: AppHandle,
    enabled: Option<bool>,
    pattern: Option<String>,
) -> Result<AutoRepairConfigDto, String> {
    let mut rules: WatchdogRules = watchdog::load_watchdog_rules();
    if let Some(e) = enabled {
        rules.auto_repair.enabled = e;
    }
    if let Some(p) = pattern {
        // An empty pattern would trigger on every line — reject.
        if p.trim().is_empty() {
            return Err("auto-repair pattern must not be empty".to_string());
        }
        rules.auto_repair.pattern = p;
    }
    watchdog::save_watchdog_rules(&rules)?;

    // Propagate to the in-memory state so PTY readers notice without a restart.
    if let Some(state) = app.try_state::<Arc<Mutex<AutoRepairConfig>>>() {
        if let Ok(mut cfg) = state.inner().lock() {
            *cfg = rules.auto_repair.clone();
        }
    }

    Ok(rules.auto_repair.into())
}
