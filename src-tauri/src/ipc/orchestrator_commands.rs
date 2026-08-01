use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use super::event_commands::publish_and_emit;
use crate::context_store::ContextStoreManager;
use crate::control::loop_ports::{
    freeze_and_test_mission_candidate, revalidate_mission_candidate, run_step_visible, PANE_COLS,
    PANE_ROWS,
};
use crate::control::pane_fleet::PaneFleet;
use crate::cost::{CostManager, CostUsage};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::file_ownership::FileOwnership;
use crate::orchestrator::autonomy::StepReport;
use crate::orchestrator::{plan, DispatchPlan};
use crate::pty::PtyManager;
use crate::review::{GateResults, MissionReviewRecord, MissionReviewVerdict};
use crate::startup_reconciliation::StartupReconciliationState;
use crate::symbol_ownership::SymbolOwnership;
use crate::task::{MissionGateEvidence, MissionPlanActivation, TaskManager};
use crate::term::NativeTerminalRegistry;

fn mission_now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .map_err(|error| format!("system clock before unix epoch: {error}"))
}

fn mission_now_secs() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("system clock before unix epoch: {error}"))
}

/// The orchestrator's next scheduling decision for the live task graph: which
/// tasks to dispatch now (priority-ordered, concurrency-capped against the
/// caller-supplied `usage`) and where the autonomy loop stands
/// (`active`/`complete`/`stalled`/`halted_by_budget`).
///
/// Read-only and side-effect free — it drives the cockpit's loop view and lets
/// the orchestrator AI inspect the plan before dispatching. The actual
/// dispatch/review/merge pass is `orchestrator_step` below.
#[tauri::command]
pub fn orchestrator_plan(
    tasks: State<'_, Arc<TaskManager>>,
    cost: State<'_, Arc<CostManager>>,
    usage: CostUsage,
) -> DispatchPlan {
    let caps = cost.caps();
    tasks.read(|graph| plan(graph, &caps, &usage))
}

/// Drive one autonomy step over the live Task Graph (BR9): resolve reviews with
/// the caller-supplied gate verdicts into a real git merge, move finished agents
/// (PTY exit) `Running -> Review`, and dispatch ready tasks by spawning each in a
/// **visible PTY pane** (1 pane = 1 agent) routed to its owner's model. The loop
/// logic lives in `control::loop_ports::run_step_visible`; this command adds the
/// cockpit-side broadcasts: `task-graph-updated`, `orchestrator-step`, and a
/// `TaskCompleted` event per merged task. (The MCP face keeps the headless
/// `run_step`.)
// Six of the arguments are injected Tauri state (app/tasks/cost/fleet/bus/...);
// only `usage`/`repo_path`/`reviewer_id`/`gates` are the caller's.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn orchestrator_step(
    app: AppHandle,
    tasks: State<'_, Arc<TaskManager>>,
    startup: State<'_, Arc<StartupReconciliationState>>,
    cost: State<'_, Arc<CostManager>>,
    fleet: State<'_, PaneFleet>,
    bus: State<'_, Arc<EventBus>>,
    ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    symbol_ownership: State<'_, Arc<Mutex<SymbolOwnership>>>,
    context: State<'_, Arc<ContextStoreManager>>,
    merge_store: State<'_, Option<Arc<crate::merge_intent::store::MergeIntentStore>>>,
    usage: CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: HashMap<String, GateResults>,
) -> Result<StepReport, String> {
    let event_repo_path = repo_path.clone();
    let report = run_step_visible(
        &startup,
        &tasks,
        &cost,
        &fleet,
        &ownership,
        Some(symbol_ownership.inner().clone()),
        &bus,
        &context,
        &usage,
        repo_path,
        reviewer_id,
        gates,
        // The cockpit face supplies reviewer verdicts directly; mechanical gate
        // commands are an MCP-face (autonomous) opt-in.
        None,
        merge_store.inner().clone(),
        // P4 (Supervisor 実体): the loop driver durably records every give-up (a
        // retry budget exhausted -> Failed) to the audit journal, so a Failed
        // task survives restart instead of living only in the volatile Event Bus
        // ring. ManagedDb is always managed (file, or in-memory fallback).
        Some(app.state::<crate::db::ManagedDb>().inner()),
        None,
    )?;
    // Make each freshly dispatched agent visible: the loop spawned its PTY
    // through PaneFleet; connect that terminal to the frontend (native engine +
    // render monitor) and announce it as `AgentSpawned` so the cockpit fleet
    // grid mounts a live pane per agent (1 pane = 1 agent). Errors here only
    // affect the picture, never the loop's own completion/recovery.
    if !report.dispatched.is_empty() {
        let pty = app.state::<PtyManager>().inner().clone();
        let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
        for task_id in &report.dispatched {
            let Some(terminal_id) = fleet.terminal_of(task_id) else {
                continue;
            };
            let model = tasks
                .read(|graph| graph.get(task_id).and_then(|task| task.agent_model()))
                .unwrap_or_else(|| "sonnet".to_string());
            super::interactive_commands::spawn_loop_pane_render(
                &app,
                &pty,
                native_registry.clone(),
                terminal_id.clone(),
                PANE_COLS,
                PANE_ROWS,
            );
            publish_and_emit(
                &app,
                &bus,
                AgentEvent::new(
                    AgentEventKind::AgentSpawned,
                    json!({
                        "taskId": task_id,
                        "terminalId": terminal_id,
                        "model": model,
                        "repoPath": &event_repo_path,
                    }),
                ),
            )?;
        }
    }

    let _ = app.emit("task-graph-updated", tasks.list());
    let _ = app.emit("orchestrator-step", &report);
    for id in &report.merged {
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(AgentEventKind::TaskCompleted, json!({ "id": id })),
        )?;
    }
    Ok(report)
}

