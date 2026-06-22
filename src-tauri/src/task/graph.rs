use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

use super::status::TaskStatus;

/// Task priority. Shares its vocabulary with the UI kanban board
/// (`src/shared/types/kanban.ts` `TaskPriority`); this enum is the
/// orchestration-side source of truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
    Critical,
}

impl TaskPriority {
    /// Canonical snake_case name, matching the serde representation. Used for
    /// persistence (the `tasks.priority` column) and stays in lockstep with the
    /// `FromStr` impl below (round-trip tested).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

impl FromStr for TaskPriority {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            "critical" => Ok(Self::Critical),
            other => Err(format!("unknown task priority: {other}")),
        }
    }
}

/// A unit of work in the Task Graph. See
/// docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 4.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: TaskStatus,
    #[serde(default)]
    pub owner: Option<String>,
    /// Which agent CLI model implements the task (e.g. claude/codex/gemini).
    /// When unset, the loop falls back to `owner` (which historically doubled as
    /// the model). `owner` stays the implementer IDENTITY for the
    /// reviewer-!=-implementer merge gate; `model` only selects the spawned CLI.
    /// See `Task::agent_model`.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub priority: TaskPriority,
    /// Optional effort estimate (caller-defined unit, e.g. minutes or points).
    #[serde(default)]
    pub estimate: Option<u32>,
    /// Ids of tasks that must reach `Done` before this one is `Ready`.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Artifacts produced by the task (file paths, branch names, ...).
    #[serde(default)]
    pub outputs: Vec<String>,
    /// Branch the task's work lives on (set when dispatched to a worktree).
    #[serde(default)]
    pub source_branch: Option<String>,
    /// Branch the task merges into once reviewed (usually `main`).
    #[serde(default)]
    pub target_branch: Option<String>,
    /// How many times this task's worker has CRASHED and been reassigned (BR9
    /// recovery). Bounded independently from rework so a transient infra crash
    /// never steals a legitimate review-rework attempt.
    #[serde(default)]
    pub crash_attempts: u32,
    /// How many times this task's branch has been REVIEW-REJECTED and re-dispatched
    /// for rework. Bounded independently from crash recovery. A task is left
    /// `Failed` once either budget is exhausted, so a poison task cannot loop
    /// forever.
    #[serde(default)]
    pub rework_attempts: u32,
    /// How many times this task's worker has TIMED OUT (hung past the wall-clock
    /// budget, killed, and reassigned). Bounded independently from crash and
    /// rework so a flaky-but-slow path cannot loop forever, and a hang escalates
    /// distinctly from a crash. See BR9 / failure policy.
    #[serde(default)]
    pub timeout_attempts: u32,
}

impl Task {
    /// A fresh task: starts `Pending`, default priority, no deps/outputs.
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            status: TaskStatus::Pending,
            owner: None,
            model: None,
            priority: TaskPriority::default(),
            estimate: None,
            dependencies: Vec::new(),
            outputs: Vec::new(),
            source_branch: None,
            target_branch: None,
            crash_attempts: 0,
            rework_attempts: 0,
            timeout_attempts: 0,
        }
    }

    pub fn with_dependencies(mut self, deps: impl IntoIterator<Item = String>) -> Self {
        self.dependencies = deps.into_iter().collect();
        self
    }

    /// Bind the task to its worktree branch and the branch it merges into.
    pub fn with_branches(mut self, source: impl Into<String>, target: impl Into<String>) -> Self {
        self.source_branch = Some(source.into());
        self.target_branch = Some(target.into());
        self
    }

    /// The CLI model that implements this task: the explicit `model` if set,
    /// else `owner` (back-compat — owner doubled as the model before the two
    /// were split). Only selects which agent CLI is spawned; `owner` remains the
    /// implementer identity used by the reviewer-!=-implementer merge gate, so a
    /// task can be owned by a logical identity yet executed by any model.
    pub fn agent_model(&self) -> Option<String> {
        self.model.clone().or_else(|| self.owner.clone())
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TaskGraphError {
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("task already exists: {0}")]
    Duplicate(String),
    #[error("task {task} depends on unknown task {dep}")]
    UnknownDependency { task: String, dep: String },
    #[error("illegal transition {from} -> {to} for task {task}")]
    IllegalTransition {
        task: String,
        from: &'static str,
        to: &'static str,
    },
}

