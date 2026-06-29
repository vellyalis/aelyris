//! Backend command-risk policy (P0-4) — the CANONICAL, backend-authoritative classifier
//! for destructive-command risk. A faithful port of the frontend `src/shared/lib/shellSafety.ts`
//! (which is now advisory UX only). Every command-carrying backend write path classifies
//! through here before reaching a PTY.
//!
//! Parity with the frontend is enforced by a SHARED golden corpus (`corpus.json`) asserted
//! by both the Rust tests here and the Vitest suite, so the two policies cannot drift.

pub mod approval;
pub mod gate;

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Bump when the policy semantics change; the approval token binds to it so a token minted
/// under an old policy can never be consumed under a new one (hard boundary #2).
pub const POLICY_VERSION: u32 = 1;

/// One risk class a command can fall into (ports the FE `CommandRiskClass`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum CommandRiskClass {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "build/test")]
    BuildTest,
    #[serde(rename = "file mutation")]
    FileMutation,
    #[serde(rename = "git mutation")]
    GitMutation,
    #[serde(rename = "package install")]
    PackageInstall,
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "process kill")]
    ProcessKill,
    #[serde(rename = "delete")]
    Delete,
    #[serde(rename = "permission")]
    Permission,
    #[serde(rename = "secret-bearing")]
    SecretBearing,
    #[serde(rename = "destructive")]
    Destructive,
    #[serde(rename = "unknown")]
    Unknown,
}

/// The policy decision (ports the FE `CommandRiskSeverity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandRiskSeverity {
    Allow,
    Review,
    Deny,
}

impl CommandRiskSeverity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Review => "review",
            Self::Deny => "deny",
        }
    }
}

/// The classification of one command (ports the relevant fields of the FE `CommandRiskReport`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRiskReport {
    /// Redacted, trimmed, capped at 500 chars — safe to persist as audit evidence.
    pub preview: String,
    pub classes: Vec<CommandRiskClass>,
    pub severity: CommandRiskSeverity,
    /// True when severity != allow (a confirmation / approval is needed).
    pub requires_approval: bool,
    /// False when severity == deny (catastrophic — no approval overrides it in P0-4).
    pub allow_execution: bool,
    pub reasons: Vec<String>,
    pub line_count: usize,
    pub multiline: bool,
    pub unsafe_paths: Vec<String>,
    pub secret_count: usize,
    pub confidence: &'static str,
}

/// Options that scope what counts as an "unsafe" absolute path.
#[derive(Debug, Clone, Default)]
pub struct CommandRiskOptions {
    pub workspace_root: Option<String>,
    pub safe_paths: Vec<String>,
}

struct DangerousPattern {
    re: Regex,
    class: CommandRiskClass,
}

fn dangerous_class(source: &str) -> CommandRiskClass {
    if source.contains("git") {
        CommandRiskClass::GitMutation
    } else if source.contains("del") {
        CommandRiskClass::Delete
    } else {
        CommandRiskClass::Destructive
    }
}

/// The 15 destructive patterns — ported verbatim from `shellSafety.ts` DANGEROUS_PATTERNS,
/// each prefixed with `(?i)` for the JS `/i` flag.
static DANGEROUS_PATTERNS: LazyLock<Vec<DangerousPattern>> = LazyLock::new(|| {
    let sources: &[&str] = &[
        r"(?i)\brm\s+(-rf?|--recursive)\b",
        r"(?i)\bdel\s+/[sfq]",
        r"(?i)\bformat\s+[a-z]:",
        r"(?i)\brmdir\s+/s",
        r"(?i)\bmkfs\b",
        r"(?i)\bdd\s+if=",
        // NOTE: no `\b` before `>` — a space precedes `>` in the normal shell form
        // (`echo x > /dev/sda`), and there is no word boundary between a space and `>`,
        // so `\b>` would miss a block-device overwrite (would be only `file mutation`).
        r"(?i)>\s*/dev/sd[a-z]",
        r"\bchmod\s+(-[rR]\s+)?777\b",
        r"(?i)\bcurl\b.*\|\s*(ba)?sh\b",
        r"(?i)\bwget\b.*\|\s*(ba)?sh\b",
        r"(?i)\bpowershell\b.*-enc",
        r"(?i)\biex\b.*downloadstring",
        r"(?i)\bgit\s+reset\s+--hard\b",
        r"(?i)\bgit\s+clean\s+-[a-z]*f",
        r"(?i)\bRemove-Item\b[\s\S]*(?:^|\s)-Recurse\b[\s\S]*(?:^|\s)-Force\b",
    ];
    sources
        .iter()
        .map(|s| DangerousPattern {
            re: Regex::new(s).expect("valid dangerous pattern"),
            class: dangerous_class(s),
        })
        .collect()
});

