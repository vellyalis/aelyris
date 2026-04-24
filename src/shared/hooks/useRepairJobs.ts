import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { toast } from "../store/toastStore";
import { type AutoRepairConfig, isPhaseActive, type RepairJobInfo, type RepairNotification } from "../types/repair";

interface UseRepairJobsResult {
  jobs: RepairJobInfo[];
  activeCount: number;
  config: AutoRepairConfig;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPattern: (pattern: string) => Promise<void>;
  triggerManual: (args: { errorLine: string; sourcePane: string; repoPath: string }) => Promise<string | null>;
}

const EMPTY_JOBS: RepairJobInfo[] = [];
const DEFAULT_CONFIG: AutoRepairConfig = { enabled: false, pattern: "" };

/**
 * Subscribe to the `AutoRepairManager` state (Phase 3A-1).
 *
 * - `jobs` is the latest snapshot, kept in sync via `repair:jobs-updated`.
 * - `config` mirrors the on-disk `watchdog.json` auto_repair block.
 * - Notifications are forwarded to the global toast store so every caller
 *   of this hook doesn't race to show duplicate toasts — only the first
 *   hook mount wins the subscription per page, which is sufficient because
 *   `listen` returns the same stream to all subscribers.
 */
export function useRepairJobs(): UseRepairJobsResult {
  const [jobs, setJobs] = useState<RepairJobInfo[]>(EMPTY_JOBS);
  const [config, setConfig] = useState<AutoRepairConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      try {
        const [initialJobs, initialCfg] = await Promise.all([
          invoke<RepairJobInfo[]>("list_repair_jobs"),
          invoke<AutoRepairConfig>("get_auto_repair_config"),
        ]);
        if (cancelled) return;
        setJobs(initialJobs);
        setConfig(initialCfg);
      } catch {
        /* backend unavailable (e.g. tests) — defaults stand */
      }

      try {
        unlistens.push(
          await listen<RepairJobInfo[]>("repair:jobs-updated", (event) => {
            setJobs(event.payload);
          }),
        );
      } catch {
        /* listen unavailable */
      }

      try {
        unlistens.push(
          await listen<RepairNotification>("repair:notification", (event) => {
            const { message, is_success } = event.payload;
            if (is_success) {
              toast.success("Auto-repair", message);
            } else {
              toast.error("Auto-repair", message);
            }
          }),
        );
      } catch {
        /* listen unavailable */
      }

      if (cancelled) {
        unlistens.forEach((fn) => fn());
      }
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    try {
      const next = await invoke<AutoRepairConfig>("set_auto_repair_config", {
        enabled,
        pattern: null,
      });
      setConfig(next);
    } catch (e) {
      toast.error("Auto-repair toggle failed", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const setPattern = useCallback(async (pattern: string) => {
    try {
      const next = await invoke<AutoRepairConfig>("set_auto_repair_config", {
        enabled: null,
        pattern,
      });
      setConfig(next);
    } catch (e) {
      toast.error("Auto-repair pattern rejected", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const triggerManual = useCallback(async (args: { errorLine: string; sourcePane: string; repoPath: string }) => {
    try {
      const id = await invoke<string | null>("trigger_repair_manual", {
        errorLine: args.errorLine,
        sourcePane: args.sourcePane,
        repoPath: args.repoPath,
      });
      return id;
    } catch (e) {
      toast.error("Auto-repair trigger failed", e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const activeCount = jobs.filter((j) => isPhaseActive(j.phase)).length;

  return { jobs, activeCount, config, setEnabled, setPattern, triggerManual };
}