/// In-memory Task Graph. Dependencies must reference already-added tasks, so
/// the graph is a DAG by construction (a task cannot depend on something not
/// yet added, and additions are append-only) — no cycle is representable.
///
/// `Clone` enables atomic batch submission: a plan is staged on a clone and the
/// clone is swapped in only if every task adds cleanly (see
/// `TaskManager::submit_plan`), so a rejected plan never leaves a partial graph.
#[derive(Debug, Default, Clone)]
pub struct TaskGraph {
    tasks: HashMap<String, Task>,
    /// Insertion order, for stable listing.
    order: Vec<String>,
}

impl TaskGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// Add a task. Rejects duplicate ids and dependencies on tasks that do not
    /// already exist (which keeps the graph acyclic).
    pub fn add(&mut self, task: Task) -> Result<(), TaskGraphError> {
        if self.tasks.contains_key(&task.id) {
            return Err(TaskGraphError::Duplicate(task.id));
        }
        for dep in &task.dependencies {
            if !self.tasks.contains_key(dep) {
                return Err(TaskGraphError::UnknownDependency {
                    task: task.id.clone(),
                    dep: dep.clone(),
                });
            }
        }
        self.order.push(task.id.clone());
        self.tasks.insert(task.id.clone(), task);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&Task> {
        self.tasks.get(id)
    }

    /// Tasks in insertion order.
    pub fn list(&self) -> Vec<&Task> {
        self.order
            .iter()
            .filter_map(|id| self.tasks.get(id))
            .collect()
    }

    /// Record one more crash + reassignment for a task and return the new crash
    /// count. Used by the autonomy loop's recovery to bound crash retries (BR9),
    /// independently from rework. Returns 0 for an unknown task.
    pub fn record_crash(&mut self, id: &str) -> u32 {
        match self.tasks.get_mut(id) {
            Some(task) => {
                task.crash_attempts += 1;
                task.crash_attempts
            }
            None => 0,
        }
    }

    /// Record one more review-reject + re-dispatch for a task and return the new
    /// rework count. Bounds rework independently from crash recovery. Returns 0
    /// for an unknown task.
    pub fn record_rework(&mut self, id: &str) -> u32 {
        match self.tasks.get_mut(id) {
            Some(task) => {
                task.rework_attempts += 1;
                task.rework_attempts
            }
            None => 0,
        }
    }

    /// Record one more wall-clock TIMEOUT (hung worker killed + reassigned) for a
    /// task and return the new timeout count. Bounds hang recovery independently
    /// from crash and rework. Returns 0 for an unknown task.
    pub fn record_timeout(&mut self, id: &str) -> u32 {
        match self.tasks.get_mut(id) {
            Some(task) => {
                task.timeout_attempts += 1;
                task.timeout_attempts
            }
            None => 0,
        }
    }

    /// Transition a task to `to`, validated against the lifecycle.
    pub fn transition(&mut self, id: &str, to: TaskStatus) -> Result<(), TaskGraphError> {
        let task = self
            .tasks
            .get_mut(id)
            .ok_or_else(|| TaskGraphError::NotFound(id.to_string()))?;
        if !task.status.can_transition(to) {
            return Err(TaskGraphError::IllegalTransition {
                task: id.to_string(),
                from: task.status.as_str(),
                to: to.as_str(),
            });
        }
        task.status = to;
        Ok(())
    }

    /// Re-evaluate the dependency gate for every not-yet-started task and apply
    /// the implied status. For each `Pending`/`Blocked` task:
    /// - all dependencies `Done`        -> `Ready`
    /// - any dependency `Failed`        -> `Blocked`
    /// - otherwise                      -> unchanged
    ///
    /// Returns the ids whose status changed. Idempotent.
    pub fn recompute_ready(&mut self) -> Vec<String> {
        let mut changes: Vec<(String, TaskStatus)> = Vec::new();
        for id in &self.order {
            let Some(task) = self.tasks.get(id) else {
                continue;
            };
            if !matches!(task.status, TaskStatus::Pending | TaskStatus::Blocked) {
                continue;
            }
            let dep_statuses: Vec<TaskStatus> = task
                .dependencies
                .iter()
                .filter_map(|dep| self.tasks.get(dep).map(|t| t.status))
                .collect();
            let any_failed = dep_statuses.contains(&TaskStatus::Failed);
            let all_done = dep_statuses.iter().all(|s| *s == TaskStatus::Done);
            let next = if any_failed {
                TaskStatus::Blocked
            } else if all_done {
                TaskStatus::Ready
            } else {
                continue;
            };
            if next != task.status {
                changes.push((id.clone(), next));
            }
        }
        let changed: Vec<String> = changes.iter().map(|(id, _)| id.clone()).collect();
        for (id, status) in changes {
            if let Some(task) = self.tasks.get_mut(&id) {
                task.status = status;
            }
        }
        changed
    }

    /// Ready tasks, highest priority first (stable within a priority).
    pub fn ready_tasks(&self) -> Vec<&Task> {
        let mut ready: Vec<&Task> = self
            .list()
            .into_iter()
            .filter(|t| t.status == TaskStatus::Ready)
            .collect();
        ready.sort_by(|a, b| priority_rank(b.priority).cmp(&priority_rank(a.priority)));
        ready
    }
}