/// Secret-detection patterns (port of the FE SECRET_PATTERNS) — used to COUNT
/// secret-bearing substrings. Redaction uses the dedicated REDACT_* patterns below.
static SECRET_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}").unwrap(),
        Regex::new(r"(?i)\bsk-[A-Za-z0-9_-]{12,}").unwrap(),
        Regex::new(
            r#"(?i)\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*("[^"]*"|'[^']*'|[^\s"';&|]+)"#,
        )
        .unwrap(),
        Regex::new(
            r#"(?i)(--?(?:token|secret|password|api[-_]?key|authorization)\s*[=:]?\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)"#,
        )
        .unwrap(),
    ]
});

static WINDOWS_ABSOLUTE_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\b[A-Za-z]:[\\/][^\s"'`|&;)]*"#).unwrap());
// The leading delimiter `(^|[\s"'`])` is captured as group 1 so the PATH (group 2)
// excludes a surrounding quote — otherwise `cat "/etc/passwd"` would extract
// `"/etc/passwd`, which is neither absolute nor a system path, and the system-dir
// deny would be bypassed.
static UNIX_ABSOLUTE_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(^|[\s"'`])(/[A-Za-z0-9._~+\-/]*)"#).unwrap());

// Redaction patterns (port of `redactSensitiveCommand`).
static REDACT_BEARER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}").unwrap());
static REDACT_OPENAI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bsk-[A-Za-z0-9_-]{12,}").unwrap());
static REDACT_ASSIGN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)"#,
    )
    .unwrap()
});
static REDACT_FLAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(--?(?:token|secret|password|api[-_]?key|authorization)\s*[=:]?\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)"#,
    )
    .unwrap()
});

const REVIEW_CLASSES: &[CommandRiskClass] = &[
    CommandRiskClass::FileMutation,
    CommandRiskClass::GitMutation,
    CommandRiskClass::PackageInstall,
    CommandRiskClass::Network,
    CommandRiskClass::ProcessKill,
    CommandRiskClass::Delete,
    CommandRiskClass::Permission,
    CommandRiskClass::SecretBearing,
    CommandRiskClass::Unknown,
];

/// Trim trailing newlines (port of FE `commandBody`).
fn command_body(command: &str) -> &str {
    command.trim().trim_end_matches(['\r', '\n'])
}

fn command_line_count(command: &str) -> usize {
    let body = command_body(command);
    if body.is_empty() {
        return 0;
    }
    // Split on \r\n | \r | \n (matching the FE regex split).
    body.replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .count()
}

