# Proofbook PB-1 Detailed Design (Implementation Blueprint)

Status: **design gate only — not implemented.** This document is the cold-start
implementation blueprint for PB-1 (schema / parser / validator + list/validate
IPC, **no runner**). It refines and grounds §11 "PB-1 / PB-1D" of
`docs/specs/PROOFBOOK_AUTOMATION_SPEC.md` with concrete Rust skeletons, exact
wiring steps, and the fixes that came out of a 4-agent adversarial review.

Companion to (does not replace) `PROOFBOOK_AUTOMATION_SPEC.md`. Read that spec's
§0 claim boundary, §4 domain model, §5 step types, §7 safety, and §11 roadmap
first.

Last reviewed: 2026-07-04 JST.

---

## 0. Claim boundary (unchanged)

Building PB-1 does **not** make Proofbooks runnable. PB-1 ships static schema
parsing + validation + read-only `list`/`validate` IPC. No `runId`, no
`.aelyris/proofbook-runs`, no command/MCP/HTTP/agent execution, no UI beyond
what already exists. Any execution-shaped request fails closed with
`runtime_not_available` or is simply not registered.

---

## 1. Adversarial review result (why this design is safe to build)

Four independent read-only audits were run against the spec before writing this
blueprint. **No BLOCK findings. PB-1 is GO.**

| Audit | Verdict | Bearing on PB-1 |
| --- | --- | --- |
| Backend safety (spec vs real code) | PASS | Every §2 anchor is real and accurately described. `serde_yaml` is real. PB-1 is buildable as specified. |
| Roadmap / phase split | REVIEW | PB-1 scope is correctly minimal. Findings target PB-2+ (`runner.rs` topology). |
| Product / UX | REVIEW | All holes are PB-2+ UI/product concerns; none block PB-1. |
| Existing-pattern map | — | Supplied exact serde / error / IPC / test idioms used below. |

### 1.1 Fixes applied to PB-1 in this blueprint

1. **Typed error, not `String`.** The existing workflow module returns
   `Result<_, String>`; PB-1D requires a structured error. Model `ProofbookError`
   on `api/mod.rs`'s `ApiError` → stable-code pattern, implemented with
   `thiserror` (dep present) **and** `#[derive(Serialize)]`. Tauri 2 serializes
   any `Serialize` error, so commands return `Result<T, ProofbookError>`.
2. **camelCase schema keys.** The spec's authored YAML (§4.1) uses `dependsOn`,
   `requiredSteps`, `requiredArtifacts`. Domain structs therefore use
   `#[serde(rename_all = "camelCase")]` (a justified deviation from the workflow
   module's snake_case idiom, because the Proofbook vocabulary itself is
   camelCase). The step-kind vocabulary (`mcpTool`, `manualGate`, `fanOut`,
   `subProofbook`, `evidence.write`) is likewise camelCase/dotted.
3. **`kind` parsed as `String`, resolved in the validator.** Keeping the wire
   step type as a `String` (not a closed serde enum) means an unknown value
   surfaces as `unknown_step_type` in validation, instead of being masked as a
   generic `yaml_parse_error` at deserialize time.
4. **Best-effort secret-inlining detection.** A non-executing validator cannot
   prove a plain string is not a secret; `invalid_secret_ref` is framed as
   best-effort (reject inline `value:` + token-like literals). Runtime redaction
   remains a PB-2 concern.
5. **Path containment via `canonicalize` + `starts_with`**, matching the
   existing pattern in `src-tauri/src/term/command_risk/mod.rs` (used in ~17
   files).

### 1.2 Findings deferred to later phases (recorded so they are not lost)

- **PB-2D — `runner.rs` must not become a god-object.** Define a `StepExecutor`
  trait + registration seam in PB-2; freeze `runner.rs` after PB-2 and add
  per-kind modules (`step_mcp.rs`, `step_agent.rs`, `step_fanout.rs`) that only
  register. (Roadmap audit, HIGH.)
- **PB-2 `waitFor` scope.** `waitFor` becomes executable in PB-2 but the authority
  matrix lists "poll MCP results", and MCP dispatch does not exist until PB-3.
  Scope PB-2 `waitFor` to files/artifacts only; add MCP-result polling in PB-3D.
  (Roadmap audit, MED.)
