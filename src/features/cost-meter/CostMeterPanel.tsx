import { AlertTriangle, Check, CircleDollarSign, Clock3, Gauge, Save, UsersRound } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useCostManager } from "../../shared/hooks/useCostManager";
import { deriveFleetCostMeter, type FleetCostMeter, isCostMeterLiveStatus } from "../../shared/lib/costMeter";
import { compactWorkstationNumber } from "../../shared/lib/workstationSummary";
import type { AgentSession, TelemetryConfidence } from "../../shared/types/agent";
import type { CostCaps, CostCapsValidationError, CostLimit } from "../../shared/types/cost";
import styles from "./CostMeterPanel.module.css";
import {
  type CostCapDraftField,
  type CostCapEditorState,
  capsReachedByReportedUsage,
  costCapDraftIsDirty,
  initializeCostCapEditor,
  parseCostCapDraft,
  synchronizeCostCapEditor,
} from "./costCapEditor";

interface CostMeterPanelProps {
  readonly sessions: readonly AgentSession[];
}

const LIMIT_LABEL: Record<CostLimit, string> = {
  agents: "agent",
  tokens: "token",
  cost: "cost",
  runtime: "runtime",
};

function formatUsd(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function metricValue(value: string, cap: string | null): string {
  return cap == null ? value : `${value} / ${cap}`;
}

function statusCopy(meter: FleetCostMeter, caps: CostCaps): string {
  if (meter.blockedBy.length > 0) {
    return `Configured ${meter.blockedBy.map((limit) => LIMIT_LABEL[limit]).join(" + ")} cap reached.`;
  }
  if (meter.unknownLimits.length > 0) {
    return `Cap coverage incomplete: ${meter.unknownLimits.map((limit) => LIMIT_LABEL[limit]).join(" + ")} telemetry unknown.`;
  }
  if (meter.status === "agent_only") {
    return caps.max_agents == null
      ? "No fleet caps are configured."
      : "Agent cap is configured; token, cost, and runtime remain uncapped.";
  }
  return "Reported fleet usage is within the configured caps.";
}

function capSummary(caps: CostCaps): string {
  return [
    `agents ${caps.max_agents ?? "invalid"}`,
    `tokens ${caps.max_tokens == null ? "uncapped" : caps.max_tokens.toLocaleString()}`,
    `cost ${caps.max_cost_usd == null ? "uncapped" : formatUsd(caps.max_cost_usd)}`,
    `runtime ${caps.max_runtime_secs == null ? "uncapped" : `${caps.max_runtime_secs.toLocaleString()}s`}`,
  ].join(" · ");
}

function isCostCapsValidationField(value: unknown): value is CostCapsValidationError["field"] {
  switch (value) {
    case "max_agents":
    case "max_tokens":
    case "max_cost_usd":
    case "max_runtime_secs":
      return true;
    default:
      return false;
  }
}

function validationError(error: unknown): CostCapsValidationError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; field?: unknown; message?: unknown };
  if (
    candidate.code !== "invalid_cost_caps" ||
    !isCostCapsValidationField(candidate.field) ||
    typeof candidate.message !== "string"
  ) {
    return null;
  }
  return {
    code: candidate.code,
    field: candidate.field,
    message: candidate.message,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const typed = validationError(error);
  if (typed) return `${typed.field}: ${typed.message}`;
  return "The runtime rejected the cap update.";
}

