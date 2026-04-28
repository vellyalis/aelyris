import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../src-tauri/src/ipc/interactive_commands.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("interactive command worktree removal failure handling", () => {
  it("does not unregister the session when remove_worktree fails", () => {
    const src = Object.values(sources)[0];

    const fnMatch = src.match(/pub fn end_session_and_remove_worktree[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch?.[0] ?? "";
    const removeFailureIndex = body.indexOf("failed to remove worktree for session");
    const unregisterIndex = body.indexOf("session_mgr.unregister");

    expect(removeFailureIndex).toBeGreaterThan(0);
    expect(body).toMatch(/return Err\(message\)/);
    expect(body).toMatch(/emit_interactive_sessions\(&app,\s*&session_mgr\)/);
    expect(unregisterIndex).toBeGreaterThan(removeFailureIndex);
  });
});
