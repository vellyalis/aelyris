use std::sync::Mutex;

use super::{Intent, IntentStatus};

/// Thread-safe owner of the Intent Bus, managed in Tauri state. Append-only
/// proposals with in-place status resolution; `open()` is the live deliberation
/// queue peers read before acting.
#[derive(Default)]
pub struct IntentBus {
    intents: Mutex<Vec<Intent>>,
    seq: Mutex<u64>,
}

impl IntentBus {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Intent>> {
        self.intents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_id(&self) -> String {
        let mut seq = self.seq.lock().unwrap_or_else(|p| p.into_inner());
        *seq += 1;
        format!("intent-{seq}")
    }

    /// Propose an intent. `created_at` is caller-supplied (the IPC/MCP layer
    /// stamps it) so this stays free of ambient clock reads. Returns the stored
    /// intent (status `Open`).
    pub fn propose(
        &self,
        agent_id: impl Into<String>,
        proposal: impl Into<String>,
        targets: Vec<String>,
        created_at: u64,
    ) -> Intent {
        let intent = Intent {
            id: self.next_id(),
            agent_id: agent_id.into(),
            proposal: proposal.into(),
            targets,
            status: IntentStatus::Open,
            created_at,
        };
        self.lock().push(intent.clone());
        intent
    }

    /// Open (still-deliberating) intents, in proposal order.
    pub fn open(&self) -> Vec<Intent> {
        self.lock()
            .iter()
            .filter(|intent| intent.status == IntentStatus::Open)
            .cloned()
            .collect()
    }

    /// Every intent, in proposal order.
    pub fn all(&self) -> Vec<Intent> {
        self.lock().clone()
    }

    /// Resolve an intent to a terminal status. Returns the updated intent, or
    /// `None` if the id is unknown.
    pub fn resolve(&self, id: &str, status: IntentStatus) -> Option<Intent> {
        let mut intents = self.lock();
        let intent = intents.iter_mut().find(|intent| intent.id == id)?;
        intent.status = status;
        Some(intent.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn propose_then_open_lists_it() {
        let bus = IntentBus::new();
        let intent = bus.propose(
            "agent-a",
            "switch auth_method to JWT",
            vec!["src/auth/**".into()],
            100,
        );
        assert_eq!(intent.status, IntentStatus::Open);
        assert_eq!(intent.agent_id, "agent-a");
        let open = bus.open();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].proposal, "switch auth_method to JWT");
    }

    #[test]
    fn ids_are_unique_and_sequential() {
        let bus = IntentBus::new();
        let a = bus.propose("x", "a", vec![], 1);
        let b = bus.propose("x", "b", vec![], 2);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn resolve_moves_it_out_of_open() {
        let bus = IntentBus::new();
        let intent = bus.propose("agent-a", "use Redis", vec![], 100);
        let resolved = bus.resolve(&intent.id, IntentStatus::Accepted).unwrap();
        assert_eq!(resolved.status, IntentStatus::Accepted);
        assert!(bus.open().is_empty());
        assert_eq!(bus.all().len(), 1);
    }

    #[test]
    fn resolve_unknown_is_none() {
        let bus = IntentBus::new();
        assert!(bus.resolve("nope", IntentStatus::Rejected).is_none());
    }
}
