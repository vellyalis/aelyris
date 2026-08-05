import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Ban,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type {
  ProofbookAgentSessionSettlementCandidate,
  ProofbookArtifactPreview,
  ProofbookArtifactRef,
  ProofbookManualGateOutput,
  ProofbookRunLedger,
  ProofbookRunStatus,
  ProofbookStepSummary,
  ProofbookStringInputField,
  ProofbookSummary,
  ProofbookValidationReport,
} from "../../shared/types/proofbook";
import { ProofbookAgentSessionSettlement } from "./ProofbookAgentSessionSettlement";
import { ProofbookEvidenceInspector } from "./ProofbookEvidenceInspector";
import styles from "./ProofbookPanel.module.css";
import { proofbookErrorCode as errorCode, proofbookErrorMessage as errorMessage } from "./proofbookUiError";
import { useProofbookAgentSessionSettlement } from "./useProofbookAgentSessionSettlement";

interface ProofbookPanelProps {
  readonly projectPath: string;
}

type ManualGateDecision = "approve" | "reject";

interface ManualGateView {
  readonly key: string;
  readonly runId: string;
  readonly proofbookId: string;
  readonly stepId: string;
  readonly prompt: ProofbookManualGateOutput;
  readonly resolvable: boolean;
}

const RUN_STATUS_LABEL: Record<ProofbookRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  waiting_gate: "Waiting gate",
  passed: "Passed",
  failed: "Failed",
  "blocked-by-policy": "Policy blocked",
  "blocked-by-external-gates": "External gate",
  cancelled: "Cancelled",
};

function normalizedPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function basename(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function manualGateOutput(step: ProofbookStepSummary): ProofbookManualGateOutput | null {
  if (step.status !== "waiting_gate") return null;
  const output = asRecord(step.structuredOutput);
  if (!output || output.kind !== "manualGate") return null;
  const gateId = typeof output.gateId === "string" ? output.gateId.trim() : "";
  const gateHash = typeof output.gateHash === "string" ? output.gateHash.trim() : "";
  const options = Array.isArray(output.options)
    ? output.options.filter((option): option is string => typeof option === "string").map((option) => option.trim())
    : [];
  const defaultOption = typeof output.default === "string" ? output.default.trim() : "";
  const risk = typeof output.risk === "string" ? output.risk.trim() : "";
  const evidence = typeof output.evidence === "string" ? output.evidence.trim() : "";
  if (!gateId || !gateHash || options.length === 0 || !defaultOption || !risk) return null;
  return {
    gateId,
    gateHash,
    kind: "manualGate",
    options,
    default: defaultOption,
    risk,
    evidence,
  };
}

function manualGates(runs: readonly ProofbookRunLedger[]): ManualGateView[] {
  return runs.flatMap((run) => {
    if (run.status !== "waiting_gate") return [];
    return run.steps.flatMap((step) => {
      const prompt = manualGateOutput(step);
      if (!prompt) return [];
      const normalizedOptions = new Set(prompt.options.map((option) => option.toLowerCase()));
      return [
        {
          key: `${run.runId}:${step.stepId}:${prompt.gateHash}`,
          runId: run.runId,
          proofbookId: run.proofbookId,
          stepId: step.stepId,
          prompt,
          resolvable: normalizedOptions.has("approve") && normalizedOptions.has("reject"),
        },
      ];
    });
  });
}

function sortedRuns(runs: readonly ProofbookRunLedger[]): ProofbookRunLedger[] {
  return [...runs].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    return right.runId.localeCompare(left.runId);
  });
}

function formatUpdatedAt(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function isCancellableRunStatus(status: ProofbookRunStatus): boolean {
  return status === "pending" || status === "running" || status === "waiting_gate";
}

function isRunnerOwnedPreviewCandidate(runId: string, artifact: ProofbookArtifactRef): boolean {
  const path = normalizedPath(artifact.path);
  const prefix = `.aelyris/proofbook-runs/artifacts/${runId.toLowerCase()}/`;
  return path.startsWith(prefix) && path.endsWith(".txt");
}

function inputDraftFor(fields: readonly ProofbookStringInputField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? ""]));
}

