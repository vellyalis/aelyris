//! Agent public-contract integration tests.
//!
//! Stream parsing moved out of the current `agent` owner and watchdog matching
//! has focused unit coverage in `watchdog::engine`. Keep this integration file
//! limited to the serialized session contract consumed across IPC boundaries.

use aelyris_lib::agent::AgentSessionInfo;

#[test]
fn agent_session_info_serialization_contract() {
    let session = AgentSessionInfo {
        id: "agent-1".to_string(),
        status: "coding".to_string(),
        model: "sonnet".to_string(),
        prompt: "summarize".to_string(),
        cwd: "C:/repo".to_string(),
        cost: 0.25,
        tokens_used: 42,
        started_at: 123,
        task_id: None,
        execution_identity: None,
        current_activity: None,
    };

    let value = serde_json::to_value(session).expect("serialize AgentSessionInfo");

    assert_eq!(value["id"], "agent-1");
    assert_eq!(value["status"], "coding");
    assert_eq!(value["model"], "sonnet");
    assert_eq!(value["prompt"], "summarize");
    assert_eq!(value["cwd"], "C:/repo");
    assert_eq!(value["cost"], 0.25);
    assert_eq!(value["tokens_used"], 42);
    assert_eq!(value["started_at"], 123);
    assert!(value["execution_identity"].is_null());
}
