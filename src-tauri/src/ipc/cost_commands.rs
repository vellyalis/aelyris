use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::cost::{
    CostCaps, CostCapsPolicy, CostCapsValidationError, CostManager, CostUsage, SpawnDecision,
};

const COST_CAPS_UPDATED: &str = "cost-caps-updated";

/// Current cost caps (for the settings/cockpit surface).
#[tauri::command]
pub fn cost_caps(manager: State<'_, Arc<CostManager>>) -> CostCaps {
    manager.caps()
}

#[tauri::command]
pub fn cost_caps_policy(manager: State<'_, Arc<CostManager>>) -> CostCapsPolicy {
    manager.policy()
}

/// Update the caps and broadcast them so open surfaces re-render.
#[tauri::command]
pub fn cost_set_caps(
    app: AppHandle,
    manager: State<'_, Arc<CostManager>>,
    caps: CostCaps,
) -> Result<CostCaps, CostCapsValidationError> {
    let updated = manager.set_caps(caps)?;
    let _ = app.emit(COST_CAPS_UPDATED, updated);
    Ok(updated)
}

/// Decide whether one more agent may spawn against the caller-computed usage.
/// The controller/cockpit calls this before launching an agent (BR7).
#[tauri::command]
pub fn cost_can_spawn(manager: State<'_, Arc<CostManager>>, usage: CostUsage) -> SpawnDecision {
    manager.can_spawn(&usage)
}
