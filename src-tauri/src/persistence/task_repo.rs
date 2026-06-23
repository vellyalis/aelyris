//! `TaskRepo` — persistence for the Task Graph (FR-2).
//!
//! The Task Graph's live state (status, crash/rework/timeout attempts, branch
//! bindings, outputs) is mutated through `TaskManager` — including the opaque
//! `with_graph_mut` escape hatch the autonomy loop drives. Rather than try to
//! diff which tasks changed inside that closure (a missed site = a silent
//! durability hole), `save_graph` persists the WHOLE graph snapshot atomically
//! after each mutation. The graph is small (a single operator's fleet), so a
//! full re-upsert per mutation is cheap and eliminates the missed-write-through
//! bug class entirely. `load_graph` restores exact statuses (no recompute).

use std::collections::HashMap;
use std::str::FromStr;

use rusqlite::params;

use crate::db::Database;
use crate::task::graph::{Task, TaskGraph, TaskPriority};
use crate::task::status::TaskStatus;

/// Raw columns of one `tasks` row, before enum/JSON parsing (which happens
/// outside the rusqlite closure so parse errors surface as `String`).
struct RawTask {
    id: String,
    title: String,
    description: String,
    status: String,
    owner: Option<String>,
    model: Option<String>,
    priority: String,
    estimate: Option<i64>,
    outputs_json: String,
    source_branch: Option<String>,
    target_branch: Option<String>,
    crash_attempts: i64,
    rework_attempts: i64,
    timeout_attempts: i64,
}

pub struct TaskRepo;

impl TaskRepo {
    /// Persist the entire graph atomically (full snapshot, write-through).
    pub fn save_graph(db: &Database, graph: &TaskGraph) -> Result<(), String> {
        let conn = db.conn();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Begin task tx: {e}"))?;
        for (sort_order, task) in graph.list().iter().enumerate() {
            let outputs_json = serde_json::to_string(&task.outputs)
                .map_err(|e| format!("Serialize outputs for {}: {e}", task.id))?;
            tx.execute(
                "INSERT INTO tasks (
                     id, title, description, status, owner, model, priority,
                     estimate, outputs_json, source_branch, target_branch,
                     crash_attempts, rework_attempts, timeout_attempts, sort_order
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(id) DO UPDATE SET
                     title = excluded.title,
                     description = excluded.description,
                     status = excluded.status,
                     owner = excluded.owner,
                     model = excluded.model,
                     priority = excluded.priority,
                     estimate = excluded.estimate,
                     outputs_json = excluded.outputs_json,
                     source_branch = excluded.source_branch,
                     target_branch = excluded.target_branch,
                     crash_attempts = excluded.crash_attempts,
                     rework_attempts = excluded.rework_attempts,
                     timeout_attempts = excluded.timeout_attempts,
                     sort_order = excluded.sort_order",
                params![
                    task.id,
                    task.title,
                    task.description,
                    task.status.as_str(),
                    task.owner,
                    task.model,
                    task.priority.as_str(),
                    task.estimate,
                    outputs_json,
                    task.source_branch,
                    task.target_branch,
                    task.crash_attempts,
                    task.rework_attempts,
                    task.timeout_attempts,
                    sort_order as i64,
                ],
            )
            .map_err(|e| format!("Upsert task {}: {e}", task.id))?;

            // Replace this task's dependency edges (deps are append-only in the
            // graph, but a clean replace keeps load deterministic and is robust
            // to any future edge removal).
            tx.execute(
                "DELETE FROM task_dependencies WHERE task_id = ?1",
                params![task.id],
            )
            .map_err(|e| format!("Clear deps for {}: {e}", task.id))?;
            for dep in &task.dependencies {
                tx.execute(
                    "INSERT OR IGNORE INTO task_dependencies (task_id, dep_id) VALUES (?1, ?2)",
                    params![task.id, dep],
                )
                .map_err(|e| format!("Insert dep {}->{}: {e}", task.id, dep))?;
            }
        }
        tx.commit().map_err(|e| format!("Commit task tx: {e}"))
    }

    /// Rebuild the graph from SQLite (startup restore). Tasks are re-added in
    /// `sort_order`, so each task's dependencies (which reference earlier tasks)
    /// are already present and the DAG invariant holds by construction.
    pub fn load_graph(db: &Database) -> Result<TaskGraph, String> {
        let conn = db.conn();

        // Dependency edges, grouped by task.
        let mut deps: HashMap<String, Vec<String>> = HashMap::new();
        {
            // ORDER BY rowid preserves each task's dependency Vec order: save
            // re-inserts deps in Vec order, so rowid is monotonic in that order.
            let mut stmt = conn
                .prepare("SELECT task_id, dep_id FROM task_dependencies ORDER BY rowid")
                .map_err(|e| format!("Prepare load deps: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Query deps: {e}"))?;
            for row in rows {
                let (task_id, dep_id) = row.map_err(|e| format!("Read dep row: {e}"))?;
                deps.entry(task_id).or_default().push(dep_id);
            }
        }

        // Task rows in insertion order.
        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, status, owner, model, priority,
                        estimate, outputs_json, source_branch, target_branch,
                        crash_attempts, rework_attempts, timeout_attempts
                 FROM tasks ORDER BY sort_order ASC, rowid ASC",
            )
            .map_err(|e| format!("Prepare load tasks: {e}"))?;
        let raws: Vec<RawTask> = stmt
            .query_map([], |row| {
                Ok(RawTask {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    owner: row.get(4)?,
                    model: row.get(5)?,
                    priority: row.get(6)?,
                    estimate: row.get(7)?,
                    outputs_json: row.get(8)?,
                    source_branch: row.get(9)?,
                    target_branch: row.get(10)?,
                    crash_attempts: row.get(11)?,
                    rework_attempts: row.get(12)?,
                    timeout_attempts: row.get(13)?,
                })
            })
            .map_err(|e| format!("Query tasks: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Read task rows: {e}"))?;