/// One explicit A7.2 control-plane tick. The caller selects only the immutable
/// accepted plan revision; repository, branch, role, owned target, gate argv,
/// and execution actor/generation are derived by backend owners. The route
/// dispatches one visible implementer, then on a later tick freezes and tests
/// its owned diff. It never invokes independent review, acceptance, merge, or
/// packet settlement (A7.3+).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanRunReport {
    pub activation: MissionPlanActivation,
    pub step: StepReport,
    pub gate_evidence: Option<MissionGateEvidence>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn mission_plan_run(
    app: AppHandle,
    tasks: State<'_, Arc<TaskManager>>,
    startup: State<'_, Arc<StartupReconciliationState>>,
    cost: State<'_, Arc<CostManager>>,
    fleet: State<'_, PaneFleet>,
    bus: State<'_, Arc<EventBus>>,
    ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    symbol_ownership: State<'_, Arc<Mutex<SymbolOwnership>>>,
    context: State<'_, Arc<ContextStoreManager>>,
    plan_id: String,
    plan_revision: u64,
) -> Result<MissionPlanRunReport, String> {
    let activation = tasks
        .activate_mission_plan(&plan_id, plan_revision)
        .map_err(|error| error.to_string())?;
    let mut report = run_step_visible(
        &startup,
        &tasks,
        &cost,
        &fleet,
        &ownership,
        Some(symbol_ownership.inner().clone()),
        &bus,
        &context,
        &CostUsage::default(),
        activation.repository_root.clone(),
        // The generic loop checks separation before touching its gate/review/
        // merge ports. Matching the immutable implementer role keeps the task
        // waiting at Review, where the A7.2 exact candidate path takes over.
        "implementer".into(),
        HashMap::new(),
        None,
        None,
        Some(app.state::<crate::db::ManagedDb>().inner()),
        Some(&activation.task_id),
    )?;
    // The generic loop reports a same-role reviewer as `rejected` while leaving
    // the task untouched at Review. In this typed route that is the intentional
    // pre-review stop, not a rejected implementation; A7.3 supplies the first
    // independent reviewer later.
    report
        .rejected
        .retain(|task_id| task_id != &activation.task_id);

    if report.dispatched == [activation.task_id.clone()] {
        let terminal_id = fleet
            .terminal_of(&activation.task_id)
            .ok_or_else(|| "visible Mission dispatch has no PTY binding".to_string())?;
        let pty = app.state::<PtyManager>().inner().clone();
        let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
        super::interactive_commands::spawn_loop_pane_render(
            &app,
            &pty,
            native_registry,
            terminal_id.clone(),
            PANE_COLS,
            PANE_ROWS,
        );
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(
                AgentEventKind::AgentSpawned,
                json!({
                    "taskId": activation.task_id,
                    "terminalId": terminal_id,
                    "model": tasks
                        .get(&activation.task_id)
                        .and_then(|task| task.agent_model())
                        .unwrap_or_else(|| "sonnet".into()),
                    "repoPath": activation.repository_root,
                    "missionId": activation.mission_id,
                    "workUnitId": activation.work_unit_id,
                    "activationId": activation.activation_id,
                }),
            ),
        )?;
    }

    let gate_evidence = freeze_and_test_mission_candidate(&tasks, &activation)?;
    let _ = app.emit("task-graph-updated", tasks.list());
    let _ = app.emit("orchestrator-step", &report);
    Ok(MissionPlanRunReport {
        activation,
        step: report,
        gate_evidence,
    })
}

/// A7.3 exact-OID acceptance. The caller selects only the accepted plan
/// revision. Reviewer identity/session/lineage, model, evidence, repository,
/// branches, OIDs, clauses, and merge authority are all backend-derived.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReviewAcceptanceReport {
    pub activation: MissionPlanActivation,
    pub gate_evidence: MissionGateEvidence,
    pub review: MissionReviewRecord,
    pub merge_binding: Option<crate::merge_intent::MissionMergeBinding>,
    pub merge_receipt: Option<crate::merge_intent::MissionMergeReceipt>,
    pub status: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum A7AcceptanceCrashPoint {
    AfterReviewRecord,
    AfterBinding,
    AfterReviewCommit,
    AfterMergeReserve,
    AfterMergeStart,
    AfterIntentMerged,
    AfterReceipt,
}

fn inject_a7_crash(
    configured: Option<A7AcceptanceCrashPoint>,
    point: A7AcceptanceCrashPoint,
) -> Result<(), String> {
    if configured == Some(point) {
        Err(format!("injected A7.3 crash after {point:?}"))
    } else {
        Ok(())
    }
}

fn quarantine_execution(
    tasks: &TaskManager,
    token: &crate::task::ExecutionToken,
    reason: impl Into<String>,
) -> String {
    let reason = reason.into();
    match tasks.mark_execution_needs_reconcile(
        token,
        &reason,
        mission_now_secs().unwrap_or_default(),
    ) {
        Ok(_) => reason,
        Err(error) => format!("{reason}; additionally failed to persist NeedsReconcile: {error}"),
    }
}

fn fail_closed_current_execution(
    tasks: &TaskManager,
    task_id: &str,
    reason: impl Into<String>,
) -> String {
    let reason = reason.into();
    match tasks.current_execution(task_id) {
        Some(current) if current.fence.state == crate::task::ExecutionFenceState::EffectStarted => {
            quarantine_execution(tasks, &current.token(), reason)
        }
        _ => reason,
    }
}

fn canonical_path_eq(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        std::fs::canonicalize(value).ok().map(|path| {
            path.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_ascii_lowercase()
        })
    };
    matches!((normalize(left), normalize(right)), (Some(left), Some(right)) if left == right)
}

fn validate_a7_intent(
    intent: &crate::merge_intent::MergeIntent,
    activation: &MissionPlanActivation,
    review: &MissionReviewRecord,
) -> Result<(), String> {
    use crate::merge_intent::MergeIntentState;
    if !canonical_path_eq(&intent.repo_path, &activation.repository_root)
        || intent.source_branch != activation.source_branch
        || intent.target_branch != activation.target_branch
        || intent.task_id != activation.work_unit_id
        || intent.source_oid != review.reviewed_oid
        || intent.target_oid != activation.accepted_base_oid
        || intent.merge_base_oid.as_deref() != Some(activation.accepted_base_oid.as_str())
        || intent.session_id.as_deref()
            != Some(
                review
                    .reviewer_independence
                    .reviewer_logical_session_id
                    .as_str(),
            )
        || !matches!(
            intent.state,
            MergeIntentState::Queued
                | MergeIntentState::ReadyToMerge
                | MergeIntentState::Merging
                | MergeIntentState::Merged
        )
        || intent
            .reviewer_id
            .as_deref()
            .is_some_and(|value| value != review.reviewer_independence.reviewer_principal_id)
        || intent
            .gates_digest
            .as_deref()
            .is_some_and(|value| value != review.review_digest)
    {
        return Err(
            "durable merge intent collides with the canonical A7 activation tuple".to_string(),
        );
    }
    Ok(())
}