export function CostMeterPanel({ sessions }: CostMeterPanelProps) {
  const { caps, policy, updateCaps } = useCostManager();
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<CostCapEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [backendFieldError, setBackendFieldError] = useState<CostCapsValidationError | null>(null);

  useEffect(() => {
    if (!sessions.some((session) => isCostMeterLiveStatus(session.status))) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sessions]);

  const meter = useMemo(() => (caps ? deriveFleetCostMeter(sessions, caps, now) : null), [caps, now, sessions]);

  useEffect(() => {
    if (!caps || !policy) return;
    setEditor((current) => synchronizeCostCapEditor(current, caps, policy));
  }, [caps, policy]);

  const parsedDraft = useMemo(
    () => (editor && policy ? parseCostCapDraft(editor.draft, policy) : null),
    [editor, policy],
  );
  const dirty = Boolean(editor && policy && costCapDraftIsDirty(editor.draft, editor.baseline, policy));
  const proposedReached = useMemo(
    () => (meter && parsedDraft?.caps ? capsReachedByReportedUsage(parsedDraft.caps, meter) : []),
    [meter, parsedDraft?.caps],
  );

  const updateDraft = useCallback((field: CostCapDraftField, value: string) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: { ...current.draft, [field]: value },
          }
        : current,
    );
    setBackendFieldError(null);
    setSaveStatus(null);
  }, []);

  const submitCaps = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editor || !parsedDraft?.caps || editor.conflict || saving) return;
      setSaving(true);
      setBackendFieldError(null);
      setSaveStatus(null);
      try {
        const updated = await updateCaps(parsedDraft.caps);
        setEditor(initializeCostCapEditor(updated));
        setSaveStatus({ tone: "success", text: `Saved fleet caps: ${capSummary(updated)}.` });
      } catch (error) {
        const typed = validationError(error);
        setBackendFieldError(typed);
        setSaveStatus({ tone: "error", text: `Cap update failed: ${errorMessage(error)}` });
      } finally {
        setSaving(false);
      }
    },
    [editor, parsedDraft?.caps, saving, updateCaps],
  );

  if (!caps || !policy || !meter || !editor || !parsedDraft) {
    return <p className={styles.loading}>Reading configured fleet caps…</p>;
  }

  const tokenValue =
    meter.tokenConfidence === "unknown" ? "unknown" : compactWorkstationNumber(meter.usage.tokens_used);
  const costValue = meter.costConfidence === "unknown" ? "unknown" : formatUsd(meter.usage.cost_usd);

  return (
    <section className={styles.panel} aria-label="Fleet cost meter" data-status={meter.status}>
      <div className={styles.status} data-status={meter.status} role="status">
        {meter.status === "blocked" || meter.status === "incomplete" ? (
          <AlertTriangle size={13} aria-hidden="true" />
        ) : (
          <Gauge size={13} aria-hidden="true" />
        )}
        <span>{statusCopy(meter, caps)}</span>
      </div>

      <fieldset className={styles.metrics} aria-label="Reported fleet usage and caps">
        <Metric
          icon={<UsersRound size={12} />}
          label="Agents"
          value={metricValue(
            String(meter.usage.active_agents),
            caps.max_agents == null ? null : String(caps.max_agents),
          )}
          confidence="exact"
        />
        <Metric
          icon={<Gauge size={12} />}
          label="Tokens"
          value={metricValue(tokenValue, caps.max_tokens == null ? null : compactWorkstationNumber(caps.max_tokens))}
          confidence={meter.tokenConfidence}
        />
        <Metric
          icon={<CircleDollarSign size={12} />}
          label="Cost"
          value={metricValue(costValue, caps.max_cost_usd == null ? null : formatUsd(caps.max_cost_usd))}
          confidence={meter.costConfidence}
        />
        <Metric
          icon={<Clock3 size={12} />}
          label="Runtime"
          value={metricValue(
            formatDuration(meter.usage.runtime_secs),
            caps.max_runtime_secs == null ? null : formatDuration(caps.max_runtime_secs),
          )}
          confidence={meter.runtimeConfidence}
        />
      </fieldset>

      <details className={styles.editor}>
        <summary>
          <span>Edit caps</span>
          <small>{dirty ? "unsaved draft" : "explicit save"}</small>
        </summary>

        <form className={styles.editorForm} aria-label="Fleet cap editor" onSubmit={(event) => void submitCaps(event)}>
          <div className={styles.capSnapshot}>
            <span>Current</span>
            <strong>{capSummary(editor.baseline)}</strong>
          </div>
          <div className={styles.capSnapshot} data-proposed="true">
            <span>Proposed</span>
            <strong>{parsedDraft.caps ? capSummary(parsedDraft.caps) : "Fix the fields below before saving."}</strong>
          </div>

          <fieldset className={styles.editorFields} disabled={saving}>
            <CapField
              id="fleet-cap-agents"
              label="Max agents"
              value={editor.draft.maxAgents}
              min={policy.min_agents}
              max={policy.max_agents}
              step="1"
              required
              hint={`${policy.min_agents}–${policy.max_agents}; unlimited is not exposed.`}
              error={
                parsedDraft.errors.maxAgents ??
                (backendFieldError?.field === "max_agents" ? backendFieldError.message : null)
              }
              onChange={(value) => updateDraft("maxAgents", value)}
            />
            <CapField
              id="fleet-cap-tokens"
              label="Max reported tokens"
              value={editor.draft.maxTokens}
              min={1}
              step="1"
              hint="Blank means uncapped. Telemetry may be unknown."
              error={
                parsedDraft.errors.maxTokens ??
                (backendFieldError?.field === "max_tokens" ? backendFieldError.message : null)
              }
              onChange={(value) => updateDraft("maxTokens", value)}
            />
            <CapField
              id="fleet-cap-cost"
              label="Max reported cost (USD)"
              value={editor.draft.maxCostUsd}
              min={0.01}
              step="0.01"
              hint="Blank means uncapped; this is reported cost, not provider billing."
              error={
                parsedDraft.errors.maxCostUsd ??
                (backendFieldError?.field === "max_cost_usd" ? backendFieldError.message : null)
              }
              onChange={(value) => updateDraft("maxCostUsd", value)}
            />
            <CapField
              id="fleet-cap-runtime"
              label="Max runtime (seconds)"
              value={editor.draft.maxRuntimeSecs}
              min={1}
              step="1"
              hint="Blank means uncapped. Runtime is measured from live sessions."
              error={
                parsedDraft.errors.maxRuntimeSecs ??
                (backendFieldError?.field === "max_runtime_secs" ? backendFieldError.message : null)
              }
              onChange={(value) => updateDraft("maxRuntimeSecs", value)}
            />
          </fieldset>

          {editor.conflict && (
            <section className={styles.conflict} role="alert">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>
                <strong>Runtime caps changed while this draft was open.</strong>
                <small>Latest: {capSummary(editor.conflict)}</small>
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const latest = editor.conflict;
                    if (latest) setEditor(initializeCostCapEditor(latest));
                  }}
                >
                  Use latest
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditor((current) =>
                      current?.conflict ? { ...current, baseline: current.conflict, conflict: null } : current,
                    )
                  }
                >
                  Keep draft
                </button>
              </div>
            </section>
          )}

          {proposedReached.length > 0 && (
            <p className={styles.haltWarning} role="note">
              <AlertTriangle size={12} aria-hidden="true" />
              Proposed {proposedReached.map((limit) => LIMIT_LABEL[limit]).join(" + ")} cap is already reached by known
              usage. Future orchestration will block or halt; existing work is not killed.
            </p>
          )}

          {saveStatus && (
            <p
              className={styles.saveStatus}
              data-tone={saveStatus.tone}
              role={saveStatus.tone === "error" ? "alert" : "status"}
            >
              {saveStatus.tone === "success" && <Check size={12} aria-hidden="true" />}
              {saveStatus.text}
            </p>
          )}

          <div className={styles.editorActions}>
            <button
              type="button"
              className={styles.resetButton}
              disabled={!dirty || saving}
              onClick={() => {
                setEditor(initializeCostCapEditor(editor.baseline));
                setBackendFieldError(null);
                setSaveStatus(null);
              }}
            >
              Reset draft
            </button>
            <button
              type="submit"
              className={styles.saveButton}
              disabled={!dirty || parsedDraft.caps == null || editor.conflict != null || saving}
            >
              <Save size={12} aria-hidden="true" />
              {saving ? "Saving…" : "Save caps"}
            </button>
          </div>
        </form>
      </details>

      <p className={styles.disclosure}>
        Values are reported session telemetry. Unknown is never treated as zero. Saving lower caps can stop future
        orchestration but does not terminate existing agents or prove provider billing.
      </p>
    </section>
  );
}

function CapField({
  id,
  label,
  value,
  min,
  max,
  step,
  required = false,
  hint,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max?: number;
  readonly step: string;
  readonly required?: boolean;
  readonly hint: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.capField}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        required={required}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      <small id={hintId}>{hint}</small>
      {error && (
        <strong id={errorId} className={styles.fieldError}>
          {error}
        </strong>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  confidence,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly confidence: TelemetryConfidence;
}) {
  return (
    <div className={styles.metric} data-confidence={confidence} title={`${label} telemetry: ${confidence}`}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.metricCopy}>
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
      <span className={styles.confidence}>{confidence}</span>
    </div>
  );
}
