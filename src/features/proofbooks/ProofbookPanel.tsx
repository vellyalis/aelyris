import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  CheckCircle2,
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
  ProofbookManualGateOutput,
  ProofbookRunLedger,
  ProofbookRunStatus,
  ProofbookStepSummary,
  ProofbookSummary,
  ProofbookValidationReport,
} from "../../shared/types/proofbook";
import styles from "./ProofbookPanel.module.css";

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

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const code = typeof record.code === "string" ? record.code : null;
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  return typeof (error as Record<string, unknown>).code === "string"
    ? ((error as Record<string, unknown>).code as string)
    : null;
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

export function ProofbookPanel({ projectPath }: ProofbookPanelProps) {
  const [definitions, setDefinitions] = useState<ProofbookSummary[]>([]);
  const [runs, setRuns] = useState<ProofbookRunLedger[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [validation, setValidation] = useState<ProofbookValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [startStatus, setStartStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const resolvingGateRef = useRef<string | null>(null);
  const [resolvingGateKey, setResolvingGateKey] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<{ tone: "success" | "warn" | "error"; text: string } | null>(null);

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
    setStartStatus(null);
    setGateStatus(null);
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

  useEffect(() => {
    setDefinitions([]);
    setRuns([]);
    setSelectedPath(null);
    setValidation(null);
    setError(null);
    setStartStatus(null);
    setGateStatus(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectPath || !isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    const projectIdentity = normalizedPath(projectPath);

    void listen<ProofbookRunLedger>("proofbook-updated", (event) => {
      if (cancelled || normalizedPath(event.payload.projectPath) !== projectIdentity) return;
      setRuns((current) =>
        sortedRuns([event.payload, ...current.filter((run) => run.runId !== event.payload.runId)]),
      );
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else unlisten = unsubscribe;
      })
      .catch((cause) => {
        reportInvokeFailure({ source: "proofbooks", operation: "listen:proofbook-updated", err: cause, userVisible: false });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectPath]);

  const selected = useMemo(
    () => definitions.find((definition) => definition.path === selectedPath) ?? null,
    [definitions, selectedPath],
  );

  const pendingManualGates = useMemo(() => manualGates(runs), [runs]);
  const startAdmission = useMemo(() => {
    if (!selected || !validation || normalizedPath(validation.path) !== normalizedPath(selected.path)) return null;
    return validation.startAdmission;
  }, [selected, validation]);

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
      const ledger = await invoke<ProofbookRunLedger>("start_input_free_proofbook_run", {
        projectPath,
        proofbookPath: selected.path,
        expectedDefinitionHash: startAdmission.definitionHash,
      });
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
      reportInvokeFailure({ source: "proofbooks", operation: "start_input_free", err: cause, userVisible: true });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [projectPath, refresh, selected, startAdmission]);

  const resolveManualGate = useCallback(
    async (gate: ManualGateView, decision: ManualGateDecision) => {
      if (resolvingGateRef.current || !gate.resolvable) return;
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
    [projectPath, refresh],
  );

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
            {validation.valid ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
            <strong>{validation.valid ? "Definition valid" : `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}`}</strong>
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
          {validation.errors.length > 3 && <p className={styles.overflow}>+{validation.errors.length - 3} more errors</p>}
          {validation.valid && (
            <div className={styles.startAdmission} data-eligible={startAdmission?.eligible || undefined}>
              <div className={styles.admissionHeading}>
                <strong>{startAdmission?.eligible ? "Input-free start eligible" : "Start remains read-only"}</strong>
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
                <button
                  type="button"
                  className={styles.startButton}
                  disabled={starting}
                  onClick={() => void startSelected()}
                  aria-label={`Start validated Proofbook ${selected ? basename(selected.path) : "definition"}`}
                >
                  <Play size={11} aria-hidden="true" />
                  {starting ? "Starting…" : "Start validated Proofbook"}
                </button>
              ) : (
                <p className={styles.startBlocked}>
                  {startAdmission?.blockers.length
                    ? `Blocked: ${startAdmission.blockers.join(", ")}${
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
        <p className={styles.startStatus} data-tone={startStatus.tone} role={startStatus.tone === "error" ? "alert" : "status"}>
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
                        disabled={resolvingGateKey !== null}
                        onClick={() => void resolveManualGate(gate, "approve")}
                        aria-label={`Approve manual gate ${gate.prompt.gateId}`}
                      >
                        <Check size={11} aria-hidden="true" />
                        {resolving ? "Delivering…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className={styles.gateReject}
                        disabled={resolvingGateKey !== null}
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
              return (
                <article key={run.runId} className={styles.run} data-status={run.status}>
                  <div className={styles.runTop}>
                    <strong>{run.proofbookId}</strong>
                    <span>{RUN_STATUS_LABEL[run.status]}</span>
                  </div>
                  <div className={styles.runMeta}>
                    <span>{passed}/{run.steps.length} steps</span>
                    <span>{run.artifacts.length} artifacts</span>
                    <span>{run.residualBlockers.length} blockers</span>
                  </div>
                  <time dateTime={run.updatedAt}>{formatUpdatedAt(run.updatedAt)}</time>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className={styles.disclosure}>
        This surface can start only a freshly validated input-free local Proofbook and resolve an existing manualGate with its current gate hash. It cannot accept inputs or secrets, cancel, settle, open raw artifacts, or submit free-form gate comments.
      </p>
    </section>
  );
}