- **PB-5 validator changes are static-only.** Fan-out ownership/conflict preflight
  belongs in the runner/step module, not the static validator. (Roadmap, LOW.)
- **§14 stop condition** — add: "Stop if a `src/features/proofbook` panel renders
  an executable/mock flow ahead of its backend PB gate." (Roadmap, LOW.)
- **Product/UX (all PB-2+):** reconcile operator-vs-auditor persona; specify a
  guided authoring/repair path mapping error codes → plain-language fixes;
  state the Workflow-vs-Proofbook convergence story; declare the canvas
  read-only in v1; specify the gate-resolution panel contract; specify run-start
  input collection and a minimal run-list in PB-2; add a one-line
  Scape-differentiation thesis (verifier-step → "claim can be made", bound to
  `.codex-auto/quality/*`).

These are captured here and should be folded into the matching PB-ND design
gates. They are **out of scope for PB-1**.

---

## 2. PB-1 file scope

Create only these. One phase = one commit. No `push`/PR/force-push.

```
src-tauri/src/proofbook/mod.rs          # module surface + re-exports
src-tauri/src/proofbook/types.rs        # serde schema types
src-tauri/src/proofbook/errors.rs       # ProofbookError / ProofbookErrorCode
src-tauri/src/proofbook/parser.rs       # discovery + YAML parse
src-tauri/src/proofbook/validator.rs    # static validation (15 codes)
src-tauri/src/ipc/proofbook_commands.rs # list_proofbooks / validate_proofbook (pure, no state)
```

Edit only these for wiring:

```
src-tauri/src/lib.rs                     # add module decl + invoke_handler entries
src-tauri/src/ipc/mod.rs                 # add `mod` + `pub use`
```

Explicitly **not** touched in PB-1: `runner.rs`, `ledger.rs`, `agent_step.rs`,
`settlement.rs`, `distill.rs`, `evidence_store.rs`, `src-tauri/src/api/mcp.rs`,
any `src/features/proofbook/*` UI, DB migrations, and any `.manage(...)` state
registration.

---

## 3. `mod.rs`

Mirror the workflow module convention (private `mod`, explicit `pub use`).

```rust
// src-tauri/src/proofbook/mod.rs
mod errors;
mod parser;
mod types;
mod validator;

pub use errors::{ProofbookError, ProofbookErrorCode};
pub use parser::{list_proofbook_files, parse_proofbook};
pub use types::{
    ProofbookDefinition, ProofbookInputSpec, ProofbookSecretRef, ProofbookSettlement,
    ProofbookStep, ProofbookStepKind, ProofbookSummary, ProofbookValidationReport,
    PROOFBOOK_SCHEMA_V1,
};
pub use validator::validate_definition;
```

`mod.rs` must not own Tauri state, MCP catalog registration, process spawning,
command-risk policy, or UI DTOs.

---

## 4. `types.rs`

Conventions locked in: `#[derive(Debug, Clone, Serialize, Deserialize)]` on
schema structs; `#[serde(rename_all = "camelCase")]` at container level (the
Proofbook YAML vocabulary is camelCase); `#[serde(default)]` for optional
fields; `kind` kept as `String` for `unknown_step_type` resolution.

