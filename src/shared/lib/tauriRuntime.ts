type TauriWindow = Window &
  typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
      transformCallback?: unknown;
    };
  };

export function isTauriRuntime(): boolean {
  if (import.meta.env.MODE === "test") return true;
  if (typeof window === "undefined") return false;
  const w = window as TauriWindow;
  return (
    typeof w.__TAURI_INTERNALS__?.invoke === "function" &&
    typeof w.__TAURI_INTERNALS__?.transformCallback === "function"
  );
}

export function getAetherHost(): "tauri" | "browser" {
  return isTauriRuntime() ? "tauri" : "browser";
}
