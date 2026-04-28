import { useCallback, useEffect, useRef } from "react";

interface UseTerminalNotificationsOptions {
  /** Currently visible tab's terminal IDs (bells from these are ignored) */
  activeTabId: string;
  /** All tabs — used to find which tab a terminal belongs to */
  tabs: { id: string; label: string }[];
  /** Callback to mark a tab as having activity */
  onTabActivity: (tabId: string) => void;
}

/**
 * Listens for terminal:bell events and triggers:
 * 1. Tab activity badge (for non-active tabs)
 * 2. Windows notification (if app is not focused)
 *
 * Bell events are emitted by the Rust PTY layer when \x07 is detected.
 * Claude Code uses printf '\a' hooks to signal response completion.
 */
export function useTerminalNotifications({ activeTabId, tabs, onTabActivity }: UseTerminalNotificationsOptions) {
  const lastBellTime = useRef<Record<string, number>>({});

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

      // Windows notification if window is not focused
      if (!document.hasFocus()) {
        sendWindowsNotification("Aether Terminal", "Agent has responded ✦");
      }
    },
    [activeTabId, tabs, onTabActivity],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
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
      } catch {
        /* not in Tauri */
      }
    };
    void setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleBell]);
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
  } catch {
    // notification plugin not available — silent fallback
  }
}