fn validate_a7_review_binding(
    activation: &MissionPlanActivation,
    evidence: &MissionGateEvidence,
    review: &MissionReviewRecord,
) -> Result<(), String> {
    crate::review::mission::validate_mission_review_record(review)?;
    if review.activation_id != activation.activation_id
        || review.mission_id != activation.mission_id
        || review.mission_revision != activation.mission_revision
        || review.work_unit_id != activation.work_unit_id
        || review.plan_content_digest != activation.plan_content_digest
        || review.tested_evidence_id != evidence.evidence_id
        || review.reviewed_oid != evidence.tested_oid
        || review.reviewer_independence.builder_principal_id != evidence.agent_run_id
        || review.reviewer_independence.builder_logical_session_id != evidence.pty_session_id
        || review.reviewer_independence.builder_invocation_id != evidence.attempt_id
    {
        return Err(
            "durable Mission review does not bind the exact activation/evidence".to_string(),
        );
    }
    Ok(())
}

fn settle_a7_review_acceptance(
    tasks: &TaskManager,
    merge_store: &crate::merge_intent::store::MergeIntentStore,
    activation: MissionPlanActivation,
    gate_evidence: MissionGateEvidence,
    review: MissionReviewRecord,
    crash: Option<A7AcceptanceCrashPoint>,
) -> Result<MissionReviewAcceptanceReport, String> {
    use crate::merge_intent::MergeIntentState;
    use crate::task::{ExecutionEffect, ExecutionFenceState, WorkExecutionState};

    validate_a7_review_binding(&activation, &gate_evidence, &review)?;
    inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterReviewRecord)?;
    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission acceptance execution attempt is missing".to_string())?;
    let token = current.token();

    if review.verdict != MissionReviewVerdict::AcceptedExactOid {
        let current = tasks
            .current_execution(&activation.task_id)
            .ok_or_else(|| "Mission rejected-review execution attempt is missing".to_string())?;
        if current.state == WorkExecutionState::Failed
            && current.fence.effect == ExecutionEffect::Review
            && current.fence.state == ExecutionFenceState::Committed
        {
            return Ok(MissionReviewAcceptanceReport {
                activation,
                gate_evidence,
                status: review.verdict.as_str().to_string(),
                next_action: review.next_action.clone(),
                review,
                merge_binding: None,
                merge_receipt: None,
            });
        }
        if current.fence.effect == ExecutionEffect::Review
            && current.fence.state == ExecutionFenceState::EffectStarted
        {
            tasks
                .commit_execution_effect(&token, ExecutionEffect::Review, mission_now_secs()?)
                .map_err(|error| quarantine_execution(tasks, &token, error.to_string()))?;
        }
        let current = tasks
            .current_execution(&activation.task_id)
            .ok_or_else(|| "Mission rejected-review commit vanished".to_string())?;
        if current.fence.effect != ExecutionEffect::Review
            || current.fence.state != ExecutionFenceState::Committed
        {
            return Err(quarantine_execution(
                tasks,
                &current.token(),
                "changes_requested review is not durably Review/Committed",
            ));
        }
        tasks
            .fail_execution(&current.token(), &review.next_action, mission_now_secs()?)
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
        return Ok(MissionReviewAcceptanceReport {
            activation,
            gate_evidence,
            status: review.verdict.as_str().to_string(),
            next_action: review.next_action.clone(),
            review,
            merge_binding: None,
            merge_receipt: None,
        });
    }

    let existing_binding = merge_store
        .mission_binding_for_activation(&activation.activation_id)
        .map_err(|error| quarantine_execution(tasks, &token, error))?;
    let (intent, binding) = if let Some(binding) = existing_binding {
        let intent = merge_store
            .get(&binding.intent_id)
            .map_err(|error| quarantine_execution(tasks, &token, error))?
            .ok_or_else(|| "Mission merge binding lacks its durable intent".to_string())?;
        validate_a7_intent(&intent, &activation, &review)?;
        let expected = crate::merge_intent::MissionMergeBinding {
            intent_id: intent.intent_id.clone(),
            activation_id: activation.activation_id.clone(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            tested_evidence_id: gate_evidence.evidence_id.clone(),
            review_id: review.review_id.clone(),
            reviewer_independence_digest: review.reviewer_independence.digest.clone(),
            source_oid: review.reviewed_oid.clone(),
            target_oid: activation.accepted_base_oid.clone(),
            created_at_unix_ms: binding.created_at_unix_ms,
        };
        if binding != expected {
            return Err(quarantine_execution(
                tasks,
                &token,
                "Mission merge binding disagrees with review/activation authority",
            ));
        }
        (intent, binding)
    } else {
        crate::git::ensure_isolated_branch_at_oid(
            &activation.repository_root,
            &activation.target_branch,
            &activation.accepted_base_oid,
        )
        .map_err(|error| quarantine_execution(tasks, &token, error))?;
        let now_secs = mission_now_secs()?;
        let intent = crate::control::merge::request_durable_intent(
            merge_store,
            &activation.repository_root,
            &activation.work_unit_id,
            Some(&review.reviewer_independence.reviewer_logical_session_id),
            &activation.source_branch,
            &activation.target_branch,
            i64::try_from(now_secs).map_err(|_| "merge time exceeds i64".to_string())?,
        )
        .map_err(|error| quarantine_execution(tasks, &token, error))?;
        validate_a7_intent(&intent, &activation, &review)
            .map_err(|error| quarantine_execution(tasks, &token, error))?;
        let binding = merge_store
            .bind_mission(&crate::merge_intent::MissionMergeBinding {
                intent_id: intent.intent_id.clone(),
                activation_id: activation.activation_id.clone(),
                mission_id: activation.mission_id.clone(),
                mission_revision: activation.mission_revision,
                work_unit_id: activation.work_unit_id.clone(),
                tested_evidence_id: gate_evidence.evidence_id.clone(),
                review_id: review.review_id.clone(),
                reviewer_independence_digest: review.reviewer_independence.digest.clone(),
                source_oid: intent.source_oid.clone(),
                target_oid: intent.target_oid.clone(),
                created_at_unix_ms: review.created_at_unix_ms,
            })
            .map_err(|error| quarantine_execution(tasks, &token, error))?;
        (intent, binding)
    };
    inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterBinding)?;

    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission execution vanished after binding".to_string())?;
    if current.fence.effect == ExecutionEffect::Review
        && current.fence.state == ExecutionFenceState::EffectStarted
    {
        tasks
            .commit_execution_effect(
                &current.token(),
                ExecutionEffect::Review,
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
    }
    inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterReviewCommit)?;

    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission execution vanished after Review commit".to_string())?;
    if current.fence.effect == ExecutionEffect::Review
        && current.fence.state == ExecutionFenceState::Committed
    {
        tasks
            .reserve_execution_effect(
                &current.token(),
                ExecutionEffect::CandidateFreeze,
                None,
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
    }
    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission CandidateFreeze reservation vanished".to_string())?;
    if current.fence.effect == ExecutionEffect::CandidateFreeze
        && current.fence.state == ExecutionFenceState::Reserved
    {
        tasks
            .commit_execution_effect(
                &current.token(),
                ExecutionEffect::CandidateFreeze,
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
    }

    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission execution vanished before Merge".to_string())?;
    if current.fence.effect == ExecutionEffect::CandidateFreeze
        && current.fence.state == ExecutionFenceState::Committed
    {
        tasks
            .reserve_execution_effect(
                &current.token(),
                ExecutionEffect::Merge,
                Some(&intent.intent_id),
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
        inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterMergeReserve)?;
    }
    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission Merge reservation vanished".to_string())?;
    if current.fence.effect == ExecutionEffect::Merge
        && current.fence.state == ExecutionFenceState::Reserved
    {
        tasks
            .start_execution_effect(
                &current.token(),
                ExecutionEffect::Merge,
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
        inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterMergeStart)?;
    }

    let merge_token = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission Merge execution vanished".to_string())?
        .token();
    let mut intent = merge_store
        .get(&intent.intent_id)
        .map_err(|error| quarantine_execution(tasks, &merge_token, error))?
        .ok_or_else(|| "Mission merge intent vanished".to_string())?;
    validate_a7_intent(&intent, &activation, &review)
        .map_err(|error| quarantine_execution(tasks, &merge_token, error))?;
    if intent.state == MergeIntentState::Merging {
        intent = merge_store
            .reconcile_one_dangling(
                &intent.intent_id,
                i64::try_from(mission_now_secs()?)
                    .map_err(|_| "merge time exceeds i64".to_string())?,
            )
            .map_err(|error| quarantine_execution(tasks, &merge_token, error))?;
    }
    if matches!(
        intent.state,
        MergeIntentState::Queued | MergeIntentState::ReadyToMerge
    ) {
        crate::control::merge::approve_durable_intent(
            merge_store,
            &intent.intent_id,
            &review.reviewer_independence.reviewer_principal_id,
            Some(&review.review_digest),
            i64::try_from(mission_now_secs()?).map_err(|_| "merge time exceeds i64".to_string())?,
        )
        .map_err(|error| quarantine_execution(tasks, &merge_token, error.to_string()))?;
        intent = merge_store
            .get(&intent.intent_id)
            .map_err(|error| quarantine_execution(tasks, &merge_token, error))?
            .ok_or_else(|| "Mission merge intent vanished after execution".to_string())?;
    }
    if intent.state != MergeIntentState::Merged
        || intent.reviewer_id.as_deref()
            != Some(review.reviewer_independence.reviewer_principal_id.as_str())
        || intent.gates_digest.as_deref() != Some(review.review_digest.as_str())
    {
        return Err(quarantine_execution(
            tasks,
            &merge_token,
            "Mission exact-OID intent is not durably merged with its review approval",
        ));
    }
    let integrated_oid =
        crate::git::resolve_branch_oid(&activation.repository_root, &activation.target_branch)
            .map_err(|error| quarantine_execution(tasks, &merge_token, error))?;
    if integrated_oid != review.reviewed_oid {
        return Err(quarantine_execution(
            tasks,
            &merge_token,
            "isolated target does not resolve to the exact reviewed OID",
        ));
    }
    inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterIntentMerged)?;

    let receipt = if let Some(receipt) = merge_store
        .mission_receipt(&intent.intent_id)
        .map_err(|error| quarantine_execution(tasks, &merge_token, error))?
    {
        if receipt.integrated_oid != review.reviewed_oid
            || receipt.merge_result != "merged_exact_oid"
        {
            return Err(quarantine_execution(
                tasks,
                &merge_token,
                "Mission merge receipt disagrees with the reviewed OID",
            ));
        }
        receipt
    } else {
        merge_store
            .record_mission_receipt(&crate::merge_intent::MissionMergeReceipt {
                receipt_id: uuid::Uuid::now_v7().to_string(),
                intent_id: intent.intent_id.clone(),
                integrated_oid,
                merge_result: "merged_exact_oid".to_string(),
                created_at_unix_ms: mission_now_ms()?,
            })
            .map_err(|error| quarantine_execution(tasks, &merge_token, error))?
    };
    inject_a7_crash(crash, A7AcceptanceCrashPoint::AfterReceipt)?;

    let current = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission Merge execution vanished before commit".to_string())?;
    if current.fence.effect == ExecutionEffect::Merge
        && current.fence.state == ExecutionFenceState::EffectStarted
    {
        tasks
            .commit_execution_effect(
                &current.token(),
                ExecutionEffect::Merge,
                mission_now_secs()?,
            )
            .map_err(|error| quarantine_execution(tasks, &current.token(), error.to_string()))?;
    }
    let settled = tasks
        .current_execution(&activation.task_id)
        .ok_or_else(|| "Mission Merge settlement vanished".to_string())?;
    if settled.state != WorkExecutionState::MergeReady
        || settled.fence.effect != ExecutionEffect::Merge
        || settled.fence.state != ExecutionFenceState::Committed
        || settled.merge_intent_id.as_deref() != Some(intent.intent_id.as_str())
    {
        return Err(quarantine_execution(
            tasks,
            &settled.token(),
            "Mission merge receipt exists but task fence is not MergeReady/Committed",
        ));
    }
    Ok(MissionReviewAcceptanceReport {
        activation,
        gate_evidence,
        review,
        merge_binding: Some(binding),
        merge_receipt: Some(receipt),
        status: "merged_exact_oid".to_string(),
        next_action: "A7.4 may consume this immutable acceptance chain for completion settlement."
            .to_string(),
    })
}

