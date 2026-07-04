mod agent_step;
mod errors;
mod ledger;
mod parser;
mod runner;
mod step_manual_gate;
mod step_shell;
mod step_wait;
mod types;
pub(crate) mod validator;

pub use agent_step::{
    ProofbookAgentSessionCompletionProof, ProofbookAgentSessionExecutor,
    ProofbookAgentSessionRequest, ProofbookAgentSessionSpawn,
};
pub use errors::{ProofbookError, ProofbookErrorCode};
pub use ledger::{
    hash_json, normalize_path, ProofbookArtifactRef, ProofbookGateDecision,
    ProofbookResidualBlocker, ProofbookRunError, ProofbookRunEvent, ProofbookRunLedger,
    ProofbookRunStatus, ProofbookStepOutcome, ProofbookStepStatus, PROOFBOOK_RUN_SCHEMA_V1,
};
pub use parser::{list_proofbook_files, parse_proofbook};
pub use runner::{ProofbookMcpToolExecutor, ProofbookRunner};
pub use types::{
    ProofbookDefinition, ProofbookInputSpec, ProofbookSecretRef, ProofbookSettlement,
    ProofbookStep, ProofbookStepKind, ProofbookSummary, ProofbookValidationReport,
    PROOFBOOK_SCHEMA_V1,
};
pub use validator::validate_definition;
