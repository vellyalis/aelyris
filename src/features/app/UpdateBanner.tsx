import { useCallback, useEffect, useState } from "react";

import { PRODUCT_NAME } from "../../shared/constants/product";
import styles from "./UpdateBanner.module.css";

/**
 * Subset of `@tauri-apps/plugin-updater` we depend on. Wrapping it in a
 * local interface keeps the component testable without spinning up the
 * real plugin (which requires a configured pubkey + reachable endpoint).
 *
 * `available === false` is the "no update / silent" branch; `Available`
 * carries the metadata we render in the banner plus the side-effect
 * methods used by the install button.
 */
export interface UpdateAvailable {
  available: true;
  version: string;
  currentVersion: string;
  notes?: string;
  /** Triggers download + install (passive on Windows). */
  downloadAndInstall: () => Promise<void>;
}

export interface UpdateNone {
  available: false;
}

export type UpdateState = UpdateAvailable | UpdateNone;

export type CheckUpdateFn = () => Promise<UpdateState>;
export type RelaunchFn = () => Promise<void>;

export interface UpdateBannerProps {
  /** Override for tests; defaults to the real updater plugin. */
  checkUpdate?: CheckUpdateFn;
  /** Override for tests; defaults to `@tauri-apps/plugin-process` relaunch. */
  relaunch?: RelaunchFn;
  /** Skip auto-check on mount. Defaults to `false` so prod always checks. */
  disableAutoCheck?: boolean;
}

/**
 * Lazy import the real updater plugin so unit tests can render this
 * component without resolving the Tauri runtime. The plugin's `check()`
 * returns `Update | null`; we adapt it into our flatter `UpdateState`.
 *
 * Errors are intentionally swallowed: the placeholder endpoint that
 * ships in `tauri.conf.json` is unreachable by design, and the user
 * should not see "update server unreachable" until they have configured
 * a real endpoint via `scripts/setup-updater-keys.ps1`.
 */
async function defaultCheckUpdate(): Promise<UpdateState> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { available: false };
    return {
      available: true,
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
      downloadAndInstall: () => update.downloadAndInstall(),
    };
  } catch {
    return { available: false };
  }
}

async function defaultRelaunch(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

type Phase = "checking" | "idle" | "available" | "installing" | "error";

interface BannerVisualState {
  phase: Phase;
  update: UpdateAvailable | null;
  error: string | null;
}

const INITIAL: BannerVisualState = {
  phase: "checking",
  update: null,
  error: null,
};

/**
 * Top-of-window banner that reports whether a newer Aether build is
 * available and offers a one-click "Install & restart" path.
 *
 * Auto-checks once on mount; user-driven re-checks live in the Settings
 * panel. Dismissal is per-session — closing the banner does not suppress
 * future updates, just hides this one until the next launch.
 */
export function UpdateBanner({
  checkUpdate = defaultCheckUpdate,
  relaunch = defaultRelaunch,
  disableAutoCheck = false,
}: UpdateBannerProps) {
  const [state, setState] = useState<BannerVisualState>(
    disableAutoCheck ? { phase: "idle", update: null, error: null } : INITIAL,
  );
  const [dismissed, setDismissed] = useState(false);

  const performCheck = useCallback(async () => {
    setState({ phase: "checking", update: null, error: null });
    try {
      const result = await checkUpdate();
      if (!result.available) {
        setState({ phase: "idle", update: null, error: null });
        return;
      }
      setState({ phase: "available", update: result, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ phase: "error", update: null, error: message });
    }
  }, [checkUpdate]);

  useEffect(() => {
    if (disableAutoCheck) return;
    void performCheck();
  }, [disableAutoCheck, performCheck]);

  const handleInstall = useCallback(async () => {
    if (state.phase !== "available" || !state.update) return;
    const update = state.update;
    setState({ phase: "installing", update, error: null });
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ phase: "error", update, error: message });
    }
  }, [state, relaunch]);

  if (dismissed) return null;
  if (state.phase !== "available" && state.phase !== "installing") return null;
  const update = state.update;
  if (!update) return null;

  const isInstalling = state.phase === "installing";

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.text}>
        {PRODUCT_NAME} <strong>{update.version}</strong> is available
        {update.currentVersion ? ` (current ${update.currentVersion})` : ""}.
      </span>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={() => void handleInstall()}
        disabled={isInstalling}
      >
        {isInstalling ? "Installing…" : "Install & restart"}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => setDismissed(true)}
        disabled={isInstalling}
        aria-label="Dismiss update banner"
      >
        Dismiss
      </button>
    </div>
  );
}
