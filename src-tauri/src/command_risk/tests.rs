use super::*;

fn classify(cmd: &str) -> CommandRiskReport {
    classify_command(cmd, &CommandRiskOptions::default())
}

/// The shared golden corpus is the contract between the Rust (authoritative) policy and
/// the FE (advisory) policy: both assert against THIS file, so they cannot drift. It
/// asserts severity (required) plus classes / scope options / redaction (when present).
#[test]
fn matches_the_shared_golden_corpus() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CaseOptions {
        #[serde(default)]
        workspace_root: Option<String>,
        #[serde(default)]
        safe_paths: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    struct Case {
        command: String,
        severity: String,
        #[serde(default)]
        classes: Option<Vec<String>>,
        #[serde(default)]
        options: Option<CaseOptions>,
        #[serde(default)]
        preview_excludes: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    struct Corpus {
        cases: Vec<Case>,
    }
    let corpus: Corpus =
        serde_json::from_str(include_str!("corpus.json")).expect("corpus.json parses");
    assert!(corpus.cases.len() >= 30, "corpus should be representative");
    for case in corpus.cases {
        let opts = case
            .options
            .map(|o| CommandRiskOptions {
                workspace_root: o.workspace_root,
                safe_paths: o.safe_paths,
            })
            .unwrap_or_default();
        let report = classify_command(&case.command, &opts);
        assert_eq!(
            report.severity.as_str(),
            case.severity,
            "command {:?}: expected severity {}, got {}",
            case.command,
            case.severity,
            report.severity.as_str()
        );
        if let Some(expected) = case.classes {
            let mut got: Vec<String> = report
                .classes
                .iter()
                .map(|c| {
                    serde_json::to_value(c)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .to_string()
                })
                .collect();
            got.sort();
            let mut want = expected.clone();
            want.sort();
            assert_eq!(got, want, "command {:?}: class set mismatch", case.command);
        }
        for needle in &case.preview_excludes {
            assert!(
                !report.preview.contains(needle.as_str()),
                "command {:?}: redacted preview leaked {:?}",
                case.command,
                needle
            );
        }
    }
}

#[test]
fn empty_command_is_deny() {
    let r = classify("");
    assert_eq!(r.severity, CommandRiskSeverity::Deny);
    assert!(!r.allow_execution);
    assert!(r.requires_approval);
    let r2 = classify("   \n  ");
    assert_eq!(r2.severity, CommandRiskSeverity::Deny);
}

#[test]
fn destructive_pattern_denies_and_flags_destructive_class() {
    let r = classify("rm -rf /tmp/x");
    assert_eq!(r.severity, CommandRiskSeverity::Deny);
    assert!(!r.allow_execution, "deny is never executable");
    assert!(r.classes.contains(&CommandRiskClass::Destructive));
}

#[test]
fn quoted_destructive_text_is_masked_and_not_denied() {
    // The destructive token lives inside a string literal -> must not trip the classifier.
    let r = classify("echo \"rm -rf /\"");
    assert_eq!(r.severity, CommandRiskSeverity::Allow, "{:?}", r);
    assert!(!r.classes.contains(&CommandRiskClass::Destructive));
    assert!(r.classes.contains(&CommandRiskClass::ReadOnly));
}

#[test]
fn commented_destructive_text_is_masked() {
    // `#` and `//` comments are masked before scanning.
    assert_eq!(
        classify("ls # rm -rf /").severity,
        CommandRiskSeverity::Allow
    );
    assert_eq!(
        classify("ls // rm -rf /").severity,
        CommandRiskSeverity::Allow
    );
}

#[test]
fn review_classes_require_approval_but_stay_executable() {
    for cmd in [
        "git commit -m x",
        "npm install foo",
        "curl https://x",
        "mkdir a",
    ] {
        let r = classify(cmd);
        assert_eq!(r.severity, CommandRiskSeverity::Review, "{cmd}");
        assert!(r.requires_approval, "{cmd}");
        assert!(
            r.allow_execution,
            "{cmd} review is still executable with approval"
        );
    }
}

#[test]
fn rm_with_flags_is_deny_but_plain_rm_is_only_review() {
    assert_eq!(classify("rm -rf build").severity, CommandRiskSeverity::Deny);
    assert_eq!(
        classify("rm notes.txt").severity,
        CommandRiskSeverity::Review
    );
}

#[test]
fn multiline_is_review_even_when_each_line_is_safe() {
    let r = classify("ls\necho hi");
    assert_eq!(r.severity, CommandRiskSeverity::Review);
    assert!(r.multiline);
    assert_eq!(r.line_count, 2);
}

#[test]
fn system_path_reference_is_deny_via_unsafe_path() {
    let r = classify("cat C:/Windows/System32/config");
    assert_eq!(r.severity, CommandRiskSeverity::Deny);
    assert!(!r.unsafe_paths.is_empty());
}

#[test]
fn absolute_path_outside_workspace_is_unsafe_when_scope_is_set() {
    let opts = CommandRiskOptions {
        workspace_root: Some("C:/repo".to_string()),
        safe_paths: vec![],
    };
    // Inside the workspace -> safe (read-only stays allow).
    let inside = classify_command("cat C:/repo/src/main.rs", &opts);
    assert!(inside.unsafe_paths.is_empty(), "{inside:?}");
    assert_eq!(inside.severity, CommandRiskSeverity::Allow);
    // Outside the workspace -> unsafe -> deny.
    let outside = classify_command("cat C:/other/secret.txt", &opts);
    assert!(!outside.unsafe_paths.is_empty());
    assert_eq!(outside.severity, CommandRiskSeverity::Deny);
}

#[test]
fn secrets_are_counted_and_redacted_in_the_preview() {
    let fake_key = format!("sk-{}", "REDACTION_TEST_OPENAI_KEY");
    let command = format!("export API_KEY={fake_key}");
    let r = classify(&command);
    assert!(r.secret_count > 0);
    assert!(r.classes.contains(&CommandRiskClass::SecretBearing));
    // The persisted preview must NOT contain the raw secret.
    assert!(r.preview.contains("[REDACTED]"), "{}", r.preview);
    assert!(
        !r.preview.contains(&fake_key),
        "{}",
        r.preview
    );
    // secret-bearing alone is review, not deny.
    assert_eq!(r.severity, CommandRiskSeverity::Review);
}

#[test]
fn redact_handles_bearer_and_flag_secrets() {
    let bearer = format!("Bearer {}", "REDACTIONTESTBEARERTOKEN");
    let command = format!("curl -H 'Authorization: {bearer}' --token=REDACTION_TEST_FLAG_SECRET");
    let red = redact_sensitive_command(&command);
    assert!(!red.contains("REDACTIONTESTBEARERTOKEN"), "{red}");
    assert!(!red.contains("REDACTION_TEST_FLAG_SECRET"), "{red}");
    assert!(red.contains("[REDACTED]"));
}

#[test]
fn severity_serializes_to_the_frontend_strings() {
    assert_eq!(
        serde_json::to_value(CommandRiskSeverity::Deny).unwrap(),
        serde_json::json!("deny")
    );
    assert_eq!(
        serde_json::to_value(CommandRiskClass::GitMutation).unwrap(),
        serde_json::json!("git mutation")
    );
    assert_eq!(
        serde_json::to_value(CommandRiskClass::ReadOnly).unwrap(),
        serde_json::json!("read-only")
    );
}
