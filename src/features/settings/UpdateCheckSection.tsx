import { useCallback, useState } from "react";

import styles from "./Settings.module.css";

/**
 * Outcome of an explicit "check now" click in the Settings panel.
 *
 * Distinct from `UpdateBanner` because Settings is the surface where we
 * *do* surface errors verbatim — the banner stays silent so a placeholder
 * endpoint doesn't nag every launch, but the user who clicked the button
 * deserves the truth.
 */
export type UpdateProbe =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; currentVersion: string }
  | { kind: "current"; currentVersion: string }
  | { kind: "error"; message: string };

export interface UpdateCheckSectionProps {
  /** Override for tests; defaults to the real updater plugin. */
  checkUpdate?: () => Promise<UpdateProbe>;
}

async function defaultCheckUpdate(): Promise<UpdateProbe> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const result = await check();
    if (!result) {
      // The plugin returns null when the running build is at-or-above
      // whatever the manifest advertises; we don't get the local version
      // for free in that branch, so fall back to the package.json string
      // baked into Vite at build time.
      return { kind: "current", currentVersion: import.meta.env.VITE_APP_VERSION ?? "unknown" };
    }
    return {
      kind: "available",
      version: result.version,
      currentVersion: result.currentVersion,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}

/**
 * Settings sub-section that surfaces a manual "check for updates" button
 * plus the result of the most recent click.
 *
 * The banner at the top of the app handles the "available" case by
 * default; this section exists for users who want to verify on demand
 * (e.g. immediately after a release ships) and for visibility into
 * misconfigured endpoints.
 */
export function UpdateCheckSection({ checkUpdate = defaultCheckUpdate }: UpdateCheckSectionProps) {
  const [probe, setProbe] = useState<UpdateProbe>({ kind: "idle" });

  const handleClick = useCallback(async () => {
    setProbe({ kind: "checking" });
    const next = await checkUpdate();
    setProbe(next);
  }, [checkUpdate]);

  let summary: string;
  let className: string = styles.hint;
  switch (probe.kind) {
    case "idle":
      summary = "";
      break;
    case "checking":
      summary = "Checking…";
      break;
    case "available":
      summary = `Update available: ${probe.version} (current ${probe.currentVersion}).`;
      className = styles.shellFeedback;
      break;
    case "current":
      summary = `You are on the latest version (${probe.currentVersion}).`;
      className = styles.shellFeedback;
      break;
    case "error":
      summary = `Check failed: ${probe.message}`;
      className = styles.shellError;
      break;
  }

  return (
    <div data-testid="update-check-section">
      <div className={styles.shellActions}>
        <button
          type="button"
          className={`${styles.shellBtn} ${styles.shellBtnPrimary}`}
          onClick={() => void handleClick()}
          disabled={probe.kind === "checking"}
        >
          {probe.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {summary && <div className={className}>{summary}</div>}
      <p className={styles.hint}>
        Aether is local-only by default; the updater requires a configured endpoint and signing key. See{" "}
        <code>docs/auto_updater_setup.md</code> for the one-time setup.
      </p>
    </div>
  );
}