        let mut graph = TaskGraph::new();
        for raw in raws {
            let outputs: Vec<String> = serde_json::from_str(&raw.outputs_json)
                .map_err(|e| format!("Parse outputs for {}: {e}", raw.id))?;
            let task = Task {
                dependencies: deps.remove(&raw.id).unwrap_or_default(),
                status: TaskStatus::from_str(&raw.status)
                    .map_err(|e| format!("Task {}: {e}", raw.id))?,
                priority: TaskPriority::from_str(&raw.priority)
                    .map_err(|e| format!("Task {}: {e}", raw.id))?,
                // Values were written from u32 so they always fit; try_from
                // guards against a corrupt/out-of-range DB row without wrapping.
                estimate: raw.estimate.and_then(|v| u32::try_from(v).ok()),
                crash_attempts: u32::try_from(raw.crash_attempts).unwrap_or(0),
                rework_attempts: u32::try_from(raw.rework_attempts).unwrap_or(0),
                timeout_attempts: u32::try_from(raw.timeout_attempts).unwrap_or(0),
                outputs,
                // Symbol intents are not persisted yet (re-declared per session);
                // a restored task falls back to file-level exclusivity until then.
                symbols: Vec::new(),
                id: raw.id,
                title: raw.title,
                description: raw.description,
                owner: raw.owner,
                model: raw.model,
                source_branch: raw.source_branch,
                target_branch: raw.target_branch,
            };
            graph
                .add(task)
                .map_err(|e| format!("Rebuild task graph: {e}"))?;
        }
        Ok(graph)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rich_task(id: &str, title: &str) -> Task {
        let mut t = Task::new(id, title);
        t.priority = TaskPriority::High;
        t.owner = Some("backend".to_string());
        t.model = Some("codex".to_string());
        t.estimate = Some(42);
        t.outputs = vec!["src/a.rs".to_string(), "agent/x".to_string()];
        t
    }

    #[test]
    fn save_then_load_round_trips_structure_status_and_counters() {
        let db = Database::open_memory().unwrap();
        let mut graph = TaskGraph::new();
        graph.add(rich_task("dep", "Dep")).unwrap();
        graph
            .add(
                rich_task("child", "Child")
                    .with_dependencies(["dep".to_string()])
                    .with_branches("agent/child", "main"),
            )
            .unwrap();
        graph.add(Task::new("solo", "Solo")).unwrap();
        // Drive lifecycle + recovery counters so we exercise every column.
        graph.recompute_ready();
        graph.transition("dep", TaskStatus::Running).unwrap();
        graph.record_crash("dep");
        graph.record_rework("child");
        graph.record_timeout("child");

        TaskRepo::save_graph(&db, &graph).unwrap();
        let restored = TaskRepo::load_graph(&db).unwrap();

        // Insertion order preserved.
        let ids: Vec<&str> = restored.list().iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["dep", "child", "solo"]);

        let dep = restored.get("dep").unwrap();
        assert_eq!(dep.status, TaskStatus::Running);
        assert_eq!(dep.crash_attempts, 1);
        assert_eq!(dep.priority, TaskPriority::High);
        assert_eq!(dep.owner.as_deref(), Some("backend"));
        assert_eq!(dep.model.as_deref(), Some("codex"));
        assert_eq!(dep.estimate, Some(42));
        assert_eq!(dep.outputs, vec!["src/a.rs", "agent/x"]);

        let child = restored.get("child").unwrap();
        assert_eq!(child.dependencies, vec!["dep".to_string()]);
        assert_eq!(child.rework_attempts, 1);
        assert_eq!(child.timeout_attempts, 1);
        assert_eq!(child.source_branch.as_deref(), Some("agent/child"));
        assert_eq!(child.target_branch.as_deref(), Some("main"));
    }

    #[test]
    fn save_is_idempotent_and_reflects_later_changes() {
        let db = Database::open_memory().unwrap();
        let mut graph = TaskGraph::new();
        graph.add(Task::new("a", "A")).unwrap();
        TaskRepo::save_graph(&db, &graph).unwrap();
        // Mutate and re-save: the updated status must overwrite, not duplicate.
        graph.recompute_ready();
        graph.transition("a", TaskStatus::Running).unwrap();
        TaskRepo::save_graph(&db, &graph).unwrap();
        let restored = TaskRepo::load_graph(&db).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn load_from_empty_db_is_empty() {
        let db = Database::open_memory().unwrap();
        assert!(TaskRepo::load_graph(&db).unwrap().is_empty());
    }
}