```rust
// src-tauri/src/proofbook/types.rs
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PROOFBOOK_SCHEMA_V1: &str = "aelyris.proofbook.v1";

/// Parsed, not-yet-validated definition. Field names mirror the documented
/// camelCase YAML in PROOFBOOK_AUTOMATION_SPEC.md §4.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookDefinition {
    pub schema: String,
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, ProofbookInputSpec>,
    #[serde(default)]
    pub secrets: BTreeMap<String, ProofbookSecretRef>,
    #[serde(default)]
    pub steps: Vec<ProofbookStep>,
    #[serde(default)]
    pub settlement: Option<ProofbookSettlement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookInputSpec {
    #[serde(rename = "type", default)]
    pub input_type: String,
    #[serde(default)]
    pub default: Option<serde_yaml::Value>,
    #[serde(default)]
    pub required: bool,
}

/// A secret is always a *reference*. An inline `value:` is a validation error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSecretRef {
    #[serde(default)]
    pub provider: Option<String>, // "os" | "env" | "keychain" ...
    #[serde(default)]
    pub key: Option<String>,
    /// Presence here => invalid_secret_ref. Modeled so the validator can detect it.
    #[serde(default)]
    pub value: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookStep {
    pub id: String,
    /// Raw wire kind ("shell" | "mcpTool" | "evidence.write" | ...). Kept as
    /// String (not an enum) so an unknown value yields `unknown_step_type`
    /// during validation rather than a generic `yaml_parse_error`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Kind-specific fields (command/url/tool/prompt/...) are captured
    /// permissively in PB-1 and typed+validated in each field's owning PB phase.
    #[serde(flatten)]
    pub params: BTreeMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSettlement {
    #[serde(default)]
    pub required_steps: Vec<String>,
    #[serde(default)]
    pub required_artifacts: Vec<String>,
}

/// Closed step taxonomy. `from_wire` is the single source of truth for
/// `unknown_step_type`. Serde renames are declared for round-trip fidelity, but
/// validation resolves via `from_wire` on the parsed String.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProofbookStepKind {
    Shell,
    Verifier,
    McpTool,
    AgentSession,
    Http,
    ManualGate,
    WaitFor,
    FanOut,
    SubProofbook,
    #[serde(rename = "evidence.write")]
    EvidenceWrite,
    #[serde(rename = "evidence.read")]
    EvidenceRead,
}

impl ProofbookStepKind {
    pub fn from_wire(s: &str) -> Option<Self> {
        Some(match s {
            "shell" => Self::Shell,
            "verifier" => Self::Verifier,
            "mcpTool" => Self::McpTool,
            "agentSession" => Self::AgentSession,
            "http" => Self::Http,
            "manualGate" => Self::ManualGate,
            "waitFor" => Self::WaitFor,
            "fanOut" => Self::FanOut,
            "subProofbook" => Self::SubProofbook,
            "evidence.write" => Self::EvidenceWrite,
            "evidence.read" => Self::EvidenceRead,
            _ => return None,
        })
    }
}

/// Serialize-only lightweight list DTO (mirrors WorkflowSummary).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSummary {
    pub id: String,
    pub title: String,
    pub path: String,
    pub step_count: usize,
    pub valid: bool,
    pub error_count: usize,
}

/// Serialize-only validation report returned by IPC.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookValidationReport {
    pub definition_id: Option<String>,
    pub path: String,
    pub valid: bool,
    pub errors: Vec<crate::proofbook::ProofbookError>,
}
```

**`#[serde(flatten)]` caveat:** flatten into `BTreeMap<String, serde_yaml::Value>`
is the intended approach. If `serde_yaml_ng` flatten proves fragile in tests,
fall back to deserializing each step as `serde_yaml::Value`, extract `id`/`type`
explicitly, and keep the remaining map as `params`. Decide during
implementation; either way `params` stays untyped in PB-1.

---

## 5. `errors.rs`

Struct-carrying-a-stable-code shape (from `api/mod.rs` `ApiError`), with
`thiserror` + `Serialize` so IPC returns it directly. `PartialEq, Eq` so tests
can `assert_eq!` on the code.

```rust
// src-tauri/src/proofbook/errors.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofbookErrorCode {
    InvalidProjectPath,
    PathOutsideProject,
    ProofbookDirMissing,
    IoError,
    YamlParseError,
    UnsupportedSchemaVersion,
    MissingRequiredField,
    InvalidIdentifier,
    DuplicateId,
    UnknownStepType,
    MissingDependency,
    CycleDetected,
    MissingSettlement,
    InvalidSecretRef,
    RuntimeNotAvailable,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq, Serialize, Deserialize)]
#[error("{code:?}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct ProofbookError {
    pub code: ProofbookErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub path: Option<String>,
}

impl ProofbookError {
    pub fn new(code: ProofbookErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), definition_id: None, step_id: None, field: None, path: None }
    }
    pub fn with_definition(mut self, id: impl Into<String>) -> Self { self.definition_id = Some(id.into()); self }
    pub fn with_step(mut self, id: impl Into<String>) -> Self { self.step_id = Some(id.into()); self }
    pub fn with_field(mut self, f: impl Into<String>) -> Self { self.field = Some(f.into()); self }
    pub fn with_path(mut self, p: impl Into<String>) -> Self { self.path = Some(p.into()); self }

    /// For future execution adapters; PB-1 registers no execution command.
    pub fn runtime_not_available(op: &str) -> Self {
        Self::new(ProofbookErrorCode::RuntimeNotAvailable,
            format!("Proofbook runtime is not available in this build: {op}"))
    }
}

/// Bridge so a command may keep `Result<_, String>` if desired; preferred path
/// is returning `ProofbookError` directly (Tauri serializes any `Serialize`).
impl From<ProofbookError> for String {
    fn from(e: ProofbookError) -> Self { e.to_string() }
}
```

