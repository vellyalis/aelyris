import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, BookOpenCheck, CheckCircle2, History, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type {
  ProofbookRunLedger,
  ProofbookRunStatus,
  ProofbookSummary,
  ProofbookValidationReport,
} from "../../shared/types/proofbook";
import styles from "./ProofbookPanel.module.css";

interface ProofbookPanelProps {
  readonly projectPath: string;
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

  const validateSelected = useCallback(async () => {
    if (!selected || validating) return;
    setValidating(true);
    setValidation(null);
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

  return (
    <section className={styles.panel} aria-label="Proofbooks">
      <div className={styles.toolbar}>
        <span className={styles.mode}>
          <ShieldCheck size={12} aria-hidden="true" />
          Read-only catalog
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
        This surface cannot start, cancel, approve, or settle a Proofbook run. Those effects remain behind their existing governed commands.
      </p>
    </section>
  );
}