#[tauri::command]
pub async fn mission_plan_review_accept(
    tasks: State<'_, Arc<TaskManager>>,
    database: State<'_, crate::db::ManagedDb>,
    merge_store: State<'_, Option<Arc<crate::merge_intent::store::MergeIntentStore>>>,
    plan_id: String,
    plan_revision: u64,
) -> Result<MissionReviewAcceptanceReport, String> {
    let tasks = tasks.inner().clone();
    let database = database.inner().clone();
    let merge_store = merge_store
        .inner()
        .clone()
        .ok_or_else(|| "Mission exact-OID merge durability is unavailable".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let activation = tasks
            .mission_activation(&plan_id, plan_revision)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "accepted Mission plan is not activated".to_string())?;
        let preview = tasks
            .mission_plan(&plan_id, plan_revision)
            .map_err(|error| error.to_string())?;
        if preview.status != crate::task::MissionPlanStatus::Accepted
            || preview.content_digest != activation.plan_content_digest
        {
            return Err("Mission acceptance contract changed after activation".to_string());
        }

        // Resume from immutable IDs, never from whichever review/evidence happens
        // to be latest. A binding is the authority selector once it exists.
        let binding = merge_store
            .mission_binding_for_activation(&activation.activation_id)
            .map_err(|error| fail_closed_current_execution(&tasks, &activation.task_id, error))?;
        let existing_review = if let Some(binding) = &binding {
            Some(
                database
                    .with(|db| {
                        crate::persistence::ReviewRepo::mission_review_by_id(db, &binding.review_id)
                    })
                    .map_err(|error| {
                        fail_closed_current_execution(&tasks, &activation.task_id, error)
                    })?
                    .ok_or_else(|| "Mission binding lacks its exact review record".to_string())?,
            )
        } else {
            database
                .with(|db| {
                    crate::persistence::ReviewRepo::latest_for_activation(
                        db,
                        &activation.activation_id,
                    )
                })
                .map_err(|error| {
                    fail_closed_current_execution(&tasks, &activation.task_id, error)
                })?
        };
        if let Some(review) = existing_review {
            let gate_evidence = tasks
                .mission_gate_evidence_by_id(&review.tested_evidence_id)
                .map_err(|error| {
                    fail_closed_current_execution(&tasks, &activation.task_id, error.to_string())
                })?
                .ok_or_else(|| "Mission review lacks its exact gate evidence".to_string())?;
            return settle_a7_review_acceptance(
                &tasks,
                &merge_store,
                activation,
                gate_evidence,
                review,
                None,
            );
        }

        let gate_evidence = revalidate_mission_candidate(&tasks, &activation)?;
        let snapshot = crate::git::inspect_exact_owned_candidate(
            &activation.repository_root,
            &activation.source_branch,
            &activation.accepted_base_oid,
            &gate_evidence.tested_oid,
            &activation.owned_targets,
            crate::review::judge::MAX_DIFF_CHARS,
        )?;
        let attempt = tasks
            .current_execution(&activation.task_id)
            .ok_or_else(|| "Mission review execution attempt is missing".to_string())?;
        let token = attempt.token();
        tasks
            .start_execution_effect(
                &token,
                crate::task::ExecutionEffect::Review,
                mission_now_secs()?,
            )
            .map_err(|error| error.to_string())?;

        let builder_adapter = tasks
            .get(&activation.task_id)
            .and_then(|task| task.model.clone())
            .ok_or_else(|| {
                quarantine_execution(&tasks, &token, "Mission builder adapter fact is missing")
            })?;
        let builder =
            crate::review::mission::builder_runtime_attestation(&gate_evidence, &builder_adapter)
                .map_err(|error| quarantine_execution(&tasks, &token, error))?;
        let reviewer_prompt = crate::review::mission::build_review_prompt(
            &preview,
            &gate_evidence,
            &snapshot.changed_paths,
            &snapshot.diff,
        );
        let invocation = crate::agent::codex_a7_review_oneshot(&reviewer_prompt)
            .map_err(|error| quarantine_execution(&tasks, &token, error))?;
        if let Err(error) = database.with(|db| {
            crate::persistence::ReviewRepo::insert_reviewer_invocation_receipt(
                db,
                invocation.receipt(),
            )
        }) {
            return Err(quarantine_execution(&tasks, &token, error));
        }
        let reviewed_at_ms =
            mission_now_ms().map_err(|error| quarantine_execution(&tasks, &token, error))?;
        let review = match crate::review::review_exact_candidate(
            &preview,
            &activation,
            &gate_evidence,
            &snapshot.changed_paths,
            &snapshot.diff,
            reviewed_at_ms,
            &builder,
            false,
            &invocation,
        ) {
            Ok(record) => record,
            Err(error) => {
                return Err(quarantine_execution(&tasks, &token, error));
            }
        };

        let after_review = match crate::git::inspect_exact_owned_candidate(
            &activation.repository_root,
            &activation.source_branch,
            &activation.accepted_base_oid,
            &gate_evidence.tested_oid,
            &activation.owned_targets,
            crate::review::judge::MAX_DIFF_CHARS,
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return Err(quarantine_execution(&tasks, &token, error));
            }
        };
        let age_ms = mission_now_ms()
            .map_err(|error| quarantine_execution(&tasks, &token, error))?
            .saturating_sub(gate_evidence.ended_at_unix_ms);
        if after_review != snapshot || age_ms > crate::review::mission::REVIEW_EVIDENCE_MAX_AGE_MS {
            let reason = "Mission candidate or fresh test evidence became stale during review";
            return Err(quarantine_execution(&tasks, &token, reason));
        }
        if let Err(error) =
            database.with(|db| crate::persistence::ReviewRepo::insert_mission_review(db, &review))
        {
            return Err(quarantine_execution(&tasks, &token, error));
        }
        settle_a7_review_acceptance(
            &tasks,
            &merge_store,
            activation,
            gate_evidence,
            review,
            None,
        )
    })
    .await
    .map_err(|error| format!("Mission reviewer task join error: {error}"))?
}

