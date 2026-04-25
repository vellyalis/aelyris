import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import styles from "./Settings.module.css";

/**
 * Backend mirror of `shell_integration::ShellIntegrationStatus`. Kept inline
 * because this is the only consumer; sharing the type would mean introducing
 * a `shared/types/shell-integration.ts` for one row component.
 */
export interface ShellIntegrationStatus {
  shell: "powershell" | "bash" | "zsh";
  label: string;
  scriptPath: string;
  profilePath: string;
  profileExists: boolean;
  installed: boolean;
  sourceLine: string;
}

interface RawStatus {
  shell: ShellIntegrationStatus["shell"];
  label: string;
  script_path: string;
  profile_path: string;
  profile_exists: boolean;
  installed: boolean;
  source_line: string;
}

interface RawInstall {
  script_path: string;
  profile_path: string;
  source_line: string;
  appended: boolean;
}

interface ShellIntegrationSectionProps {
  /** Override for tests — defaults to invoke("shell_integration_status"). */
  loadStatus?: () => Promise<ShellIntegrationStatus[]>;
  /** Override for tests — defaults to invoke("shell_integration_install"). */
  install?: (shell: ShellIntegrationStatus["shell"]) => Promise<{
    appended: boolean;
    profilePath: string;
    sourceLine: string;
  }>;
  /** Override for tests — defaults to navigator.clipboard.writeText. */
  copyToClipboard?: (text: string) => Promise<void>;
}

function fromRaw(raw: RawStatus): ShellIntegrationStatus {
  return {
    shell: raw.shell,
    label: raw.label,
    scriptPath: raw.script_path,
    profilePath: raw.profile_path,
    profileExists: raw.profile_exists,
    installed: raw.installed,
    sourceLine: raw.source_line,
  };
}

function defaultLoadStatus(): Promise<ShellIntegrationStatus[]> {
  return invoke<RawStatus[]>("shell_integration_status").then((rows) => rows.map(fromRaw));
}

function defaultInstall(shell: ShellIntegrationStatus["shell"]) {
  return invoke<RawInstall>("shell_integration_install", { shell }).then((r) => ({
    appended: r.appended,
    profilePath: r.profile_path,
    sourceLine: r.source_line,
  }));
}

async function defaultCopy(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("clipboard API unavailable");
}

type FeedbackKind = "ok" | "err";

interface RowFeedback {
  kind: FeedbackKind;
  message: string;
}

/**
 * Settings panel section for the OSC 133 shell-integration installer.
 *
 * One row per supported shell. Each row shows the resolved profile path,
 * the exact line that would be appended, and two actions:
 *   - **Copy line** — for users whose profile lives at a non-standard
 *     path (every shell has at least one such user).
 *   - **Install** — appends to the standard profile path. Idempotent on
 *     the install marker; safe to click twice.
 *
 * Per the roadmap risk hedge ("never silent-edit"), the install button
 * is the only path that touches the profile, and it requires an explicit
 * click — there is no auto-install.
 */
export function ShellIntegrationSection({
  loadStatus = defaultLoadStatus,
  install = defaultInstall,
  copyToClipboard = defaultCopy,
}: ShellIntegrationSectionProps) {
  const [rows, setRows] = useState<ShellIntegrationStatus[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Map<string, RowFeedback>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadStatus();
      setRows(loaded);
    } catch {
      setRows([]);
    }
  }, [loadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setRowFeedback = useCallback((shell: string, value: RowFeedback | null) => {
    setFeedback((prev) => {
      const next = new Map(prev);
      if (value === null) {
        next.delete(shell);
      } else {
        next.set(shell, value);
      }
      return next;
    });
  }, []);

  const handleCopy = useCallback(
    async (row: ShellIntegrationStatus) => {
      try {
        await copyToClipboard(row.sourceLine);
        setRowFeedback(row.shell, { kind: "ok", message: "Copied to clipboard." });
      } catch {
        setRowFeedback(row.shell, { kind: "err", message: "Clipboard unavailable." });
      }
    },
    [copyToClipboard, setRowFeedback],
  );

  const handleInstall = useCallback(
    async (row: ShellIntegrationStatus) => {
      setPending((prev) => new Set(prev).add(row.shell));
      try {
        const result = await install(row.shell);
        await refresh();
        setRowFeedback(row.shell, {
          kind: "ok",
          message: result.appended
            ? `Appended to ${result.profilePath}.`
            : "Already installed — profile left unchanged.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRowFeedback(row.shell, { kind: "err", message: `Install failed: ${msg}` });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(row.shell);
          return next;
        });
      }
    },
    [install, refresh, setRowFeedback],
  );

  if (rows === null) {
    return <p className={styles.hint}>Loading shell integration status…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className={styles.hint}>Could not detect shell profiles in this environment.</p>
    );
  }

  return (
    <div className={styles.shellList} data-testid="shell-integration-section">
      {rows.map((row) => {
        const isPending = pending.has(row.shell);
        const fb = feedback.get(row.shell);
        return (
          <div key={row.shell} className={styles.shellRow}>
            <div className={styles.shellRowHeader}>
              <span className={styles.shellName}>{row.label}</span>
              <span
                className={`${styles.shellBadge} ${
                  row.installed ? styles.shellBadgeInstalled : styles.shellBadgePending
                }`}
              >
                {row.installed ? "Installed" : "Not installed"}
              </span>
            </div>
            <div className={styles.shellPath}>Profile: {row.profilePath}</div>
            <div className={styles.shellLine}>{row.sourceLine}</div>
            <div className={styles.shellActions}>
              <button
                type="button"
                className={`${styles.shellBtn} ${styles.shellBtnPrimary}`}
                onClick={() => void handleInstall(row)}
                disabled={isPending}
              >
                {isPending ? "Installing…" : row.installed ? "Reinstall" : "Install"}
              </button>
              <button
                type="button"
                className={styles.shellBtn}
                onClick={() => void handleCopy(row)}
              >
                Copy line
              </button>
            </div>
            {fb && (
              <div className={fb.kind === "ok" ? styles.shellFeedback : styles.shellError}>
                {fb.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
