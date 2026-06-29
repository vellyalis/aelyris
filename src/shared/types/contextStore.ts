/**
 * Context Store decision change — TS mirror of the Rust `DecisionChange`
 * (`src-tauri/src/context_store/mod.rs`), the `DECISION_CHANGED` payload.
 * See docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
 * Requirement 6.
 */
export interface DecisionChange {
  key: string;
  /** Value before the change (absent for a brand-new decision). */
  previous?: string | null;
  /** Value after the change (absent when the decision was removed). */
  value?: string | null;
}