function submittedStringInputs(
  fields: readonly ProofbookStringInputField[],
  draft: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = draft[field.key] ?? "";
      return field.required || field.defaultValue != null || value.length > 0 ? [[field.key, value]] : [];
    }),
  );
}

function runningAgentSessionSteps(run: ProofbookRunLedger): ProofbookStepSummary[] {
  return run.steps.filter((step) => step.kind === "agentSession" && step.status === "running");
}

function settlementKey(run: ProofbookRunLedger, step: ProofbookStepSummary): string {
  return `${run.runId}:${step.stepId}:${run.revision}`;
}

function candidateMatches(
  candidate: ProofbookAgentSessionSettlementCandidate | null,
  run: ProofbookRunLedger,
  step: ProofbookStepSummary,
): candidate is ProofbookAgentSessionSettlementCandidate {
  return Boolean(
    candidate &&
      candidate.runId === run.runId &&
      candidate.stepId === step.stepId &&
      candidate.ledgerRevision === run.revision,
  );
}

export function ProofbookPanel({ projectPath }: ProofbookPanelProps) {
  const [definitions, setDefinitions] = useState<ProofbookSummary[]>([]);
  const [runs, setRuns] = useState<ProofbookRunLedger[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [validation, setValidation] = useState<ProofbookValidationReport | null>(null);
  const [inputDraft, setInputDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [startStatus, setStartStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const resolvingGateRef = useRef<string | null>(null);
  const [resolvingGateKey, setResolvingGateKey] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<{ tone: "success" | "warn" | "error"; text: string } | null>(null);
  const cancellingRunRef = useRef<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const previewingArtifactRef = useRef<string | null>(null);
  const [previewingArtifactKey, setPreviewingArtifactKey] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ProofbookArtifactPreview | null>(null);
  const [artifactStatus, setArtifactStatus] = useState<string | null>(null);
  const [expandedEvidenceRunId, setExpandedEvidenceRunId] = useState<string | null>(null);
  const settlementResetRef = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    if (!projectPath || !isTauriRuntime()) {
      setDefinitions([]);
      setRuns([]);
      setSelectedPath(null);
      return;
    }

    setLoading(true);
    setError(null);
    setValidation(null);
    setInputDraft({});
    setStartStatus(null);
    setGateStatus(null);
    setCancelStatus(null);
    setArtifactPreview(null);
    setArtifactStatus(null);
    setExpandedEvidenceRunId(null);
    settlementResetRef.current();
    try {
      const [catalog, history] = await Promise.all([
        invoke<ProofbookSummary[]>("list_proofbooks", { projectPath }),
        invoke<ProofbookRunLedger[]>("list_proofbook_runs", { projectPath }),
      ]);
      setDefinitions(catalog);
      setRuns(sortedRuns(history));
      setSelectedPath((current) =>
        current && catalog.some((definition) => definition.path === current) ? current : (catalog[0]?.path ?? null),
      );
    } catch (cause) {
      setError(`Could not read Proofbooks: ${errorMessage(cause)}`);
      reportInvokeFailure({ source: "proofbooks", operation: "list", err: cause, userVisible: true });
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const applyRunLedger = useCallback((ledger: ProofbookRunLedger) => {
    setRuns((current) => sortedRuns([ledger, ...current.filter((run) => run.runId !== ledger.runId)]));
  }, []);

  const isOtherEffectActive = useCallback(
    () =>
      Boolean(
        startingRef.current || resolvingGateRef.current || cancellingRunRef.current || previewingArtifactRef.current,
      ),
    [],
  );

  const settlement = useProofbookAgentSessionSettlement({
    projectPath,
    refresh,
    onLedger: applyRunLedger,
    isOtherEffectActive,
  });
  settlementResetRef.current = settlement.reset;

  useEffect(() => {
    setDefinitions([]);
    setRuns([]);
    setSelectedPath(null);
    setValidation(null);
    setInputDraft({});
    setError(null);
    setStartStatus(null);
    setGateStatus(null);
    setCancelStatus(null);
    setArtifactPreview(null);
    setArtifactStatus(null);
    setExpandedEvidenceRunId(null);
    settlementResetRef.current();
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectPath || !isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    const projectIdentity = normalizedPath(projectPath);

    void listen<ProofbookRunLedger>("proofbook-updated", (event) => {
      if (cancelled || normalizedPath(event.payload.projectPath) !== projectIdentity) return;
      setRuns((current) => sortedRuns([event.payload, ...current.filter((run) => run.runId !== event.payload.runId)]));
      settlement.reconcileLedger(event.payload);
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else unlisten = unsubscribe;
      })
      .catch((cause) => {
        reportInvokeFailure({
          source: "proofbooks",
          operation: "listen:proofbook-updated",
          err: cause,
          userVisible: false,
        });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectPath, settlement.reconcileLedger]);

  const selected = useMemo(
    () => definitions.find((definition) => definition.path === selectedPath) ?? null,
    [definitions, selectedPath],
  );

  const pendingManualGates = useMemo(() => manualGates(runs), [runs]);
  const startAdmission = useMemo(() => {
    if (!selected || !validation || normalizedPath(validation.path) !== normalizedPath(selected.path)) return null;
    return validation.startAdmission;
  }, [selected, validation]);
  const stringInputs = startAdmission?.stringInputs ?? [];
  const submittedInputs = useMemo(() => submittedStringInputs(stringInputs, inputDraft), [inputDraft, stringInputs]);

  const validateSelected = useCallback(async () => {
    if (!selected || validating) return;
    setValidating(true);
    setValidation(null);
    setStartStatus(null);
    setError(null);
    try {
      const report = await invoke<ProofbookValidationReport>("validate_proofbook", {
        projectPath,
        proofbookPath: selected.path,
      });
      setValidation(report);
      setInputDraft(inputDraftFor(report.startAdmission.stringInputs));
    } catch (cause) {
      setError(`Could not validate ${basename(selected.path)}: ${errorMessage(cause)}`);
      reportInvokeFailure({ source: "proofbooks", operation: "validate", err: cause, userVisible: true });
    } finally {
      setValidating(false);
    }
  }, [projectPath, selected, validating]);

  const startSelected = useCallback(async () => {
    if (
      startingRef.current ||
      resolvingGateRef.current ||
      cancellingRunRef.current ||
      previewingArtifactRef.current ||
      settlement.isBusy() ||
      !selected ||
      !startAdmission?.eligible ||
      !startAdmission.definitionHash
    ) {
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setStartStatus(null);
    setError(null);
    try {
      const hasStringInputs = startAdmission.stringInputs.length > 0;
      const ledger = await invoke<ProofbookRunLedger>(
        hasStringInputs ? "start_string_input_proofbook_run" : "start_input_free_proofbook_run",
        {
          projectPath,
          proofbookPath: selected.path,
          expectedDefinitionHash: startAdmission.definitionHash,
          ...(hasStringInputs ? { inputs: submittedInputs } : {}),
        },
      );
      setRuns((current) => sortedRuns([ledger, ...current.filter((run) => run.runId !== ledger.runId)]));
      setStartStatus({
        tone: "success",
        text: `Started ${ledger.proofbookId}; durable run ${ledger.runId} is ${RUN_STATUS_LABEL[ledger.status].toLowerCase()}.`,
      });
    } catch (cause) {
      if (errorCode(cause) === "stale_definition_hash") {
        await refresh();
        setStartStatus({
          tone: "error",
          text: `${basename(selected.path)} changed after validation. Validate the current definition before starting.`,
        });
      } else {
        setStartStatus({
          tone: "error",
          text: `Could not start ${basename(selected.path)}: ${errorMessage(cause)}`,
        });
      }
      reportInvokeFailure({
        source: "proofbooks",
        operation: startAdmission.stringInputs.length > 0 ? "start_string_inputs" : "start_input_free",
        err: cause,
        userVisible: true,
      });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [projectPath, refresh, selected, settlement.isBusy, startAdmission, submittedInputs]);

  const resolveManualGate = useCallback(
    async (gate: ManualGateView, decision: ManualGateDecision) => {
      if (
        resolvingGateRef.current ||
        startingRef.current ||
        cancellingRunRef.current ||
        previewingArtifactRef.current ||
        settlement.isBusy() ||
        !gate.resolvable
      ) {
        return;
      }
      resolvingGateRef.current = gate.key;
      setResolvingGateKey(gate.key);
      setGateStatus(null);
      setError(null);
      try {
        const ledger = await invoke<ProofbookRunLedger>("resolve_proofbook_manual_gate", {
          projectPath,
          runId: gate.runId,
          gateId: gate.prompt.gateId,
          gateHash: gate.prompt.gateHash,
          decision,
          actor: "cockpit-operator",
          comment: null,
        });
        setRuns((current) => sortedRuns([ledger, ...current.filter((run) => run.runId !== ledger.runId)]));
        setGateStatus({
          tone: decision === "approve" ? "success" : "warn",
          text:
            decision === "approve"
              ? `Approved ${gate.prompt.gateId}; the durable runner continued from the matching gate hash.`
              : `Rejected ${gate.prompt.gateId}; the durable run recorded the operator decision.`,
        });
      } catch (cause) {
        const code = errorCode(cause);
        if (code === "stale_gate_hash" || code === "run_not_found") {
          await refresh();
          setGateStatus({
            tone: "error",
            text: `Gate ${gate.prompt.gateId} changed before delivery. Run history was refreshed; review the current evidence before deciding.`,
          });
        } else {
          setGateStatus({
            tone: "error",
            text: `Could not ${decision} ${gate.prompt.gateId}: ${errorMessage(cause)}`,
          });
        }
        reportInvokeFailure({
          source: "proofbooks",
          operation: `manual_gate:${decision}`,
          err: cause,
          userVisible: true,
        });
      } finally {
        resolvingGateRef.current = null;
        setResolvingGateKey(null);
      }
    },
    [projectPath, refresh, settlement.isBusy],
  );

  const cancelCurrentRun = useCallback(
    async (run: ProofbookRunLedger) => {
      if (
        cancellingRunRef.current ||
        startingRef.current ||
        resolvingGateRef.current ||
        previewingArtifactRef.current ||
        settlement.isBusy() ||
        !isCancellableRunStatus(run.status)
      ) {
        return;
      }
      cancellingRunRef.current = run.runId;
      setCancellingRunId(run.runId);
      setCancelStatus(null);
      setError(null);
      try {
        const ledger = await invoke<ProofbookRunLedger>("cancel_current_proofbook_run", {
          projectPath,
          runId: run.runId,
          expectedRevision: run.revision,
        });
        setRuns((current) => sortedRuns([ledger, ...current.filter((entry) => entry.runId !== ledger.runId)]));
        setCancelStatus({
          tone: "success",
          text: `Marked ${run.runId} cancelled in durable Proofbook state at revision ${ledger.revision}. External process termination is not claimed.`,
        });
      } catch (cause) {
        const code = errorCode(cause);
        if (code === "stale_ledger_revision" || code === "run_not_found" || code === "run_not_cancellable") {
          await refresh();
          setCancelStatus({
            tone: "error",
            text: `Run ${run.runId} changed before cancellation. Durable history was refreshed; review the current status and revision.`,
          });
        } else {
          setCancelStatus({
            tone: "error",
            text: `Could not cancel ${run.runId}: ${errorMessage(cause)}`,
          });
        }
        reportInvokeFailure({ source: "proofbooks", operation: "cancel_current", err: cause, userVisible: true });
      } finally {
        cancellingRunRef.current = null;
        setCancellingRunId(null);
      }
    },
    [projectPath, refresh, settlement.isBusy],
  );

  const previewArtifact = useCallback(
    async (run: ProofbookRunLedger, artifact: ProofbookArtifactRef) => {
      const key = `${run.runId}:${artifact.id}:${run.revision}`;
      if (
        previewingArtifactRef.current ||
        startingRef.current ||
        resolvingGateRef.current ||
        cancellingRunRef.current ||
        settlement.isBusy() ||
        !isRunnerOwnedPreviewCandidate(run.runId, artifact)
      ) {
        return;
      }
      previewingArtifactRef.current = key;
      setPreviewingArtifactKey(key);
      setArtifactStatus(null);
      setError(null);
      try {
        const preview = await invoke<ProofbookArtifactPreview>("preview_current_proofbook_artifact", {
          projectPath,
          runId: run.runId,
          artifactId: artifact.id,
          expectedRevision: run.revision,
        });
        setArtifactPreview(preview);
      } catch (cause) {
        const code = errorCode(cause);
        if (code === "stale_ledger_revision" || code === "run_not_found" || code === "artifact_not_found") {
          await refresh();
          setArtifactStatus(
            `Artifact ${artifact.id} changed or disappeared before preview. Durable history was refreshed.`,
          );
        } else {
          setArtifactStatus(`Could not preview ${artifact.id}: ${errorMessage(cause)}`);
        }
        reportInvokeFailure({ source: "proofbooks", operation: "preview_artifact", err: cause, userVisible: true });
      } finally {
        previewingArtifactRef.current = null;
        setPreviewingArtifactKey(null);
      }
    },
    [projectPath, refresh, settlement.isBusy],
  );

  const effectLocked =
    starting ||
    resolvingGateKey !== null ||
    cancellingRunId !== null ||
    previewingArtifactKey !== null ||
    settlement.checkingKey !== null ||
    settlement.settlingKey !== null;

  return (
    <section className={styles.panel} aria-label="Proofbooks">
      <div className={styles.toolbar}>
        <span className={styles.mode}>
          <ShieldCheck size={12} aria-hidden="true" />
          Catalog + governed effects
        </span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh Proofbooks"
        >
          <RefreshCw size={13} aria-hidden="true" className={loading ? styles.spinning : undefined} />
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {definitions.length === 0 ? (
        <p className={styles.empty}>
          {loading ? "Reading .aelyris/proofbooks…" : "No Proofbook definitions found for this project."}
        </p>
      ) : (
        <div className={styles.catalog}>
          <div className={styles.sectionHeading}>
            <BookOpenCheck size={12} aria-hidden="true" />
            <span>Definitions</span>
            <strong>{definitions.length}</strong>
          </div>
          <div className={styles.definitionList}>
            {definitions.map((definition) => (
              <button
                key={definition.path}
                type="button"
                className={styles.definition}
                data-selected={definition.path === selectedPath || undefined}
                data-valid={definition.valid}
                aria-pressed={definition.path === selectedPath}
                onClick={() => {
                  setSelectedPath(definition.path);
                  setValidation(null);
                  setInputDraft({});
                }}
                title={`${definition.id} · ${basename(definition.path)}`}
              >
                <span className={styles.definitionCopy}>
                  <strong>{definition.title || definition.id || basename(definition.path)}</strong>
                  <span>{basename(definition.path)}</span>
                </span>
                <span className={styles.definitionMeta}>
                  {definition.stepCount} steps · {definition.valid ? "valid" : `${definition.errorCount} errors`}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={styles.validateButton}
            disabled={!selected || validating}
            onClick={() => void validateSelected()}
          >
            {validating ? "Validating…" : `Validate ${selected ? basename(selected.path) : "selected definition"}`}
          </button>
        </div>
      )}

      {validation && (
        <section className={styles.validation} data-valid={validation.valid} aria-label="Proofbook validation result">
          <div className={styles.validationHeading}>
            {validation.valid ? (
              <CheckCircle2 size={13} aria-hidden="true" />
            ) : (
              <AlertTriangle size={13} aria-hidden="true" />
            )}
            <strong>
              {validation.valid
                ? "Definition valid"
                : `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}`}
            </strong>
          </div>
          {!validation.valid && (
            <ul className={styles.errorList}>
              {validation.errors.slice(0, 3).map((entry) => (
                <li
                  key={`${entry.code}:${entry.field ?? ""}:${entry.stepId ?? ""}:${entry.path ?? ""}:${entry.message}`}
                >
                  <strong>{entry.code}</strong>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
          {validation.errors.length > 3 && (
            <p className={styles.overflow}>+{validation.errors.length - 3} more errors</p>
          )}
          {validation.valid && (
            <div className={styles.startAdmission} data-eligible={startAdmission?.eligible || undefined}>
              <div className={styles.admissionHeading}>
                <strong>
                  {startAdmission?.eligible
                    ? stringInputs.length > 0
                      ? "String-input start eligible"
                      : "Input-free start eligible"
                    : "Start remains read-only"}
                </strong>
                <span>
                  {startAdmission?.inputCount ?? 0} inputs · {startAdmission?.secretCount ?? 0} secrets
                </span>
              </div>
              {startAdmission?.definitionHash && (
                <code className={styles.definitionHash} title={startAdmission.definitionHash}>
                  {startAdmission.definitionHash}
                </code>
              )}
              {startAdmission?.eligible ? (
                <>
                  {stringInputs.length > 0 && (
                    <section className={styles.inputEditor} aria-label="Proofbook string inputs">
                      <div className={styles.inputFields}>
                        {stringInputs.map((field) => (
                          <label key={field.key} className={styles.inputField}>
                            <span className={styles.inputLabel}>
                              <code>{field.key}</code>
                              <small>{field.required ? "required" : "optional"}</small>
                            </span>
                            <input
                              type="text"
                              value={inputDraft[field.key] ?? ""}
                              aria-label={`Proofbook input ${field.key}`}
                              disabled={effectLocked}
                              onChange={(event) =>
                                setInputDraft((current) => ({ ...current, [field.key]: event.target.value }))
                              }
                            />
                            <small>
                              {field.defaultValue == null ? "No default" : `Default: ${field.defaultValue}`}
                            </small>
                          </label>
                        ))}
                      </div>
                      <div className={styles.inputPreview}>
                        <strong>Exact values submitted on Start</strong>
                        <dl>
                          {stringInputs.map((field) => {
                            const submitted = Object.getOwnPropertyDescriptor(submittedInputs, field.key) !== undefined;
                            return (
                              <div key={field.key} className={styles.inputPreviewRow}>
                                <dt>{field.key}</dt>
                                <dd>{submitted ? submittedInputs[field.key] : "(omitted)"}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      </div>
                    </section>
                  )}
                  <button
                    type="button"
                    className={styles.startButton}
                    disabled={effectLocked}
                    onClick={() => void startSelected()}
                    aria-label={`Start validated Proofbook ${selected ? basename(selected.path) : "definition"}`}
                  >
                    <Play size={11} aria-hidden="true" />
                    {starting ? "Starting…" : "Start validated Proofbook"}
                  </button>
                </>
              ) : (
                <p className={styles.startBlocked}>
                  {startAdmission?.blockers.length
                    ? `Blocked: ${startAdmission.blockers.join(", ")}${
                        startAdmission.unsupportedInputs.length
                          ? ` (${startAdmission.unsupportedInputs.join(", ")})`
                          : ""
                      }${
                        startAdmission.unsupportedStepKinds.length
                          ? ` (${startAdmission.unsupportedStepKinds.join(", ")})`
                          : ""
                      }`
                    : "Validate again to establish an input-free start boundary."}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {startStatus && (
        <p
          className={styles.startStatus}
          data-tone={startStatus.tone}
          role={startStatus.tone === "error" ? "alert" : "status"}
        >
          {startStatus.text}
        </p>
      )}

      {gateStatus && (
        <p
          className={styles.gateStatus}
          data-tone={gateStatus.tone}
          role={gateStatus.tone === "error" ? "alert" : "status"}
        >
          {gateStatus.text}
        </p>
      )}

      {pendingManualGates.length > 0 && (
        <section className={styles.gates} aria-label="Proofbook manual gates">
          <div className={styles.sectionHeading}>
            <ShieldQuestion size={12} aria-hidden="true" />
            <span>Manual gates</span>
            <strong>{pendingManualGates.length}</strong>
          </div>
          <div className={styles.gateList}>
            {pendingManualGates.map((gate) => {
              const resolving = resolvingGateKey === gate.key;
              return (
                <article key={gate.key} className={styles.gate} data-risk={gate.prompt.risk.toLowerCase()}>
                  <div className={styles.gateTop}>
                    <strong>{gate.proofbookId}</strong>
                    <span>{gate.prompt.risk} risk</span>
                  </div>
                  <p className={styles.gateEvidence}>
                    {gate.prompt.evidence || "No evidence context was supplied by this Proofbook definition."}
                  </p>
                  <dl className={styles.gateDetails}>
                    <div>
                      <dt>Gate</dt>
                      <dd>{gate.prompt.gateId}</dd>
                    </div>
                    <div>
                      <dt>Step</dt>
                      <dd>{gate.stepId}</dd>
                    </div>
                    <div>
                      <dt>Default</dt>
                      <dd>{gate.prompt.default}</dd>
                    </div>
                    <div>
                      <dt>Actor</dt>
                      <dd>cockpit-operator</dd>
                    </div>
                  </dl>
                  <code className={styles.gateHash} title={gate.prompt.gateHash}>
                    {gate.prompt.gateHash}
                  </code>
                  {gate.resolvable ? (
                    <div className={styles.gateActions}>
                      <button
                        type="button"
                        className={styles.gateApprove}
                        disabled={effectLocked}
                        onClick={() => void resolveManualGate(gate, "approve")}
                        aria-label={`Approve manual gate ${gate.prompt.gateId}`}
                      >
                        <Check size={11} aria-hidden="true" />
                        {resolving ? "Delivering…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className={styles.gateReject}
                        disabled={effectLocked}
                        onClick={() => void resolveManualGate(gate, "reject")}
                        aria-label={`Reject manual gate ${gate.prompt.gateId}`}
                      >
                        <X size={11} aria-hidden="true" />
                        {resolving ? "Locked" : "Reject"}
                      </button>
                    </div>
                  ) : (
                    <p className={styles.gateUnsupported}>
                      This gate does not expose the required approve/reject options and remains read-only.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {cancelStatus && (
        <p
          className={styles.cancelStatus}
          data-tone={cancelStatus.tone}
          role={cancelStatus.tone === "error" ? "alert" : "status"}
        >
          {cancelStatus.text}
        </p>
      )}

      {artifactStatus && (
        <p className={styles.artifactStatus} role="alert">
          {artifactStatus}
        </p>
      )}

      {settlement.status && (
        <p
          className={styles.settlementStatus}
          data-tone={settlement.status.tone}
          role={settlement.status.tone === "error" ? "alert" : "status"}
        >
          {settlement.status.text}
        </p>
      )}

      {artifactPreview && (
        <section className={styles.artifactPreview} aria-label="Proofbook artifact preview">
          <div className={styles.previewHeading}>
            <span>
              <FileText size={12} aria-hidden="true" />
              <strong>{artifactPreview.artifactId}</strong>
            </span>
            <button
              type="button"
              className={styles.previewClose}
              onClick={() => setArtifactPreview(null)}
              aria-label="Close Proofbook artifact preview"
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
          <dl className={styles.previewMeta}>
            <div>
              <dt>Run</dt>
              <dd>{artifactPreview.runId}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{artifactPreview.ledgerRevision}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{artifactPreview.sizeBytes} bytes</dd>
            </div>
            <div>
              <dt>Redactions</dt>
              <dd>{artifactPreview.redactionCount}</dd>
            </div>
          </dl>
          <code className={styles.previewHash} title={artifactPreview.sha256}>
            {artifactPreview.sha256}
          </code>
          <pre className={styles.previewContent}>{artifactPreview.content}</pre>
          <p className={styles.previewDisclosure}>
            Containment, recorded size, and SHA-256 were verified for this ledger revision. The recorded redaction count
            does not prove semantic removal of every possible secret.
          </p>
        </section>
      )}

      <section className={styles.history} aria-label="Proofbook run history">
        <div className={styles.sectionHeading}>
          <History size={12} aria-hidden="true" />
          <span>Run history</span>
          <strong>{runs.length}</strong>
        </div>
        {runs.length === 0 ? (
          <p className={styles.empty}>No durable Proofbook run ledgers found.</p>
        ) : (
          <div className={styles.runList}>
            {runs.map((run) => {
              const passed = run.steps.filter((step) => step.status === "passed").length;
              const cancellable = isCancellableRunStatus(run.status);
              const cancelling = cancellingRunId === run.runId;
              const evidenceExpanded = expandedEvidenceRunId === run.runId;
              const agentSessionSteps = runningAgentSessionSteps(run);
              return (
                <article key={run.runId} className={styles.run} data-status={run.status}>
                  <div className={styles.runTop}>
                    <strong>{run.proofbookId}</strong>
                    <span>{RUN_STATUS_LABEL[run.status]}</span>
                  </div>
                  <div className={styles.runMeta}>
                    <span>
                      {passed}/{run.steps.length} steps
                    </span>
                    <span>{run.artifacts.length} artifacts</span>
                    <span>{run.residualBlockers.length} blockers</span>
                  </div>
                  <div className={styles.runIdentity}>
                    <code title={run.runId}>{run.runId}</code>
                    <span>revision {run.revision}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.evidenceToggle}
                    aria-expanded={evidenceExpanded}
                    onClick={() => setExpandedEvidenceRunId((current) => (current === run.runId ? null : run.runId))}
                    aria-label={`${evidenceExpanded ? "Hide" : "Inspect"} durable evidence for ${run.runId}`}
                  >
                    {evidenceExpanded ? (
                      <ChevronUp size={11} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={11} aria-hidden="true" />
                    )}
                    {evidenceExpanded ? "Hide evidence" : "Inspect evidence"}
                  </button>
                  {evidenceExpanded && <ProofbookEvidenceInspector run={run} />}
                  {agentSessionSteps.length > 0 && (
                    <section
                      className={styles.agentSettlements}
                      aria-label={`Agent session settlement for ${run.runId}`}
                    >
                      {agentSessionSteps.map((step) => {
                        const key = settlementKey(run, step);
                        const checking = settlement.checkingKey === key;
                        const settling = settlement.settlingKey === key;
                        const candidate = candidateMatches(settlement.candidate, run, step)
                          ? settlement.candidate
                          : null;
                        return (
                          <ProofbookAgentSessionSettlement
                            key={step.stepId}
                            runId={run.runId}
                            step={step}
                            candidate={candidate}
                            checking={checking}
                            settling={settling}
                            disabled={effectLocked}
                            onInspect={() => void settlement.inspect(run, step)}
                            onSettle={(current) => void settlement.settle(current)}
                          />
                        );
                      })}
                    </section>
                  )}
                  {run.artifacts.length > 0 && (
                    <section className={styles.artifactList} aria-label={`Artifacts for ${run.runId}`}>
                      {run.artifacts.slice(0, 4).map((artifact) => {
                        const previewable = isRunnerOwnedPreviewCandidate(run.runId, artifact);
                        const previewing = previewingArtifactKey === `${run.runId}:${artifact.id}:${run.revision}`;
                        return (
                          <div key={artifact.id} className={styles.artifactRow}>
                            <span className={styles.artifactCopy} title={artifact.path}>
                              <strong>{basename(artifact.path)}</strong>
                              <small>
                                {artifact.kind} · {artifact.sizeBytes} B · redactions {artifact.redactionCount}
                              </small>
                            </span>
                            {previewable ? (
                              <button
                                type="button"
                                className={styles.previewButton}
                                disabled={effectLocked}
                                onClick={() => void previewArtifact(run, artifact)}
                                aria-label={`Preview Proofbook artifact ${artifact.id}`}
                              >
                                <Eye size={11} aria-hidden="true" />
                                {previewing ? "Verifying…" : "Preview"}
                              </button>
                            ) : (
                              <span className={styles.metadataOnly}>Metadata only</span>
                            )}
                          </div>
                        );
                      })}
                      {run.artifacts.length > 4 && (
                        <span className={styles.artifactOverflow}>+{run.artifacts.length - 4} more artifacts</span>
                      )}
                    </section>
                  )}
                  <time dateTime={run.updatedAt}>{formatUpdatedAt(run.updatedAt)}</time>
                  {cancellable && (
                    <div className={styles.cancelControl}>
                      <p>
                        Cancelling stops future Proofbook queue progression and marks pending, running, or waiting steps
                        cancelled. It does not prove an external process was terminated.
                      </p>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={effectLocked}
                        onClick={() => void cancelCurrentRun(run)}
                        aria-label={`Cancel current Proofbook run ${run.runId}`}
                      >
                        <Ban size={11} aria-hidden="true" />
                        {cancelling ? "Cancelling…" : "Cancel current run"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className={styles.disclosure}>
        This surface can start a freshly validated local Proofbook with no inputs or declared non-secret string inputs,
        resolve an existing manualGate with its current gate hash, cancel only the exact displayed revision of a
        non-terminal run, and preview verified runner-owned UTF-8 text artifacts. It cannot accept secrets, unsupported
        input types, arbitrary JSON, or free-form completion proofs. It can settle only the exact displayed revision of
        a running agentSession from current Aelyris-owned runtime status and contained expected artifacts; this does not
        terminate a process, accept a review, or merge work. Arbitrary paths, raw artifact export, bulk cancellation,
        and free-form gate comments remain unavailable.
      </p>
    </section>
  );
}
