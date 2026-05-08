//! Agent integration tests — mock agent spawn, stream-json parsing, watchdog evaluation

use aether_terminal_lib::agent::parser::{StreamEvent, StreamParser};
use aether_terminal_lib::agent::AgentSessionInfo;
use aether_terminal_lib::watchdog::engine::{WatchdogDecision, WatchdogEngine};
use aether_terminal_lib::watchdog::{AutoApproveRule, WatchdogRules};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

/// Path to mock agent script
fn mock_agent_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    format!(
        "{}/tests/fixtures/mock_agent.ps1",
        manifest_dir.replace('\\', "/")
    )
}

#[test]
fn test_agent_session_info_serialization_contract() {
    let session = AgentSessionInfo {
        id: "agent-1".to_string(),
        status: "coding".to_string(),
        model: "sonnet".to_string(),
        prompt: "summarize".to_string(),
        cwd: "C:/repo".to_string(),
        cost: 0.25,
        tokens_used: 42,
    };

    let value = serde_json::to_value(session).expect("serialize AgentSessionInfo");

    assert_eq!(value["id"], "agent-1");
    assert_eq!(value["status"], "coding");
    assert_eq!(value["model"], "sonnet");
    assert_eq!(value["prompt"], "summarize");
    assert_eq!(value["cwd"], "C:/repo");
    assert_eq!(value["cost"], 0.25);
    assert_eq!(value["tokens_used"], 42);
}

// --- Mock agent spawn + parser integration ---

#[test]
fn test_mock_agent_spawn_and_parse() {
    let script = mock_agent_path();

    // Spawn PowerShell running the mock agent
    let mut child = Command::new("pwsh.exe")
        .args(["-NoProfile", "-NoLogo", "-File", &script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            // Fallback to powershell.exe if pwsh not available
            Command::new("powershell.exe")
                .args(["-NoProfile", "-NoLogo", "-File", &script])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
        })
        .expect("Failed to spawn PowerShell for mock agent");

    let stdout = child.stdout.take().expect("no stdout");
    let reader = BufReader::new(stdout);
    let mut parser = StreamParser::new();
    let mut all_events: Vec<StreamEvent> = Vec::new();

    for line in reader.lines() {
        match line {
            Ok(text) => {
                let mut events = parser.feed(&format!("{}\n", text));
                all_events.append(&mut events);
            }
            Err(_) => break,
        }
    }

    // Flush any remaining
    all_events.append(&mut parser.flush());

    let _ = child.wait();

    // Verify events
    assert!(
        all_events.len() >= 4,
        "Expected at least 4 events, got {}",
        all_events.len()
    );

    // First event should be system init
    assert!(all_events[0].is_system());
    assert_eq!(
        all_events[0].session_id.as_deref(),
        Some("mock-session-001")
    );

    // Should have at least one tool_use event
    let tool_uses: Vec<&StreamEvent> = all_events.iter().filter(|e| e.is_tool_use()).collect();
    assert!(
        !tool_uses.is_empty(),
        "Should have at least one tool_use event"
    );
    assert_eq!(tool_uses[0].tool_name.as_deref(), Some("Read"));

    // Last event should be result with cost
    let last = all_events.last().unwrap();
    assert!(last.is_result());
    assert_eq!(last.cost_usd, Some(0.003));
    assert_eq!(last.total_tokens, Some(250));
}

#[test]
fn test_mock_agent_kill() {
    let mut child = Command::new("pwsh.exe")
        .args([
            "-NoProfile",
            "-NoLogo",
            "-Command",
            "Start-Sleep -Seconds 30",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NoLogo",
                    "-Command",
                    "Start-Sleep -Seconds 30",
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        })
        .expect("Failed to spawn");

    let pid = child.id();
    assert!(pid > 0);

    // Kill via taskkill /T /F (process tree)
    let kill_result = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();

    assert!(kill_result.is_ok(), "taskkill should succeed");

    // Wait should return (process terminated)
    let status = child.wait().expect("wait failed");
    // Process was forcefully killed, so status won't be success
    assert!(!status.success());
}

// --- Watchdog + Parser integration ---

#[test]
fn test_watchdog_evaluates_parsed_events() {
    let rules = WatchdogRules {
        enabled: true,
        auto_approve: vec![
            AutoApproveRule {
                pattern: "Read".to_string(),
                approve: true,
                description: "Allow reads".to_string(),
            },
            AutoApproveRule {
                pattern: "Bash(rm*)".to_string(),
                approve: false,
                description: "Block rm commands".to_string(),
            },
        ],
        auto_repair: Default::default(),
    };

    let engine = WatchdogEngine::new(rules);

    // Simulate parsed events
    let mut parser = StreamParser::new();
    let events = parser.feed(concat!(
        "{\"type\":\"assistant\",\"subtype\":\"tool_use\",\"tool_name\":\"Read\"}\n",
        "{\"type\":\"assistant\",\"subtype\":\"tool_use\",\"tool_name\":\"Bash(rm -rf /tmp)\"}\n",
        "{\"type\":\"assistant\",\"subtype\":\"tool_use\",\"tool_name\":\"Write\"}\n",
    ));

    assert_eq!(events.len(), 3);

    // Evaluate each tool_use through watchdog
    let decisions: Vec<WatchdogDecision> = events
        .iter()
        .filter(|e| e.is_tool_use())
        .map(|e| engine.evaluate(e.tool_name.as_deref().unwrap_or("")))
        .collect();

    assert_eq!(decisions.len(), 3);
    assert_eq!(
        decisions[0],
        WatchdogDecision::AutoApprove {
            rule: "Read".into()
        }
    );
    assert_eq!(
        decisions[1],
        WatchdogDecision::AutoDeny {
            rule: "Bash(rm*)".into()
        }
    );
    assert_eq!(decisions[2], WatchdogDecision::AskUser);
}

#[test]
fn test_default_watchdog_rules() {
    let rules = WatchdogRules::default();
    let engine = WatchdogEngine::new(rules);

    // Default rules are disabled, so everything should be AskUser
    assert_eq!(engine.evaluate("Read"), WatchdogDecision::AskUser);
    assert_eq!(engine.evaluate("Glob"), WatchdogDecision::AskUser);
}

#[test]
fn test_enabled_default_watchdog_rules() {
    let rules = WatchdogRules {
        enabled: true,
        ..Default::default()
    };
    let engine = WatchdogEngine::new(rules);

    // Default rules auto-approve Read, Glob, Grep
    assert_eq!(
        engine.evaluate("Read"),
        WatchdogDecision::AutoApprove {
            rule: "Read".into()
        }
    );
    assert_eq!(
        engine.evaluate("Glob"),
        WatchdogDecision::AutoApprove {
            rule: "Glob".into()
        }
    );
    assert_eq!(
        engine.evaluate("Grep"),
        WatchdogDecision::AutoApprove {
            rule: "Grep".into()
        }
    );
    // Unknown tools -> AskUser
    assert_eq!(engine.evaluate("Edit"), WatchdogDecision::AskUser);
}