Wire codes are the stable API. Callers/tests match on `code`; `message` is
diagnostic only. The `#[serde(rename_all="snake_case")]` on the code enum makes
it serialize to exactly the strings the verifier greps for (`invalid_project_path`,
`runtime_not_available`, ...).

---

## 6. `parser.rs`

Discovery + parse only. No secret resolution, no execution, no run artifacts.

```rust
// src-tauri/src/proofbook/parser.rs
use std::path::Path;
use crate::proofbook::{ProofbookDefinition, ProofbookError, ProofbookErrorCode, ProofbookSummary};

/// Tolerant discovery (mirrors list_workflow_files): missing dir => empty vec.
/// Each file is parsed+validated; the summary carries valid/error_count.
pub fn list_proofbook_files(project_path: &str) -> Vec<ProofbookSummary> {
    let dir = Path::new(project_path).join(".aelyris").join("proofbooks");
    if !dir.exists() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else { return out; };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_pb = path.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".proofbook.yaml") || n.ends_with(".proofbook.yml"))
            .unwrap_or(false);
        if !is_pb { continue; }
        let path_str = path.to_string_lossy().replace('\\', "/");
        match parse_proofbook(&path_str) {
            Ok(def) => {
                let report = crate::proofbook::validate_definition(project_path, &def, &path_str);
                out.push(ProofbookSummary {
                    id: def.id.clone(),
                    title: def.title.clone(),
                    path: path_str,
                    step_count: def.steps.len(),
                    valid: report.valid,
                    error_count: report.errors.len(),
                });
            }
            Err(e) => out.push(ProofbookSummary {
                id: String::new(),
                title: String::new(),
                path: path_str,
                step_count: 0,
                valid: false,
                error_count: 1,
            }.tap_error(e)), // pseudo: see note
        }
    }
    out
}

/// Read + deserialize one definition. Maps IO/YAML failures to typed errors.
pub fn parse_proofbook(path: &str) -> Result<ProofbookDefinition, ProofbookError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        ProofbookError::new(ProofbookErrorCode::IoError, format!("cannot read proofbook: {e}"))
            .with_path(path)
    })?;
    serde_yaml::from_str::<ProofbookDefinition>(&content).map_err(|e| {
        ProofbookError::new(ProofbookErrorCode::YamlParseError, format!("cannot parse proofbook YAML: {e}"))
            .with_path(path)
    })
}
```

Note: the `tap_error` call above is pseudocode to keep the sketch short — in
real code, just build the `ProofbookSummary` with the error already folded in
(there is no `tap_error`). Import name is `serde_yaml` (resolves to
`serde_yaml_ng` 0.10 via the Cargo alias) — do **not** write `serde_yml`.

---

## 7. `validator.rs`

Static validation. **Collect all errors** (do not fail-fast) so the operator
sees every problem in one report. `valid = errors.is_empty()`.

```rust
pub fn validate_definition(
    project_path: &str,
    def: &ProofbookDefinition,
    path: &str,
) -> ProofbookValidationReport
```

Check order and rule → code mapping:

