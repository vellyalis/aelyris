import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../src-tauri/src/ipc/interactive_commands.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("interactive command worktree removal failure handling", () => {
  it("does not unregister the session when remove_worktree fails", () => {
    const src = Object.values(sources)[0];

    const fnMatch = src.match(/pub async fn end_session_and_remove_worktree[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    const removeFailureIndex = body.indexOf("failed to remove worktree for session");
    const unregisterIndex = body.indexOf("session_mgr.unregister");

    expect(removeFailureIndex).toBeGreaterThan(0);
    expect(body).toMatch(/return Err\(message\)/);
    expect(body).toMatch(/emit_interactive_sessions\(&app,\s*&session_mgr\)/);
    expect(unregisterIndex).toBeGreaterThan(removeFailureIndex);
  });

  it("routes interactive AI CLI sessions through the sidecar command boundary first", () => {
    const src = Object.values(sources)[0];

    const fnMatch = src.match(/pub async fn spawn_interactive_agent[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";

    expect(body).toContain("try_state::<PtySidecarState>()");
    expect(body).toContain(".spawn_command(");
    expect(body).toContain("client.subscribe_output");
    expect(body).toContain('"sidecar".to_string()');
    expect(body).toContain('"native".to_string()');
    expect(body).toContain("backend: backend.clone()");
    expect(body.indexOf(".spawn_command(")).toBeLessThan(body.indexOf("pty_manager.spawn_command"));
  });

  it("stops interactive sessions through sidecar close before native fallback", () => {
    const src = Object.values(sources)[0];

    expect(src).toContain("async fn close_interactive_pty");
    const fnMatch = src.match(/async fn close_interactive_pty[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";

    expect(body).toContain("try_state::<PtySidecarState>()");
    expect(body).toContain("client.close(pty_id).await");
    expect(body.indexOf("client.close(pty_id).await")).toBeLessThan(body.indexOf("pty_manager.close"));
  });
});
