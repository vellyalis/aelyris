import { listen as tauriListen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { PRODUCT_NAME } from "../constants/product";
import { formatFallbackError, reportFallback } from "../lib/fallbackTelemetry";

interface UseTerminalNotificationsOptions {
  /** Currently visible tab's terminal IDs (bells from these are ignored) */
  activeTabId: string;
  /** All tabs — used to find which tab a terminal belongs to */
  tabs: { id: string; label: string }[];
  /** Callback to mark a tab as having activity */
  onTabActivity: (tabId: string) => void;
}

const TERMINAL_BELL_NOTIFICATION_KEY = "aelyris:terminalBellNotifications";
const MIN_NOTIFICATION_INTERVAL_MS = 30_000;

/**
 * Listens for terminal:bell events and triggers:
 * 1. Tab activity badge (for non-active tabs)
 * 2. Optional Windows notification, only when explicitly enabled.
 *
 * Bell events are emitted by the Rust PTY layer when \x07 is detected.
 * Claude Code uses printf '\a' hooks to signal response completion.
 */
export function useTerminalNotifications({ activeTabId, tabs, onTabActivity }: UseTerminalNotificationsOptions) {
  const lastBellTime = useRef<Record<string, number>>({});
  const lastNotificationTime = useRef<Record<string, number>>({});

  const handleBell = useCallback(
    (terminalId: string) => {
      // Debounce: ignore bells within 500ms of each other from the same terminal
      const now = Date.now();
      if (lastBellTime.current[terminalId] && now - lastBellTime.current[terminalId] < 500) return;
      lastBellTime.current[terminalId] = now;

      // Find which tab this terminal belongs to (by matching terminal IDs — for now, all tabs get notified)
      // In the future, we can map terminal IDs to tab IDs via PaneTreeContainer
      for (const tab of tabs) {
        if (tab.id !== activeTabId) {
          onTabActivity(tab.id);
        }
      }

      // Native OS toasts are intentionally opt-in. AI CLIs and shell
      // integrations can emit BEL frequently; surfacing every bell as a
      // bottom-right PowerShell/Aelyris popup is noisy and feels broken.
      if (!document.hasFocus() && terminalBellNotificationsEnabled()) {
        if (
          lastNotificationTime.current[terminalId] &&
          now - lastNotificationTime.current[terminalId] < MIN_NOTIFICATION_INTERVAL_MS
        ) {
          return;
        }
        lastNotificationTime.current[terminalId] = now;
        sendWindowsNotification(PRODUCT_NAME, "Agent has responded ✦");
      }
    },
    [activeTabId, tabs, onTabActivity],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await Promise.resolve({ listen: tauriListen });
        const handle = await listen<{ terminal_id: string }>("terminal:bell", (event) => {
          if (cancelled) return;
          handleBell(event.payload.terminal_id);
        });
        // If the effect was torn down while `listen` was still resolving,
        // detach immediately — the cleanup below ran before `unlisten` was
        // assigned, so without this post-await check the listener leaks
        // for the rest of the session.
        if (cancelled) {
          handle();
          return;
        }
        unlisten = handle;
      } catch (err) {
        reportFallback(
          {
            source: "terminal.notifications",
            operation: "listen_terminal_bell",
            severity: "info",
            message: `Tauri terminal bell listener unavailable: ${formatFallbackError(err)}`,
            userVisible: false,
          },
          { throttleMs: 60_000 },
        );
      }
    };
    void setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleBell]);
}

function terminalBellNotificationsEnabled(): boolean {
  try {
    const value = window.localStorage.getItem(TERMINAL_BELL_NOTIFICATION_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

/** Send a Windows toast notification via Tauri */
async function sendWindowsNotification(title: string, body: string) {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    let permitted = await isPermissionGranted();
    if (!permitted) {
      permitted = (await requestPermission()) === "granted";
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch (err) {
    reportFallback(
      {
        source: "terminal.notifications",
        operation: "send_windows_notification",
        severity: "warning",
        message: `Windows notification unavailable: ${formatFallbackError(err)}`,
        userVisible: true,
      },
      { throttleMs: MIN_NOTIFICATION_INTERVAL_MS },
    );
  }
}
