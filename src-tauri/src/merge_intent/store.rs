//! `MergeIntentStore` — the typed facade the MCP merge verbs use to reach the
//! durable `merge_intents` table (P0-3). It is a THIN wrapper over `ManagedDb`:
//! the SQLite row is the source of truth and the arbiter of every claim, so this
//! type holds NO in-memory copy of merge state. It only translates typed calls
//! into `MergeRepo` operations and owns the one piece of cross-cutting logic that
//! needs both the DB and git — restart reconciliation of a dangling `merging`.

use std::sync::Arc;

use crate::db::ManagedDb;
use crate::merge_intent::{MergeIntent, MergeIntentState};
use crate::persistence::MergeRepo;

#[derive(Clone)]
pub struct MergeIntentStore {
    db: Arc<ManagedDb>,
}

impl MergeIntentStore {
    pub fn new(db: Arc<ManagedDb>) -> Self {
        Self { db }
    }

    /// Persist a new intent, or return the existing one with the same idempotency
    /// key `(task_id, source_oid, target_oid)`.
    pub fn create_or_get(&self, intent: &MergeIntent) -> Result<MergeIntent, String> {
        self.db.with(|d| MergeRepo::insert_or_get(d, intent))
    }

    pub fn get(&self, intent_id: &str) -> Result<Option<MergeIntent>, String> {
        self.db.with(|d| MergeRepo::get(d, intent_id))
    }

    /// Compare-and-swap claim into `merging`. `true` only for the single winner.
    pub fn claim_for_merge(&self, intent_id: &str, now: i64) -> Result<bool, String> {
        self.db
            .with(|d| MergeRepo::claim_for_merge(d, intent_id, now))
    }

    pub fn set_state(
        &self,
        intent_id: &str,
        state: MergeIntentState,
        now: i64,
    ) -> Result<(), String> {
        self.db
            .with(|d| MergeRepo::set_state(d, intent_id, state, now))
    }

    /// Record who approved and on what gates (mutable metadata; the merge target
    /// stays immutable).
    pub fn record_approval(
        &self,
        intent_id: &str,
        reviewer_id: &str,
        gates_digest: Option<&str>,
        now: i64,
    ) -> Result<(), String> {
        self.db
            .with(|d| MergeRepo::record_approval(d, intent_id, reviewer_id, gates_digest, now))
    }

    pub fn list_in_state(&self, state: MergeIntentState) -> Result<Vec<MergeIntent>, String> {
        self.db.with(|d| MergeRepo::list_in_state(d, state))
    }

    /// Restart reconciliation: an intent left in `merging` means the process died
    /// mid-merge. For each, decide the true outcome by re-examining git (the durable
    /// source of truth is the repo, not our last in-flight guess):
    /// - target already contains the stored source OID  -> the merge LANDED: `merged`;
    /// - both branch tips still match the stored OIDs    -> safe to retry: `ready_to_merge`;
    /// - anything moved / the repo is unreadable         -> `needs_reconcile` (human/loop).
    ///
    /// Returns how many dangling intents were reconciled.
    pub fn reconcile_dangling_on_boot(&self, now: i64) -> Result<usize, String> {
        let dangling = self.list_in_state(MergeIntentState::Merging)?;
        let mut reconciled = 0;
        for intent in dangling {
            let resolved = classify_dangling(&intent);
            self.set_state(&intent.intent_id, resolved, now)?;
            reconciled += 1;
        }
        Ok(reconciled)
    }
}

