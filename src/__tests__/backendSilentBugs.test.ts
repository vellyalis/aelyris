import { describe, expect, it } from "vitest";

const sources = import.meta.glob(
  "../../src-tauri/src/{session/manager.rs,git/worktree.rs,workflow/executor.rs,db/migrations.rs,db/queries.rs,ipc/commands.rs,lib.rs}",
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

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
    const handler = src.match(/if delete_branch \{[\s\S]*?\n {4}\}/);
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

  it("persists redacted audit events for terminal and workflow operations", () => {
    const migrations = sourceFor("db/migrations.rs");
    const queries = sourceFor("db/queries.rs");
    const commands = sourceFor("ipc/commands.rs");
    const lib = sourceFor("lib.rs");

    expect(migrations).toContain("CREATE TABLE IF NOT EXISTS audit_events");
    expect(migrations).toContain("idx_audit_events_entity");
    expect(queries).toContain("pub struct AuditEventRecord");
    expect(queries).toContain("pub fn save_audit_event");
    expect(queries).toContain("pub fn recent_audit_events");
    expect(commands).toContain("fn record_audit_event");
    expect(commands).toContain('"write_failed"');
    expect(commands).toContain('"phase_done"');
    expect(commands).toContain('"containsEnter"');
    expect(commands).not.toContain('"data": data');
    expect(commands).not.toContain('"command": command');
    expect(lib).toContain("ipc::recent_audit_events");
  });

  it("persists frontend agent telemetry snapshots in the session database", () => {
    const migrations = sourceFor("db/migrations.rs");
    const queries = sourceFor("db/queries.rs");
    const commands = sourceFor("ipc/commands.rs");
    const lib = sourceFor("lib.rs");

    expect(migrations).toContain("CREATE TABLE IF NOT EXISTS agent_telemetry_snapshots");
    expect(queries).toContain("pub fn save_agent_telemetry_snapshot");
    expect(queries).toContain("pub fn list_agent_telemetry_snapshots");
    expect(queries).toContain("validate_agent_telemetry_snapshot");
    expect(commands).toContain("pub fn save_agent_telemetry_snapshot");
    expect(commands).toContain("pub fn list_agent_telemetry_snapshots");
    expect(lib).toContain("ipc::save_agent_telemetry_snapshot");
    expect(lib).toContain("ipc::list_agent_telemetry_snapshots");
  });

  it("rejects empty terminal key payloads before pane writes", () => {
    const commands = sourceFor("ipc/commands.rs");

    expect(commands).toContain("fn validate_keys_payload");
    expect(commands).toContain('return Err("Input data is required".to_string())');
    expect(commands).toContain("validate_keys_payload(&data)?;");
    expect(commands.match(/validate_keys_payload\(&data\)\?;/g)?.length).toBeGreaterThanOrEqual(6);
    expect(commands).not.toContain("validate_keys_size(&data)?;");
  });

  it("suppresses waiter exit events before intentional terminal closes", () => {
    const commands = sourceFor("ipc/commands.rs");
    const closeTerminal = commands.match(/pub (?:async )?fn close_terminal[\s\S]*?\n\}/)?.[0] ?? "";

    expect(closeTerminal).toContain("next_generation(&id)");
    expect(closeTerminal.indexOf("next_generation(&id)")).toBeLessThan(closeTerminal.indexOf("spawn_blocking"));
    expect(commands).toContain('"stale_exit_suppressed"');
  });

  it("treats terminal close as idempotent registry cleanup after natural exit", () => {
    const commands = sourceFor("ipc/commands.rs");
    const closeTerminal = commands.match(/pub (?:async )?fn close_terminal[\s\S]*?\n\}/)?.[0] ?? "";

    expect(closeTerminal).toContain("Err(PtyError::NotFound(_)) => true");
    expect(closeTerminal.indexOf("Err(PtyError::NotFound(_)) => true")).toBeLessThan(
      closeTerminal.indexOf("PaneRegistry>().remove(&id)"),
    );
    expect(closeTerminal).toContain('"close_already_cleaned"');
    expect(closeTerminal).toContain("NativeTerminalRegistry>>().remove(&id)");
  });

  it("rejects successful zero-target pane broadcasts", () => {
    const commands = sourceFor("ipc/commands.rs");
    const broadcastKeys = commands.match(/pub (?:async )?fn broadcast_keys[\s\S]*?\n\}/)?.[0] ?? "";

    expect(broadcastKeys).toContain("if ids.is_empty()");
    expect(broadcastKeys).toContain('let err = "No active terminal panes".to_string()');
    expect(broadcastKeys).toContain("return Err(err)");
    expect(broadcastKeys).toContain("if count == 0");
    expect(broadcastKeys).toContain('return Err(last_error.unwrap_or_else(|| "No pane accepted input".to_string()))');
  });

  it("registers the read-only performance observatory IPC surface", () => {
    const commands = sourceFor("ipc/commands.rs");
    const lib = sourceFor("lib.rs");

    expect(commands).toContain("pub struct PerformanceObservatoryMetrics");
    expect(commands).toContain("pub async fn performance_observatory_metrics");
    expect(commands).toContain("scrollback_estimated_bytes");
    expect(commands).toContain("PTY_OUTPUT_BATCH_MAX_BYTES");
    expect(lib).toContain("ipc::performance_observatory_metrics");
  });
});