#[cfg(test)]
mod a7_3_ipc_tests {
    use super::*;
    use crate::db::{Database, ManagedDb};
    use crate::merge_intent::store::MergeIntentStore;
    use crate::task::{
        ExecutionEffect, ExecutionFenceState, ExecutionReservation, ExecutionRuntime,
        WorkExecutionState,
    };

    struct Fixture {
        _repo: tempfile::TempDir,
        db: Arc<ManagedDb>,
        tasks: TaskManager,
        merge_store: MergeIntentStore,
        activation: MissionPlanActivation,
        evidence: MissionGateEvidence,
        review: MissionReviewRecord,
    }

    fn commit_tree(
        repo: &git2::Repository,
        update_ref: &str,
        message: &str,
        parent: Option<git2::Oid>,
    ) -> git2::Oid {
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("A7 IPC", "a7-ipc@example.invalid").unwrap();
        let parent_commit = parent.map(|oid| repo.find_commit(oid).unwrap());
        let parents = parent_commit.iter().collect::<Vec<_>>();
        repo.commit(
            Some(update_ref),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .unwrap()
    }

    fn bind_input(input: &mut crate::task::mission::MissionPlanPreviewInput, oid: &str) {
        input.mission_definition.base_oid = oid.to_string();
        for work in &mut input.work_units {
            for intent in &mut work.file_intents {
                intent.resource_ref.base_oid = oid.to_string();
                intent.resource_ref.head_oid = oid.to_string();
            }
        }
    }

    fn reviewer_invocation(response: String) -> crate::review::ReviewerInvocation {
        crate::review::ReviewerInvocation::test_only(&response)
    }

    fn fixture(accepted: bool) -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(directory.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        std::fs::create_dir_all(directory.path().join("src-tauri/src/task")).unwrap();
        std::fs::write(
            directory.path().join("src-tauri/src/task/graph.rs"),
            "// base\n",
        )
        .unwrap();
        repo.index()
            .unwrap()
            .add_path(std::path::Path::new("src-tauri/src/task/graph.rs"))
            .unwrap();
        {
            let mut index = repo.index().unwrap();
            index
                .add_path(std::path::Path::new("src-tauri/src/task/graph.rs"))
                .unwrap();
            index.write().unwrap();
        }
        let base = commit_tree(&repo, "HEAD", "base", None);
        let mut input = crate::task::mission::tests::fixed_input();
        bind_input(&mut input, &base.to_string());
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = TaskManager::new_durable();
        tasks.attach_db(db.clone()).unwrap();
        tasks
            .preview_mission_plan(input, &directory.path().to_string_lossy())
            .unwrap();
        tasks.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        let activation = tasks.activate_mission_plan(&plan_id, 1).unwrap();
        let candidate = commit_tree(
            &repo,
            &format!("refs/heads/{}", activation.source_branch),
            "candidate",
            Some(base),
        );
        let attempt = tasks
            .reserve_execution(ExecutionReservation {
                task_id: activation.task_id.clone(),
                repo_path: activation.repository_root.clone(),
                runtime: ExecutionRuntime::VisiblePty,
                ownership_claim_ids: vec!["claim-a7-ipc".into()],
                now: 10,
            })
            .unwrap();
        tasks
            .commit_execution_reservation(&attempt.token(), 11)
            .unwrap();
        let mut now = 12;
        for effect in [ExecutionEffect::FirstEffect, ExecutionEffect::Spawn] {
            tasks
                .reserve_execution_effect(&attempt.token(), effect, None, now)
                .unwrap();
            now += 1;
            tasks
                .start_execution_effect(&attempt.token(), effect, now)
                .unwrap();
            now += 1;
            tasks
                .commit_execution_effect(&attempt.token(), effect, now)
                .unwrap();
            now += 1;
        }
        tasks
            .reserve_execution_effect(&attempt.token(), ExecutionEffect::Review, None, now)
            .unwrap();
        let current = tasks.current_execution(&activation.task_id).unwrap();
        let evidence = MissionGateEvidence {
            schema: "aelyris.mission_gate_evidence/v1".into(),
            evidence_id: uuid::Uuid::now_v7().to_string(),
            activation_id: activation.activation_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            attempt_id: current.identity.attempt_id.clone(),
            execution_generation: current.identity.execution_generation,
            agent_run_id: current.identity.agent_run_id.clone(),
            runtime_domain_id: "visible_pty".into(),
            pty_session_id: current.identity.pty_session_id.clone().unwrap(),
            gate_id: crate::task::A7_FIXTURE_GATE_ID.into(),
            contract_version: "1".into(),
            command_argv: activation.test_argv.clone(),
            command_fingerprint: "c".repeat(64),
            environment_fingerprint: "d".repeat(64),
            result: "passed".into(),
            evidence_digest: "e".repeat(64),
            base_oid: base.to_string(),
            candidate_oid: candidate.to_string(),
            tested_oid: candidate.to_string(),
            started_at_unix_ms: 20,
            ended_at_unix_ms: 21,
        };
        tasks
            .persist_mission_gate_evidence(&activation, &evidence)
            .unwrap();
        tasks
            .start_execution_effect(&attempt.token(), ExecutionEffect::Review, 30)
            .unwrap();
        let preview = tasks.mission_plan(&plan_id, 1).unwrap();
        let coverage = preview
            .mission_definition
            .acceptance
            .iter()
            .map(|clause| {
                serde_json::json!({
                    "clauseId": clause.clause_id,
                    "accepted": accepted,
                    "reason": if accepted { "exact reviewed OID" } else { "required correction" }
                })
            })
            .collect::<Vec<_>>();
        let findings = if accepted {
            vec![]
        } else {
            vec![serde_json::json!({
                "clauseId": preview.mission_definition.acceptance[0].clause_id,
                "message": "exact finding from reviewer"
            })]
        };
        let response = serde_json::json!({
            "clauseCoverage": coverage,
            "findings": findings
        })
        .to_string();
        let builder =
            crate::review::mission::builder_runtime_attestation(&evidence, "codex-no-hooks")
                .unwrap();
        let invocation = reviewer_invocation(response);
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_reviewer_invocation_receipt(
                database,
                invocation.receipt(),
            )
            .map(|_| ())
        })
        .unwrap();
        let review = crate::review::review_exact_candidate(
            &preview,
            &activation,
            &evidence,
            &activation.owned_targets,
            "+ exact candidate",
            30,
            &builder,
            false,
            &invocation,
        )
        .unwrap();
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_mission_review(database, &review).map(|_| ())
        })
        .unwrap();
        let merge_store = MergeIntentStore::new(db.clone());
        Fixture {
            _repo: directory,
            db,
            tasks,
            merge_store,
            activation,
            evidence,
            review,
        }
    }

    #[test]
    fn a7_3_ipc_changes_requested_commits_review_then_fails_with_exact_findings() {
        let fixture = fixture(false);
        let report = settle_a7_review_acceptance(
            &fixture.tasks,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            None,
        )
        .unwrap();
        assert_eq!(report.status, "changes_requested");
        assert_eq!(
            report.review.findings[0].message,
            "exact finding from reviewer"
        );
        let current = fixture
            .tasks
            .current_execution(&fixture.activation.task_id)
            .unwrap();
        assert_eq!(current.state, WorkExecutionState::Failed);
        assert_eq!(current.fence.effect, ExecutionEffect::Review);
        assert_eq!(current.fence.state, ExecutionFenceState::Committed);
    }

    #[test]
    fn a7_3_ipc_resumes_every_durable_crash_boundary_to_one_settled_receipt() {
        for point in [
            A7AcceptanceCrashPoint::AfterReviewRecord,
            A7AcceptanceCrashPoint::AfterBinding,
            A7AcceptanceCrashPoint::AfterReviewCommit,
            A7AcceptanceCrashPoint::AfterMergeReserve,
            A7AcceptanceCrashPoint::AfterMergeStart,
            A7AcceptanceCrashPoint::AfterIntentMerged,
            A7AcceptanceCrashPoint::AfterReceipt,
        ] {
            let fixture = fixture(true);
            let error = settle_a7_review_acceptance(
                &fixture.tasks,
                &fixture.merge_store,
                fixture.activation.clone(),
                fixture.evidence.clone(),
                fixture.review.clone(),
                Some(point),
            )
            .unwrap_err();
            assert!(error.contains("injected A7.3 crash"), "{point:?}: {error}");
            drop(fixture.tasks);
            let restored = TaskManager::new_durable();
            restored.attach_db(fixture.db.clone()).unwrap();
            let report = settle_a7_review_acceptance(
                &restored,
                &fixture.merge_store,
                fixture.activation.clone(),
                fixture.evidence.clone(),
                fixture.review.clone(),
                None,
            )
            .unwrap();
            assert_eq!(report.status, "merged_exact_oid", "{point:?}");
            let settled = restored
                .current_execution(&fixture.activation.task_id)
                .unwrap();
            assert_eq!(settled.state, WorkExecutionState::MergeReady);
            assert_eq!(settled.fence.effect, ExecutionEffect::Merge);
            assert_eq!(settled.fence.state, ExecutionFenceState::Committed);
            assert_ne!(
                restored.get(&fixture.activation.task_id).unwrap().status,
                crate::task::TaskStatus::Done
            );
        }
    }

    #[test]
    fn a7_3_retry_converges_from_merging_before_git_effect_with_unchanged_tips() {
        let fixture = fixture(true);
        settle_a7_review_acceptance(
            &fixture.tasks,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            Some(A7AcceptanceCrashPoint::AfterMergeStart),
        )
        .unwrap_err();
        let binding = fixture
            .merge_store
            .mission_binding_for_activation(&fixture.activation.activation_id)
            .unwrap()
            .unwrap();
        fixture
            .merge_store
            .record_approval(
                &binding.intent_id,
                &fixture.review.reviewer_independence.reviewer_principal_id,
                Some(&fixture.review.review_digest),
                40,
            )
            .unwrap();
        assert!(fixture
            .merge_store
            .claim_for_merge(&binding.intent_id, 41)
            .unwrap());
        let intent = fixture
            .merge_store
            .get(&binding.intent_id)
            .unwrap()
            .unwrap();
        assert_eq!(intent.state, crate::merge_intent::MergeIntentState::Merging);
        let repo = git2::Repository::open(&fixture.activation.repository_root).unwrap();
        assert_eq!(
            repo.refname_to_id(&format!("refs/heads/{}", fixture.activation.target_branch))
                .unwrap()
                .to_string(),
            fixture.activation.accepted_base_oid
        );
        assert_eq!(
            repo.refname_to_id(&format!("refs/heads/{}", fixture.activation.source_branch))
                .unwrap()
                .to_string(),
            fixture.review.reviewed_oid
        );
        drop(fixture.tasks);
        let restored = TaskManager::new_durable();
        restored.attach_db(fixture.db.clone()).unwrap();
        let report = settle_a7_review_acceptance(
            &restored,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            None,
        )
        .unwrap();
        assert_eq!(report.status, "merged_exact_oid");
        assert!(fixture
            .merge_store
            .mission_receipt(&binding.intent_id)
            .unwrap()
            .is_some());
    }

    #[test]
    fn a7_3_startup_converges_when_git_effect_landed_before_intent_and_receipt() {
        let fixture = fixture(true);
        settle_a7_review_acceptance(
            &fixture.tasks,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            Some(A7AcceptanceCrashPoint::AfterMergeStart),
        )
        .unwrap_err();
        let binding = fixture
            .merge_store
            .mission_binding_for_activation(&fixture.activation.activation_id)
            .unwrap()
            .unwrap();
        fixture
            .merge_store
            .record_approval(
                &binding.intent_id,
                &fixture.review.reviewer_independence.reviewer_principal_id,
                Some(&fixture.review.review_digest),
                40,
            )
            .unwrap();
        assert!(fixture
            .merge_store
            .claim_for_merge(&binding.intent_id, 41)
            .unwrap());
        let repo = git2::Repository::open(&fixture.activation.repository_root).unwrap();
        repo.find_reference(&format!("refs/heads/{}", fixture.activation.target_branch))
            .unwrap()
            .set_target(
                git2::Oid::from_str(&fixture.review.reviewed_oid).unwrap(),
                "A7.3 injected post-git/pre-ledger crash",
            )
            .unwrap();
        assert_eq!(
            fixture
                .merge_store
                .get(&binding.intent_id)
                .unwrap()
                .unwrap()
                .state,
            crate::merge_intent::MergeIntentState::Merging
        );
        assert!(fixture
            .merge_store
            .mission_receipt(&binding.intent_id)
            .unwrap()
            .is_none());
        drop(fixture.tasks);
        let restored = TaskManager::new_durable();
        restored.attach_db(fixture.db.clone()).unwrap();
        let report = settle_a7_review_acceptance(
            &restored,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            None,
        )
        .unwrap();
        assert_eq!(report.status, "merged_exact_oid");
        assert_eq!(
            fixture
                .merge_store
                .get(&binding.intent_id)
                .unwrap()
                .unwrap()
                .state,
            crate::merge_intent::MergeIntentState::Merged
        );
        assert_eq!(
            fixture
                .merge_store
                .mission_receipt(&binding.intent_id)
                .unwrap()
                .unwrap()
                .integrated_oid,
            fixture.review.reviewed_oid
        );
    }

    #[test]
    fn a7_3_ipc_rejects_idempotency_collision_intent_tuple() {
        let fixture = fixture(true);
        crate::git::ensure_isolated_branch_at_oid(
            &fixture.activation.repository_root,
            &fixture.activation.target_branch,
            &fixture.activation.accepted_base_oid,
        )
        .unwrap();
        let intent = crate::merge_intent::MergeIntent {
            intent_id: "collision".into(),
            repo_path: fixture.activation.repository_root.clone(),
            source_branch: "legacy-collision".into(),
            target_branch: fixture.activation.target_branch.clone(),
            source_oid: fixture.review.reviewed_oid.clone(),
            target_oid: fixture.activation.accepted_base_oid.clone(),
            merge_base_oid: Some(fixture.activation.accepted_base_oid.clone()),
            task_id: fixture.activation.work_unit_id.clone(),
            created_at: 1,
            state: crate::merge_intent::MergeIntentState::Queued,
            updated_at: 1,
            session_id: Some(
                fixture
                    .review
                    .reviewer_independence
                    .reviewer_logical_session_id
                    .clone(),
            ),
            reviewer_id: None,
            gates_digest: None,
        };
        fixture.merge_store.create_or_get(&intent).unwrap();
        let error = settle_a7_review_acceptance(
            &fixture.tasks,
            &fixture.merge_store,
            fixture.activation.clone(),
            fixture.evidence.clone(),
            fixture.review.clone(),
            None,
        )
        .unwrap_err();
        assert!(error.contains("collides"), "{error}");
    }

    #[test]
    fn a7_3_ipc_uncertain_model_or_db_failure_is_not_silently_failed() {
        let uncertain = fixture(true);
        let token = uncertain
            .tasks
            .current_execution(&uncertain.activation.task_id)
            .unwrap()
            .token();
        let message = quarantine_execution(&uncertain.tasks, &token, "model/db failure");
        assert_eq!(message, "model/db failure");
        let current = uncertain
            .tasks
            .current_execution(&uncertain.activation.task_id)
            .unwrap();
        assert_eq!(current.state, WorkExecutionState::NeedsReconcile);
        assert_eq!(current.fence.state, ExecutionFenceState::NeedsReconcile);

        let broken = fixture(true);
        let broken_token = broken
            .tasks
            .current_execution(&broken.activation.task_id)
            .unwrap()
            .token();
        broken
            .db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER test_deny_a7_reconcile
                         BEFORE UPDATE ON work_execution_attempts
                         BEGIN SELECT RAISE(ABORT, 'injected fence failure'); END;",
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let message = quarantine_execution(&broken.tasks, &broken_token, "model/db failure");
        assert!(message.contains("additionally failed to persist NeedsReconcile"));
    }

    #[test]
    fn a7_3_ipc_review_repo_rejects_digest_and_json_scalar_tamper() {
        let fixture = fixture(true);
        let mut digest_tamper = fixture.review.clone();
        digest_tamper.review_digest = "f".repeat(64);
        let error = fixture
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::insert_mission_review(database, &digest_tamper)
            })
            .unwrap_err();
        assert!(error.contains("digest"));

        fixture
            .db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "DROP TRIGGER trg_mission_review_immutable;
                         UPDATE mission_review_records
                            SET reviewer_principal_id='tampered-scalar';",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let error = fixture
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::mission_review_by_id(
                    database,
                    &fixture.review.review_id,
                )
            })
            .unwrap_err();
        assert!(error.contains("JSON/scalar"));
    }

    #[test]
    fn a7_3_ipc_rejects_forged_or_mislabeled_reviewer_receipt_and_builder_facts() {
        let missing = fixture(true);
        let mut forged = missing.review.clone();
        forged.reviewer_invocation_receipt_ref.id = uuid::Uuid::now_v7().to_string();
        forged.review_digest = crate::review::mission::canonical_review_digest(&forged).unwrap();
        let error = missing
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::insert_mission_review(database, &forged)
            })
            .unwrap_err();
        assert!(
            error.contains("no exact durable reviewer invocation receipt"),
            "{error}"
        );

        let wrong = fixture(true);
        let other = crate::review::ReviewerInvocation::test_only(
            wrong
                .db
                .with(|database| {
                    crate::persistence::ReviewRepo::reviewer_invocation_receipt_by_id(
                        database,
                        &wrong.review.reviewer_invocation_receipt_ref.id,
                    )
                })
                .unwrap()
                .unwrap()
                .canonical_response_json(),
        );
        wrong
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::insert_reviewer_invocation_receipt(
                    database,
                    other.receipt(),
                )
                .map(|_| ())
            })
            .unwrap();
        let mut wrong_binding = wrong.review.clone();
        wrong_binding.reviewer_invocation_receipt_ref = other.receipt().receipt_ref();
        wrong_binding.review_digest =
            crate::review::mission::canonical_review_digest(&wrong_binding).unwrap();
        let error = wrong
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::insert_mission_review(database, &wrong_binding)
            })
            .unwrap_err();
        assert!(error.contains("receipt binding"), "{error}");

        for column in ["provider", "model", "runtime_domain_id"] {
            let mislabeled = fixture(true);
            mislabeled
                .db
                .with(|database| {
                    database
                        .conn()
                        .execute_batch(&format!(
                            "PRAGMA ignore_check_constraints=ON;
                             DROP TRIGGER trg_mission_reviewer_invocation_receipt_immutable;
                             UPDATE mission_reviewer_invocation_receipts SET {column}='forged';"
                        ))
                        .map_err(|error| error.to_string())
                })
                .unwrap();
            let error = mislabeled
                .db
                .with(|database| {
                    crate::persistence::ReviewRepo::mission_review_by_id(
                        database,
                        &mislabeled.review.review_id,
                    )
                })
                .unwrap_err();
            assert!(
                error.contains("fixed process contract"),
                "{column}: {error}"
            );
        }

        let builder = fixture(true);
        builder
            .db
            .with(|database| {
                database
                    .conn()
                    .execute(
                        "UPDATE tasks SET model='gpt-5.6-sol' WHERE id=?1",
                        [&builder.activation.task_id],
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let error = builder
            .db
            .with(|database| {
                crate::persistence::ReviewRepo::mission_review_by_id(
                    database,
                    &builder.review.review_id,
                )
            })
            .unwrap_err();
        assert!(error.contains("builder adapter fact"), "{error}");
    }

    #[test]
    fn a7_3_restart_does_not_adopt_a_review_with_a_forged_receipt() {
        let fixture = fixture(true);
        fixture
            .db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "PRAGMA ignore_check_constraints=ON;
                         DROP TRIGGER trg_mission_reviewer_invocation_receipt_immutable;
                         UPDATE mission_reviewer_invocation_receipts SET model='forged-model';",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let restored = TaskManager::new_durable();
        let error = restored.attach_db(fixture.db.clone()).unwrap_err();
        assert!(error.contains("fixed process contract"), "{error}");
    }
}