fn priority_rank(p: TaskPriority) -> u8 {
    match p {
        TaskPriority::Low => 0,
        TaskPriority::Medium => 1,
        TaskPriority::High => 2,
        TaskPriority::Critical => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branches_default_none_and_builder_sets_them() {
        let plain = Task::new("t", "T");
        assert_eq!(plain.source_branch, None);
        assert_eq!(plain.target_branch, None);
        let bound = Task::new("t", "T").with_branches("agent/t", "main");
        assert_eq!(bound.source_branch.as_deref(), Some("agent/t"));
        assert_eq!(bound.target_branch.as_deref(), Some("main"));
        // A task deserialized without branch fields keeps them None.
        let parsed: Task =
            serde_json::from_str(r#"{"id":"x","title":"X","status":"pending"}"#).unwrap();
        assert_eq!(parsed.source_branch, None);
        assert_eq!(parsed.target_branch, None);
    }

    #[test]
    fn agent_model_prefers_model_then_owner_with_backcompat() {
        // No model, no owner -> nothing to route on.
        let plain = Task::new("t", "T");
        assert_eq!(plain.model, None);
        assert_eq!(plain.agent_model(), None);
        // Back-compat: owner doubled as the model, so owner is the fallback.
        let mut owned = Task::new("t", "T");
        owned.owner = Some("claude".to_string());
        assert_eq!(owned.agent_model().as_deref(), Some("claude"));
        // Explicit model wins, while owner stays the (distinct) implementer identity.
        let mut split = Task::new("t", "T");
        split.owner = Some("backend".to_string());
        split.model = Some("codex".to_string());
        assert_eq!(split.agent_model().as_deref(), Some("codex"));
        assert_eq!(split.owner.as_deref(), Some("backend"));
        // A task deserialized without `model` keeps it None (back-compat with
        // graphs/payloads written before owner and model were split).
        let parsed: Task =
            serde_json::from_str(r#"{"id":"x","title":"X","status":"pending","owner":"gemini"}"#)
                .unwrap();
        assert_eq!(parsed.model, None);
        assert_eq!(parsed.agent_model().as_deref(), Some("gemini"));
    }

    #[test]
    fn add_rejects_duplicate_and_unknown_dependency() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        assert_eq!(
            g.add(Task::new("a", "A again")),
            Err(TaskGraphError::Duplicate("a".to_string()))
        );
        assert_eq!(
            g.add(Task::new("b", "B").with_dependencies(["missing".to_string()])),
            Err(TaskGraphError::UnknownDependency {
                task: "b".to_string(),
                dep: "missing".to_string(),
            })
        );
    }

    #[test]
    fn list_is_insertion_ordered() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B")).unwrap();
        g.add(Task::new("c", "C")).unwrap();
        let ids: Vec<&str> = g.list().iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["a", "b", "c"]);
    }

    #[test]
    fn transition_validates_lifecycle() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        assert!(g.transition("a", TaskStatus::Ready).is_ok());
        assert!(g.transition("a", TaskStatus::Running).is_ok());
        // Running -> Pending is illegal.
        assert_eq!(
            g.transition("a", TaskStatus::Pending),
            Err(TaskGraphError::IllegalTransition {
                task: "a".to_string(),
                from: "running",
                to: "pending",
            })
        );
        assert_eq!(
            g.transition("ghost", TaskStatus::Ready),
            Err(TaskGraphError::NotFound("ghost".to_string()))
        );
    }

    #[test]
    fn root_task_becomes_ready_on_recompute() {
        let mut g = TaskGraph::new();
        g.add(Task::new("root", "Root")).unwrap();
        let changed = g.recompute_ready();
        assert_eq!(changed, ["root"]);
        assert_eq!(g.get("root").unwrap().status, TaskStatus::Ready);
        // Idempotent: a second pass changes nothing.
        assert!(g.recompute_ready().is_empty());
    }

    #[test]
    fn dependent_waits_until_all_deps_done() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep1", "D1")).unwrap();
        g.add(Task::new("dep2", "D2")).unwrap();
        g.add(Task::new("ui", "UI").with_dependencies(["dep1".into(), "dep2".into()]))
            .unwrap();

        g.recompute_ready();
        // Roots (dep1, dep2) are promoted to Ready; the dependent stays Pending.
        assert_eq!(g.get("dep1").unwrap().status, TaskStatus::Ready);
        assert_eq!(g.get("ui").unwrap().status, TaskStatus::Pending);

        // Finish only dep1 (already Ready after the recompute above).
        g.transition("dep1", TaskStatus::Running).unwrap();
        g.transition("dep1", TaskStatus::Done).unwrap();
        g.recompute_ready();
        assert_eq!(g.get("ui").unwrap().status, TaskStatus::Pending);

        // Finish dep2 -> ui becomes Ready.
        g.transition("dep2", TaskStatus::Running).unwrap();
        g.transition("dep2", TaskStatus::Done).unwrap();
        let changed = g.recompute_ready();
        assert!(changed.contains(&"ui".to_string()));
        assert_eq!(g.get("ui").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn failed_dependency_blocks_then_replan_unblocks() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep", "Dep")).unwrap();
        g.add(Task::new("child", "Child").with_dependencies(["dep".into()]))
            .unwrap();

        g.transition("dep", TaskStatus::Ready).unwrap();
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Failed).unwrap();
        let changed = g.recompute_ready();
        assert!(changed.contains(&"child".to_string()));
        assert_eq!(g.get("child").unwrap().status, TaskStatus::Blocked);

        // Re-plan the failed dep to Done; the blocked child becomes Ready.
        g.transition("dep", TaskStatus::Pending).unwrap();
        g.transition("dep", TaskStatus::Ready).unwrap();
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Done).unwrap();
        g.recompute_ready();
        assert_eq!(g.get("child").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn crash_and_rework_counters_are_independent_and_default_to_zero() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        assert_eq!(g.get("a").unwrap().crash_attempts, 0);
        assert_eq!(g.get("a").unwrap().rework_attempts, 0);
        // Crash and rework bump separate counters — neither steals the other's budget.
        assert_eq!(g.record_crash("a"), 1);
        assert_eq!(g.record_rework("a"), 1);
        assert_eq!(g.record_crash("a"), 2);
        assert_eq!(g.get("a").unwrap().crash_attempts, 2);
        assert_eq!(g.get("a").unwrap().rework_attempts, 1);
        // Unknown task: no panic, returns 0.
        assert_eq!(g.record_crash("ghost"), 0);
        assert_eq!(g.record_rework("ghost"), 0);
        // A task deserialized without the fields defaults to zero.
        let parsed: Task =
            serde_json::from_str(r#"{"id":"x","title":"X","status":"pending"}"#).unwrap();
        assert_eq!(parsed.crash_attempts, 0);
        assert_eq!(parsed.rework_attempts, 0);
    }

    #[test]
    fn ready_tasks_are_priority_ordered() {
        let mut g = TaskGraph::new();
        let mut low = Task::new("low", "Low");
        low.priority = TaskPriority::Low;
        let mut crit = Task::new("crit", "Crit");
        crit.priority = TaskPriority::Critical;
        let mut med = Task::new("med", "Med");
        med.priority = TaskPriority::Medium;
        g.add(low).unwrap();
        g.add(crit).unwrap();
        g.add(med).unwrap();
        g.recompute_ready();
        let ids: Vec<&str> = g.ready_tasks().iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["crit", "med", "low"]);
    }

    #[test]
    fn priority_as_str_matches_serde_and_from_str_roundtrips() {
        let all = [
            TaskPriority::Low,
            TaskPriority::Medium,
            TaskPriority::High,
            TaskPriority::Critical,
        ];
        for p in all {
            // as_str agrees with the serde representation (the contract the DB
            // column and any TS bridge rely on).
            let serde_name = serde_json::to_value(p).unwrap();
            assert_eq!(serde_name.as_str(), Some(p.as_str()));
            // round-trips back to the same variant.
            assert_eq!(TaskPriority::from_str(p.as_str()).unwrap(), p);
        }
        assert!(TaskPriority::from_str("urgent").is_err());
    }
}
