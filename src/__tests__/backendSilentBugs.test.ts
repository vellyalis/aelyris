import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../src-tauri/src/{session/manager.rs,git/worktree.rs,workflow/executor.rs}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sourceFor(suffix: string): string {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(suffix));
  expect(entry).toBeDefined();
  return entry?.[1] ?? "";
}

describe("backend silent state guards", () => {
  it("spawns session panes before DB insert and rolls back PTY on DB failure", () => {
    const src = sourceFor("session/manager.rs");
    const handler = src.match(/pub fn create_pane[\s\S]*?Ok\(\(pane, terminal_id\)\)/);
    expect(handler).not.toBeNull();
    const body = handler?.[0] ?? "";

    expect(body.indexOf("pty_manager.spawn")).toBeLessThan(body.indexOf("db.create_pane"));
    expect(body).toMatch(/Err\(err\)\s*=>\s*\{\s*let _ = pty_manager\.close\(&terminal_id\)/);
  });

  it("does not delete persisted panes when PTY close fails", () => {
    const src = sourceFor("session/manager.rs");
    const handler = src.match(/pub fn close_pane[\s\S]*?self\.with_db\(\|db\| db\.delete_pane\(pane_id\)\)/);
    expect(handler).not.toBeNull();
    const body = handler?.[0] ?? "";

    expect(body).toMatch(/pty_manager\.close\(terminal_id\)\.map_err\(\|e\| e\.to_string\(\)\)\?/);
    expect(body.indexOf("pty_manager.close")).toBeLessThan(body.indexOf("db.delete_pane"));
  });

  it("reports branch deletion failure when removing a worktree should delete the branch", () => {
    const src = sourceFor("git/worktree.rs");
    const handler = src.match(/if delete_branch \{[\s\S]*?\n    \}/);
    expect(handler).not.toBeNull();
    const body = handler?.[0] ?? "";

    expect(body).toMatch(/args\(\["branch", "-D", worktree_name\]\)/);
    expect(body).toMatch(/show-ref/);
    expect(body).toMatch(/return Err\(format!\("Branch deletion failed:/);
  });

  it("rejects quality-gate approval after a workflow is already complete", () => {
    const src = sourceFor("workflow/executor.rs");

    expect(src).toMatch(/ok_or\("Workflow already complete"\)\?/);
    expect(src).toMatch(/approve_gate_rejects_repeated_approval_after_completion/);
  });
});