| # | Check | Code on failure |
| --- | --- | --- |
| 1 | `project_path` canonicalizes to an existing directory | `invalid_project_path` |
| 2 | `path` (and any artifact paths) canonicalize under project root (`canonicalize` + `starts_with`) | `path_outside_project` |
| 3 | `def.schema == "aelyris.proofbook.v1"` | `unsupported_schema_version` |
| 4 | `def.id` present and non-empty; `steps` non-empty; `settlement` present | `missing_required_field` |
| 5 | `def.id` and every `step.id` match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` | `invalid_identifier` |
| 6 | step ids, input keys, secret keys are each unique | `duplicate_id` |
| 7 | every `step.kind` resolves via `ProofbookStepKind::from_wire` | `unknown_step_type` |
| 8 | every `dependsOn` entry references an existing step id | `missing_dependency` |
| 9 | the `dependsOn` graph is acyclic (DFS three-color / Kahn) | `cycle_detected` |
| 10 | settlement has ≥1 `requiredSteps` **or** ≥1 `requiredArtifacts`; every `requiredSteps` id exists | `missing_settlement` |
| 11 | no secret has an inline `value:`; no token-like literal (best-effort regex) | `invalid_secret_ref` |

Notes:

- `proofbook_dir_missing` is emitted by the **validate-by-id / read** path when
  `.aelyris/proofbooks` is absent. The `list` path stays tolerant (empty vec).
- `io_error` / `yaml_parse_error` originate in `parse_proofbook`, so they appear
  in a report only when `validate_proofbook` (IPC) parses a file and folds the
  parse error into the report (see §8).
- `runtime_not_available` is never produced by the validator; it exists for the
  no-runner boundary (§8) and a serialization test.
- Cycle detection: build `id -> Vec<dep>` adjacency; DFS with
  White/Grey/Black marks; a Grey→Grey edge is a cycle. Report the first cycle;
  attach the offending `step_id`.
- Path containment helper mirrors `term/command_risk/mod.rs`:
  `let root = fs::canonicalize(project_path)?; let cand = fs::canonicalize(p)?;
  if !cand.starts_with(&root) { path_outside_project }`. Guard the
  `canonicalize` error → `invalid_project_path` / `io_error` as appropriate.

---

## 8. `ipc/proofbook_commands.rs` — pure commands, no state

Model on the stateless `list_workflows` (no `AppHandle`, no `app.state`).

```rust
// src-tauri/src/ipc/proofbook_commands.rs
use crate::proofbook::{
    self, ProofbookError, ProofbookErrorCode, ProofbookSummary, ProofbookValidationReport,
};

/// Tolerant list (mirrors list_workflows). Never errors.
#[tauri::command]
pub fn list_proofbooks(project_path: String) -> Vec<ProofbookSummary> {
    proofbook::list_proofbook_files(&project_path)
}

/// Parse + validate a single definition. Definition-level problems are returned
/// inside the report (valid=false, errors=[...]); only caller/security failures
/// (bad project root, path escape) return Err.
#[tauri::command]
pub fn validate_proofbook(
    project_path: String,
    proofbook_path: String,
) -> Result<ProofbookValidationReport, ProofbookError> {
    // Security boundary first.
    // (canonicalize project_path -> invalid_project_path; ensure proofbook_path within -> path_outside_project)

    match proofbook::parse_proofbook(&proofbook_path) {
        Ok(def) => Ok(proofbook::validate_definition(&project_path, &def, &proofbook_path)),
        Err(parse_err) => Ok(ProofbookValidationReport {
            definition_id: None,
            path: proofbook_path,
            valid: false,
            errors: vec![parse_err],
        }),
    }
}
```

**No execution commands are registered.** `run` / `resume` / `cancel` /
`approve_gate` / `reject_gate` / `create` / `update` / `distill` do not exist in
PB-1. `ProofbookError::runtime_not_available` exists only for future adapters and
is covered by a serialization test.

### 8.1 Exact registration edits (3)

1. `src-tauri/src/ipc/mod.rs` — add the submodule + glob re-export (alphabetical):
   ```rust
   mod proofbook_commands;
   // ...
   pub use proofbook_commands::*;
   ```
   (`#[tauri::command]` fns must be `pub`.)

2. `src-tauri/src/lib.rs` — add the module declaration alongside the other
   top-level `mod`s, then add to the `invoke_handler![...]` list, right after the
   workflow block (which ends at `ipc::workflow_remove,`):
   ```rust
   mod proofbook; // near the other module declarations

   // ...inside tauri::generate_handler![ ... ]
               // Proofbook (PB-1: schema/parser/validator only, no runner)
               ipc::list_proofbooks,
               ipc::validate_proofbook,
   ```

3. **No `.manage(...)`.** Unlike `WorkflowExecutor`, PB-1 holds no runtime state.

---

## 9. Focused Rust test matrix

`#[cfg(test)] mod tests` inside `types.rs` (inline-YAML), `validator.rs`
(rule coverage), `parser.rs` (tempdir discovery). `tempfile` is already a dep.

Run: `cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib`

