import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { WORKFORCE_GUARDRAIL_PROFILES, type WorkforceGuardrailProfile } from "../../shared/lib/rightRailWorkforce";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { BootstrapAppConfig } from "./bootstrapAppConfig";
import type { RightRailGuardrailSelection, RightRailRouteConfirmation, RightRailWidgetId } from "./rightRailTypes";

export const RIGHT_RAIL_GUARDRAIL_OPTIONS: readonly RightRailGuardrailSelection[] = ["Auto", ...WORKFORCE_GUARDRAIL_PROFILES];
export const RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY = "aelyris:right-rail-guardrail-selection";
export const RIGHT_RAIL_GUARDRAIL_SYNC_EVENT = "aelyris:right-rail-guardrail-sync";
export const RIGHT_RAIL_WIDGET_STORAGE_PREFIX = "aelyris:right-rail-widget:";
export const RIGHT_RAIL_WIDGET_SYNC_EVENT = "aelyris:right-rail-widget-sync";
export const RIGHT_RAIL_WIDGET_IDS: readonly RightRailWidgetId[] = [
  "decision-inbox", "sessions", "orchestrator", "workflow", "toolkit", "context", "audit-timeline", "run-graph", "tool-ledger", "logs",
];

export function isRightRailGuardrailSelection(value: string | null): value is RightRailGuardrailSelection {
  return value === "Auto" || WORKFORCE_GUARDRAIL_PROFILES.includes(value as WorkforceGuardrailProfile);
}

export function loadRightRailGuardrailSelection(): RightRailGuardrailSelection {
  if (typeof window === "undefined") return "Auto";
  try {
    const saved = window.localStorage.getItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY);
    return isRightRailGuardrailSelection(saved) ? saved : "Auto";
  } catch { return "Auto"; }
}

export function saveRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection); } catch { /* hardened webview */ }
  void saveRightRailGuardrailSelectionToNativeConfig(selection);
}

export function applyRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection); } catch { /* hardened webview */ }
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, { detail: { selection } }));
}

export function hydrateRightRailGuardrailSelectionFromConfig(selection: unknown): void {
  if (typeof selection === "string" && isRightRailGuardrailSelection(selection)) applyRightRailGuardrailSelection(selection);
}

export async function saveRightRailGuardrailSelectionToNativeConfig(selection: RightRailGuardrailSelection): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const config = await invoke<BootstrapAppConfig>("load_app_config");
    const paneLayout = config.workspace_profile?.global_defaults?.pane_layout ?? {};
    await invoke("save_app_config", { config: {
      ...config,
      workspace_profile: {
        ...(config.workspace_profile ?? {}),
        global_defaults: {
          ...(config.workspace_profile?.global_defaults ?? {}),
          pane_layout: { ...paneLayout, right_rail_guardrail_profile: selection },
        },
      },
    } });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "save_right_rail_guardrail_config", err, severity: "warning" });
  }
}

export function isRightRailWidgetId(value: string): value is RightRailWidgetId {
  return RIGHT_RAIL_WIDGET_IDS.includes(value as RightRailWidgetId);
}
export function writeRightRailWidgetOpenToStorage(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`, open ? "1" : "0"); } catch { /* hardened webview */ }
}
export function applyRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } }));
}
export function loadRightRailWidgetOpen(widget: RightRailWidgetId, defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  try {
    const saved = window.localStorage.getItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`);
    return saved == null ? defaultOpen : saved === "1";
  } catch { return defaultOpen; }
}
export function hydrateRightRailWidgetOpenFromConfig(widgets: Partial<Record<RightRailWidgetId, boolean>> | null | undefined): void {
  if (!widgets || typeof window === "undefined") return;
  for (const [widget, open] of Object.entries(widgets)) if (isRightRailWidgetId(widget) && typeof open === "boolean") applyRightRailWidgetOpen(widget, open);
}
export async function saveRightRailWidgetOpenToNativeConfig(widget: RightRailWidgetId, open: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const config = await invoke<BootstrapAppConfig>("load_app_config");
    const paneLayout = config.workspace_profile?.global_defaults?.pane_layout ?? {};
    const widgets = { ...(paneLayout.right_rail_widgets ?? {}), [widget]: open };
    await invoke("save_app_config", { config: {
      ...config,
      workspace_profile: {
        ...(config.workspace_profile ?? {}),
        global_defaults: {
          ...(config.workspace_profile?.global_defaults ?? {}),
          pane_layout: { ...paneLayout, right_rail_widgets: widgets },
        },
      },
    } });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "save_right_rail_widget_config", err, severity: "warning" });
  }
}
export function saveRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } })), 0);
  void saveRightRailWidgetOpenToNativeConfig(widget, open);
}

export interface RightRailWidgetFrameProps {
  widget: RightRailWidgetId;
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  focusConfirmation?: Pick<RightRailRouteConfirmation, "title" | "detail"> | null;
  children: ReactNode;
}
export function RightRailWidgetFrame({ widget, title, subtitle, defaultOpen = true, forceOpen = false, focusConfirmation = null, children }: RightRailWidgetFrameProps) {
  const [open, setOpen] = useState(() => loadRightRailWidgetOpen(widget, defaultOpen));
  const effectiveOpen = forceOpen || open;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ widget?: string; open?: unknown }>).detail;
      if (detail?.widget === widget && typeof detail.open === "boolean") setOpen(detail.open);
    };
    window.addEventListener(RIGHT_RAIL_WIDGET_SYNC_EVENT, onSync);
    return () => window.removeEventListener(RIGHT_RAIL_WIDGET_SYNC_EVENT, onSync);
  }, [widget]);
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    saveRightRailWidgetOpen(widget, true);
  }, [forceOpen, widget]);
  const toggleOpen = useCallback(() => {
    if (forceOpen) return;
    setOpen((current) => { const next = !current; saveRightRailWidgetOpen(widget, next); return next; });
  }, [forceOpen, widget]);
  return <div className="bento-widget right-panel-widget-frame" data-widget={widget} data-open={effectiveOpen}>
    <button type="button" className="right-panel-widget-frame-header" onClick={toggleOpen} aria-expanded={effectiveOpen} aria-controls={`right-rail-widget-${widget}`} title={`${title}: ${subtitle}`}>
      <ChevronDown className="right-panel-widget-frame-chevron" size={12} strokeWidth={2.1} aria-hidden="true" />
      <span className="right-panel-widget-frame-copy"><span className="right-panel-widget-frame-title">{title}</span><span className="right-panel-widget-frame-subtitle">{subtitle}</span></span>
      {forceOpen && <span className="right-panel-widget-frame-pin">Focused</span>}
    </button>
    {effectiveOpen && <div id={`right-rail-widget-${widget}`} className="right-panel-widget-frame-body">
      {focusConfirmation && <div className="right-panel-widget-focus-confirmation" role="status" aria-live="polite"><span>{focusConfirmation.title}</span><strong>{focusConfirmation.detail}</strong></div>}
      {children}
    </div>}
  </div>;
}