/// Replace quoted text, `#` comments, and `//` comments with spaces so destructive
/// patterns inside string literals / comments don't trip the classifier (port of
/// `maskQuotedShellText`).
fn mask_quoted_shell_text(command: &str) -> String {
    let chars: Vec<char> = command.chars().collect();
    let mut out = String::with_capacity(command.len());
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if let Some(q) = quote {
            if escaped {
                escaped = false;
                out.push(' ');
                i += 1;
                continue;
            }
            if c == '\\' || (q == '`' && c == '`') {
                escaped = true;
                out.push(' ');
                i += 1;
                continue;
            }
            if c == q {
                quote = None;
                out.push(c);
                i += 1;
                continue;
            }
            out.push(if c == '\n' || c == '\r' { c } else { ' ' });
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' || c == '`' {
            quote = Some(c);
            out.push(c);
            i += 1;
            continue;
        }
        let prev_is_space = i == 0 || chars.get(i - 1).map(|p| p.is_whitespace()).unwrap_or(false);
        if c == '#' && prev_is_space {
            while i < chars.len() && chars[i] != '\n' && chars[i] != '\r' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if c == '/' && next == Some('/') && prev_is_space {
            while i < chars.len() && chars[i] != '\n' && chars[i] != '\r' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Replace secret-bearing substrings with `[REDACTED]` (port of `redactSensitiveCommand`).
pub fn redact_sensitive_command(command: &str) -> String {
    let s = REDACT_BEARER.replace_all(command, "${1}[REDACTED]");
    let s = REDACT_OPENAI.replace_all(&s, "[REDACTED]");
    let s = REDACT_ASSIGN.replace_all(&s, "${1}[REDACTED]");
    let s = REDACT_FLAG.replace_all(&s, "${1}[REDACTED]");
    s.into_owned()
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn is_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes.get(2), Some(b'\\') | Some(b'/')))
        || path.starts_with('/')
}

fn extract_command_paths(command: &str) -> Vec<String> {
    let mut paths = BTreeSet::new();
    for m in WINDOWS_ABSOLUTE_PATH.find_iter(command) {
        paths.insert(m.as_str().to_string());
    }
    for caps in UNIX_ABSOLUTE_PATH.captures_iter(command) {
        // Group 2 is the path WITHOUT the leading quote/space delimiter.
        if let Some(m) = caps.get(2) {
            let value = m.as_str().trim().to_string();
            if value.chars().count() > 1 {
                paths.insert(value);
            }
        }
    }
    paths.into_iter().collect()
}

fn is_system_path(path: &str) -> bool {
    let normalized = normalize_path(path);
    const SYSTEM: &[&str] = &[
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "d:/windows",
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
    ];
    SYSTEM
        .iter()
        .any(|p| normalized == *p || normalized.starts_with(&format!("{p}/")))
}

fn is_unsafe_path(path: &str, options: &CommandRiskOptions) -> bool {
    if is_system_path(path) {
        return true;
    }
    if !is_absolute_path(path) {
        return false;
    }
    let safe: Vec<String> = std::iter::once(options.workspace_root.as_deref())
        .flatten()
        .chain(options.safe_paths.iter().map(String::as_str))
        .filter(|v| !v.trim().is_empty())
        .map(normalize_path)
        .collect();
    if safe.is_empty() {
        return false;
    }
    let normalized = normalize_path(path);
    !safe
        .iter()
        .any(|s| normalized == *s || normalized.starts_with(&format!("{s}/")))
}

fn find_secret_count(command: &str) -> usize {
    SECRET_PATTERNS
        .iter()
        .map(|re| re.find_iter(command).count())
        .sum()
}

fn classify_by_pattern(command: &str) -> (Vec<CommandRiskClass>, Vec<String>) {
    let scan = mask_quoted_shell_text(command);
    let lower = scan.to_lowercase();
    let mut classes = Vec::new();
    let mut reasons = Vec::new();

    if READ_ONLY_RE.is_match(&scan) {
        classes.push(CommandRiskClass::ReadOnly);
        reasons.push("Matches a read-only inspection command.".to_string());
    }
    if BUILD_TEST_RE.is_match(&scan) {
        classes.push(CommandRiskClass::BuildTest);
        reasons.push("Matches a build or test command.".to_string());
    }
    if GIT_MUTATION_RE.is_match(&scan) {
        classes.push(CommandRiskClass::GitMutation);
        reasons.push("Mutates git state or repository history.".to_string());
    }
    if PACKAGE_INSTALL_RE.is_match(&scan) {
        classes.push(CommandRiskClass::PackageInstall);
        reasons.push("Changes dependencies or installs executable code.".to_string());
    }
    if NETWORK_RE.is_match(&scan) {
        classes.push(CommandRiskClass::Network);
        reasons.push("Contacts the network or downloads remote content.".to_string());
    }
    if PROCESS_KILL_RE.is_match(&scan) {
        classes.push(CommandRiskClass::ProcessKill);
        reasons.push("Stops a process or process tree.".to_string());
    }
    if PERMISSION_RE.is_match(&scan) {
        classes.push(CommandRiskClass::Permission);
        reasons.push("Changes permissions or requests elevation.".to_string());
    }
    let is_delete = DELETE_RE.is_match(&scan);
    if is_delete || REDIRECT_RE.is_match(&scan) || FILE_MUTATION_RE.is_match(&scan) {
        classes.push(if is_delete {
            CommandRiskClass::Delete
        } else {
            CommandRiskClass::FileMutation
        });
        reasons.push("Mutates files or directories.".to_string());
    }
    if lower.contains("| sh") || lower.contains("| bash") || lower.contains("downloadstring") {
        classes.push(CommandRiskClass::Destructive);
        reasons.push("Executes downloaded or opaque code.".to_string());
    }
    (classes, reasons)
}

static READ_ONLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(git\s+(status|diff|log|show|branch|rev-parse|remote\s+-v)\b|rg\b|grep\b|ls\b|dir\b|pwd\b|cat\b|type\b|where\b|echo\b|printf\b|write-host\b|get-content\b|get-childitem\b|get-location\b|select-string\b)").unwrap()
});
static BUILD_TEST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(cargo\s+(test|check|build|clippy)|pnpm(\.cmd)?\s+(test|build|exec\s+(vitest|tsc|playwright)|run\s+(test|build|lint|typecheck))|npm\s+(test|run\s+(test|build|lint|typecheck))|yarn\s+(test|build)|bun\s+(test|run)|vitest\s+run|tsc\s+--noemit|playwright\s+test)\b").unwrap()
});
static GIT_MUTATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(git\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|clean|cherry-pick|tag)\b)").unwrap()
});
static PACKAGE_INSTALL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update|upgrade)\b|\b(cargo\s+(add|install|update)|pip\s+install|uv\s+(add|pip\s+install))\b").unwrap()
});
static NETWORK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|gh\s+release|git\s+clone)\b",
    )
    .unwrap()
});
static PROCESS_KILL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(taskkill|stop-process|killall|pkill|kill\s+-9|kill\s+\d+)").unwrap()
});
static PERMISSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(sudo|runas|set-executionpolicy|icacls|takeown|chmod|chown|start-process\b[\s\S]*-verb\s+runas)").unwrap()
});
static DELETE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(remove-item|del|erase|rmdir|rm)\b").unwrap());
static REDIRECT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(^|[^>])>\s*[^&]").unwrap());
static FILE_MUTATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(set-content|add-content|out-file|new-item|move-item|copy-item|mkdir|touch)\b",
    )
    .unwrap()
});

fn unique_classes(classes: Vec<CommandRiskClass>) -> Vec<CommandRiskClass> {
    let mut seen = BTreeSet::new();
    classes.into_iter().filter(|c| seen.insert(*c)).collect()
}

/// Classify a command's destructive-command risk (port of `classifyCommand`). The single
/// source of truth the backend gate enforces.
pub fn classify_command(command: &str, options: &CommandRiskOptions) -> CommandRiskReport {
    let trimmed = command_body(command).to_string();
    let line_count = command_line_count(command);
    let secret_count = find_secret_count(command);
    let redacted = redact_sensitive_command(command);
    let paths = extract_command_paths(command);
    let unsafe_paths: Vec<String> = paths
        .iter()
        .filter(|p| is_unsafe_path(p, options))
        .cloned()
        .collect();

    if trimmed.is_empty() {
        return CommandRiskReport {
            preview: String::new(),
            classes: vec![CommandRiskClass::Unknown],
            severity: CommandRiskSeverity::Deny,
            requires_approval: true,
            allow_execution: false,
            reasons: vec!["Command is empty.".to_string()],
            line_count,
            multiline: false,
            unsafe_paths,
            secret_count,
            confidence: "high",
        };
    }

    let (mut classes, mut reasons) = classify_by_pattern(&trimmed);

    let scan = mask_quoted_shell_text(&trimmed);
    for d in DANGEROUS_PATTERNS.iter() {
        if d.re.is_match(&scan) {
            classes.push(d.class);
            classes.push(CommandRiskClass::Destructive);
            reasons.push(format!(
                "Potentially dangerous pattern detected: {}",
                d.re.as_str().trim_start_matches("(?i)")
            ));
        }
    }

    if secret_count > 0 {
        classes.push(CommandRiskClass::SecretBearing);
        reasons.push("Command contains token-like or secret-bearing text.".to_string());
    }
    if !unsafe_paths.is_empty() {
        reasons.push("Command references paths outside the configured safe scope.".to_string());
    }
    if classes.is_empty() {
        classes.push(CommandRiskClass::Unknown);
        reasons.push("No known safe command pattern matched.".to_string());
    }

    let unique = unique_classes(classes);
    let destructive = unique.contains(&CommandRiskClass::Destructive) || !unsafe_paths.is_empty();
    let severity = if destructive {
        CommandRiskSeverity::Deny
    } else if unique.iter().any(|c| REVIEW_CLASSES.contains(c)) || line_count > 1 {
        CommandRiskSeverity::Review
    } else {
        CommandRiskSeverity::Allow
    };
    let confidence = if unique.contains(&CommandRiskClass::Unknown) {
        "low"
    } else if unique.contains(&CommandRiskClass::SecretBearing) {
        "medium"
    } else {
        "high"
    };

    CommandRiskReport {
        preview: redacted.trim().chars().take(500).collect(),
        classes: unique,
        severity,
        requires_approval: severity != CommandRiskSeverity::Allow,
        allow_execution: severity != CommandRiskSeverity::Deny,
        reasons,
        line_count,
        multiline: line_count > 1,
        unsafe_paths,
        secret_count,
        confidence,
    }
}

#[cfg(test)]
mod tests;