1. valid minimal `.proofbook.yaml` parses and validates (report.valid == true).
2. `ProofbookStepKind` round-trips: `evidence.write` ⇄ `EvidenceWrite`,
   `mcpTool` ⇄ `McpTool` (serde wire-format lock).
3. `.proofbook.yml` and `.proofbook.yaml` both discovered; non-matching files
   ignored; discovery stays under `.aelyris/proofbooks` (tempdir).
4. `unsupported_schema_version` when `schema` absent or wrong.
5. `unknown_step_type` for `type: bogus` (well-formed YAML, unknown kind).
6. `duplicate_id` for repeated step / input / secret id.
7. `missing_dependency` when `dependsOn` names a missing step.
8. `cycle_detected` for `a -> b -> a`.
9. `missing_settlement` when settlement absent or has no required target;
   and when `requiredSteps` names a nonexistent step.
10. `invalid_identifier` for an id with a space / leading dash / >64 chars.
11. `invalid_secret_ref` for an inline `value:` secret.
12. `path_outside_project` for a `../` escape; `invalid_project_path` for a
    nonexistent project root.
13. `runtime_not_available` code constructs and serializes to
    `"runtime_not_available"` (no-runner boundary).
14. `ProofbookValidationReport` and `ProofbookError` serialize with camelCase
    keys and omit `None` optional fields.

---

## 10. Verifier / artifact expectations

- The doc gate `pnpm verify:proofbook:spec` already contains the
  `spec-pb1d-detailed-design` check over `PROOFBOOK_AUTOMATION_SPEC.md` (asserts
  the 15 error codes, module paths, and the `cargo test ... proofbook --lib`
  clause). This blueprint is a companion; if it should also be gated, add a
  presence check for `docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md` and a one-line
  reference from the main spec + `docs/specs/README.md` (small follow-up, not
  PB-1 code).
- PB-1 implementation adds the Rust tests above and must pass
  `cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib`.
- PB-1 must **not** add any success artifact implying Proofbooks can run. Any new
  verifier artifact describes schema/parser/validator readiness only.

Keep the separation: the `.mjs` verifier asserts the *design doc*; actual code
existence/behavior is proven by `cargo test`.

---

## 11. Ready-to-run PB-1 `/goal` (refined)

Supersedes the generic PB-1 packet in `PROOFBOOK_AUTOMATION_SPEC.md` §12 by
folding in the review deltas. PB-1D is already documented, so this goes straight
to PB-1 code.

```text
/goal C:\Users\owner\Aether_Terminal で Proofbook PB-1 (schema/parser/validator + list/validate IPC, ランナー無し) を実装する。
読み順: AGENTS.md -> docs/specs/PROOFBOOK_AUTOMATION_SPEC.md -> docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md -> src-tauri/src/workflow/{types,parser}.rs -> src-tauri/src/ipc/workflow_commands.rs -> src-tauri/src/lib.rs。
対象は PROOFBOOK_PB1_DETAILED_DESIGN.md §2 のファイルのみ: src-tauri/src/proofbook/{mod,types,errors,parser,validator}.rs, src-tauri/src/ipc/proofbook_commands.rs, および wiring として src-tauri/src/ipc/mod.rs と src-tauri/src/lib.rs。
ProofbookError は thiserror + Serialize、ProofbookErrorCode は snake_case enum。schema struct は rename_all=camelCase。step.kind は String で保持し validator で from_wire 解決して unknown_step_type を出す。path 封じ込めは canonicalize+starts_with。runner/ledger/MCP/UI/.manage は作らない。実行系コマンドは登録しない (runtime_not_available)。
§9 の test matrix を実装し cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib を通す。Proofbooks を実装済みと主張しない。明示stage、one phase = one commit、push/PR/force push 禁止。
```

---

## 12. Stop conditions (PB-1)

Stop and ask before continuing if:

- The schema/validator needs to execute anything (shell/MCP/HTTP/agent) to
  validate — it must not.
- A `src/features/proofbook` panel is about to render an executable/mock flow.
- The parser needs to resolve secrets or write any run artifact.
- `serde(flatten)` on `params` forces dropping typed `id`/`kind` — fall back to
  the `serde_yaml::Value` extraction path (§4) instead of weakening the schema.
- The design must change: update this doc + the main spec + the verifier in the
  same phase before claiming PB-1 complete.