/// Decide what a dangling `merging` intent should become (see
/// [`MergeIntentStore::reconcile_dangling_on_boot`]). Pure decision over git
/// state — separated out so it is unit-testable against a real temp repo.
fn classify_dangling(intent: &MergeIntent) -> MergeIntentState {
    // 1. Did the merge actually land before the crash?
    match crate::git::branch_contains_commit(
        &intent.repo_path,
        &intent.target_branch,
        &intent.source_oid,
    ) {
        Ok(true) => return MergeIntentState::Merged,
        Ok(false) => {}
        // Repo/branch unreadable -> a human (or the loop) must look.
        Err(_) => return MergeIntentState::NeedsReconcile,
    }
    // 2. Are both branch tips still exactly what the intent was bound to?
    let current = (
        crate::git::resolve_branch_oid(&intent.repo_path, &intent.source_branch),
        crate::git::resolve_branch_oid(&intent.repo_path, &intent.target_branch),
    );
    match current {
        (Ok(src), Ok(tgt)) if src == intent.source_oid && tgt == intent.target_oid => {
            // Nothing moved since the request — the merge can be re-attempted.
            MergeIntentState::ReadyToMerge
        }
        // A tip moved (or a branch vanished) -> the bound merge is stale.
        _ => MergeIntentState::NeedsReconcile,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use git2::{build::CheckoutBuilder, Repository};
    use std::path::Path;

    fn store() -> MergeIntentStore {
        MergeIntentStore::new(Arc::new(ManagedDb::new(Database::open_memory().unwrap())))
    }

    // ── minimal git fixtures (mirrors git/merge.rs test helpers) ──
    fn init_repo() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        (dir, repo)
    }

    fn commit(repo: &Repository, file: &str, content: &str, parents: &[git2::Oid]) -> git2::Oid {
        let workdir = repo.workdir().unwrap().to_path_buf();
        std::fs::write(workdir.join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "t@test").unwrap();
        let parent_commits: Vec<git2::Commit> = parents
            .iter()
            .map(|o| repo.find_commit(*o).unwrap())
            .collect();
        let refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "c", &tree, &refs)
            .unwrap()
    }

    fn checkout(repo: &Repository, branch: &str) {
        repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
    }

    fn path_of(repo: &Repository) -> String {
        repo.workdir().unwrap().to_str().unwrap().to_string()
    }

    fn intent(repo: &str, src_oid: &str, tgt_oid: &str) -> MergeIntent {
        MergeIntent {
            intent_id: format!("m-{src_oid}-{tgt_oid}"),
            repo_path: repo.to_string(),
            source_branch: "feature".to_string(),
            target_branch: "main".to_string(),
            source_oid: src_oid.to_string(),
            target_oid: tgt_oid.to_string(),
            merge_base_oid: None,
            task_id: "task-1".to_string(),
            created_at: 100,
            state: MergeIntentState::Queued,
            updated_at: 100,
            session_id: Some("agent-1".to_string()),
            reviewer_id: None,
            gates_digest: None,
        }
    }

    /// Persisted intents survive a "restart" (a fresh store on the SAME db) — the
    /// hydrate guarantee. No git needed.
    #[test]
    fn intents_survive_a_restart_on_the_same_db() {
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let s1 = MergeIntentStore::new(db.clone());
        s1.create_or_get(&intent("C:/repo", "src1", "tgt1"))
            .unwrap();
        // A brand-new store handle over the same connection sees the row.
        let s2 = MergeIntentStore::new(db);
        let loaded = s2.get("m-src1-tgt1").unwrap().unwrap();
        assert_eq!(loaded.source_oid, "src1");
        assert_eq!(loaded.state, MergeIntentState::Queued);
    }

    /// A dangling `merging` whose merge ACTUALLY landed reconciles to `merged`.
    #[test]
    fn boot_reconcile_marks_landed_merge_as_merged() {
        let (_dir, repo) = init_repo();
        let base = commit(&repo, "a.txt", "base", &[]);
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout(&repo, "feature");
        let feat = commit(&repo, "b.txt", "feature", &[base]);
        // Fast-forward main to the feature tip: the merge has landed.
        checkout(&repo, "main");
        repo.find_reference("refs/heads/main")
            .unwrap()
            .set_target(feat, "ff")
            .unwrap();
        let rp = path_of(&repo);

        let s = store();
        // Intent was bound to (feat -> base) and is stuck in `merging`.
        let mut i = intent(&rp, &feat.to_string(), &base.to_string());
        i.intent_id = "landed".to_string();
        s.create_or_get(&i).unwrap();
        assert!(s.claim_for_merge("landed", 200).unwrap());

        assert_eq!(s.reconcile_dangling_on_boot(300).unwrap(), 1);
        assert_eq!(
            s.get("landed").unwrap().unwrap().state,
            MergeIntentState::Merged
        );
    }

    /// A dangling `merging` whose branch tips are UNCHANGED reconciles to
    /// `ready_to_merge` (safe to retry); a moved tip reconciles to
    /// `needs_reconcile`.
    #[test]
    fn boot_reconcile_demotes_unchanged_and_flags_moved() {
        let (_dir, repo) = init_repo();
        let base = commit(&repo, "a.txt", "base", &[]);
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout(&repo, "feature");
        let feat = commit(&repo, "b.txt", "feature", &[base]);
        checkout(&repo, "main");
        let main_tip = commit(&repo, "c.txt", "main", &[base]); // main diverged, not merged
        let rp = path_of(&repo);

        let s = store();
        let mut unchanged = intent(&rp, &feat.to_string(), &main_tip.to_string());
        unchanged.intent_id = "unchanged".to_string();
        s.create_or_get(&unchanged).unwrap();
        assert!(s.claim_for_merge("unchanged", 200).unwrap());

        // A second intent bound to a STALE target oid (a tip that no longer exists).
        let mut moved = intent(&rp, &feat.to_string(), &base.to_string());
        moved.intent_id = "moved".to_string();
        moved.task_id = "task-2".to_string();
        s.create_or_get(&moved).unwrap();
        assert!(s.claim_for_merge("moved", 200).unwrap());

        assert_eq!(s.reconcile_dangling_on_boot(300).unwrap(), 2);
        assert_eq!(
            s.get("unchanged").unwrap().unwrap().state,
            MergeIntentState::ReadyToMerge,
            "unchanged tips -> safe to retry"
        );
        assert_eq!(
            s.get("moved").unwrap().unwrap().state,
            MergeIntentState::NeedsReconcile,
            "target tip moved since request -> needs reconcile"
        );
    }
}
