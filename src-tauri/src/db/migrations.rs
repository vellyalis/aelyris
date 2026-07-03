use rusqlite::Connection;

/// Run all migrations (idempotent — safe to call on every startup)
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            is_active   INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS windows (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            layout_type TEXT NOT NULL DEFAULT 'single'
        );

        CREATE TABLE IF NOT EXISTS panes (
            id          TEXT PRIMARY KEY,
            window_id   TEXT NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
            shell_type  TEXT NOT NULL DEFAULT 'cmd',
            cwd         TEXT NOT NULL DEFAULT '.',
            cols        INTEGER NOT NULL DEFAULT 120,
            rows        INTEGER NOT NULL DEFAULT 30,
            flex_basis  REAL NOT NULL DEFAULT 1.0,
            position    TEXT NOT NULL DEFAULT 'center'
        );

        CREATE TABLE IF NOT EXISTS pane_tree_layouts (
            storage_key  TEXT PRIMARY KEY,
            project_path TEXT NOT NULL DEFAULT '',
            layout_json  TEXT NOT NULL,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pane_tree_layouts_project
            ON pane_tree_layouts(project_path, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_sessions (
            id          TEXT PRIMARY KEY,
            pane_id     TEXT REFERENCES panes(id) ON DELETE SET NULL,
            model       TEXT NOT NULL,
            prompt      TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'idle',
            cost        REAL NOT NULL DEFAULT 0.0,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            started_at  TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS agent_telemetry_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_json TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'frontend',
            saved_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_telemetry_snapshots_saved
            ON agent_telemetry_snapshots(saved_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS command_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id TEXT NOT NULL,
            command     TEXT NOT NULL,
            cwd         TEXT NOT NULL DEFAULT '.',
            exit_code   INTEGER,
            executed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_command_history_terminal
            ON command_history(terminal_id);
        CREATE INDEX IF NOT EXISTS idx_command_history_command
            ON command_history(command);

        CREATE TABLE IF NOT EXISTS terminal_command_blocks (
            id                   TEXT NOT NULL,
            terminal_id          TEXT NOT NULL,
            command_history_id   INTEGER NOT NULL,
            command              TEXT NOT NULL,
            cwd                  TEXT NOT NULL DEFAULT '.',
            status               TEXT NOT NULL DEFAULT 'running',
            exit_code            INTEGER,
            command_sequence     INTEGER,
            output_sequence      INTEGER,
            end_sequence         INTEGER,
            command_history_size INTEGER,
            output_history_size  INTEGER,
            end_history_size     INTEGER,
            command_screen_line  INTEGER,
            output_screen_line   INTEGER,
            end_screen_line      INTEGER,
            updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (terminal_id, command_history_id),
            FOREIGN KEY(command_history_id) REFERENCES command_history(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_terminal_command_blocks_terminal_updated
            ON terminal_command_blocks(terminal_id, updated_at DESC, command_history_id DESC);

        CREATE TABLE IF NOT EXISTS activity_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            session_name TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            summary     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(timestamp DESC);

        CREATE TABLE IF NOT EXISTS usage_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            cli         TEXT NOT NULL,
            cost        REAL NOT NULL DEFAULT 0,
            tokens      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_log(timestamp DESC);

        CREATE TABLE IF NOT EXISTS audit_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            category    TEXT NOT NULL,
            action      TEXT NOT NULL,
            severity    TEXT NOT NULL DEFAULT 'info',
            entity_type TEXT,
            entity_id   TEXT,
            summary     TEXT NOT NULL,
            metadata    TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_audit_events_ts
            ON audit_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_category
            ON audit_events(category, action, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_entity
            ON audit_events(entity_type, entity_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS audit_event_sequence (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            next_sequence INTEGER NOT NULL DEFAULT 1
        );
        INSERT OR IGNORE INTO audit_event_sequence (id, next_sequence)
            VALUES (1, 1);

        CREATE TABLE IF NOT EXISTS audit_event_journal (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id          TEXT NOT NULL,
            thread_id             TEXT,
            session_id            TEXT,
            pane_id               TEXT,
            terminal_id           TEXT,
            agent_id              TEXT,
            workflow_id           TEXT,
            task_id               TEXT,
            correlation_id        TEXT NOT NULL,
            sequence              INTEGER NOT NULL UNIQUE,
            kind                  TEXT NOT NULL,
            severity              TEXT NOT NULL DEFAULT 'info',
            source                TEXT NOT NULL,
            confidence            REAL NOT NULL DEFAULT 1.0,
            created_at            TEXT NOT NULL,
            payload_json          TEXT NOT NULL,
            redacted_payload_json TEXT NOT NULL,
            hash                  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_workspace_sequence
            ON audit_event_journal(workspace_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_correlation
            ON audit_event_journal(correlation_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_terminal
            ON audit_event_journal(terminal_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_agent
            ON audit_event_journal(agent_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_task
            ON audit_event_journal(task_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_audit_event_journal_kind
            ON audit_event_journal(kind, severity, sequence);
        CREATE TRIGGER IF NOT EXISTS audit_event_journal_no_update
            BEFORE UPDATE ON audit_event_journal
        BEGIN
            SELECT RAISE(ABORT, 'audit_event_journal rows are append-only');
        END;
        UPDATE audit_event_sequence
        SET next_sequence = CASE
            WHEN next_sequence < (
                SELECT COALESCE(MAX(sequence), 0) + 1 FROM audit_event_journal
            )
            THEN (
                SELECT COALESCE(MAX(sequence), 0) + 1 FROM audit_event_journal
            )
            ELSE next_sequence
        END
        WHERE id = 1;

        CREATE TABLE IF NOT EXISTS audit_event_snapshots (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id     TEXT NOT NULL,
            through_sequence INTEGER NOT NULL,
            event_count      INTEGER NOT NULL,
            snapshot_json    TEXT NOT NULL,
            created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_event_snapshots_workspace
            ON audit_event_snapshots(workspace_id, through_sequence DESC, id DESC);

        CREATE TABLE IF NOT EXISTS terminal_output_journal (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            terminal_id TEXT NOT NULL,
            captured_at TEXT NOT NULL DEFAULT (datetime('now')),
            byte_count  INTEGER NOT NULL DEFAULT 0,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            text        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_terminal_output_journal_terminal
            ON terminal_output_journal(terminal_id, id DESC);

        -- Phase 3B-2: semantic history search. One row per indexed command.
        -- vector is a little-endian f32 BLOB of length dim*4.
        CREATE TABLE IF NOT EXISTS command_embeddings (
            command_id  INTEGER PRIMARY KEY REFERENCES command_history(id) ON DELETE CASCADE,
            dim         INTEGER NOT NULL,
            vector      BLOB    NOT NULL,
            model       TEXT    NOT NULL,
            indexed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_command_embeddings_indexed_at
            ON command_embeddings(indexed_at DESC);

        CREATE TABLE IF NOT EXISTS workspace_items (
            id           TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            item_type    TEXT NOT NULL,
            title        TEXT NOT NULL,
            body         TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'open',
            owner        TEXT,
            source       TEXT NOT NULL DEFAULT 'rust',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_workspace_items_workspace
            ON workspace_items(workspace_id, item_type, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_workspace_items_status
            ON workspace_items(workspace_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS mode_preservation_snapshots (
            id            TEXT PRIMARY KEY,
            workspace_id  TEXT NOT NULL,
            active_mode   TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mode_preservation_workspace
            ON mode_preservation_snapshots(workspace_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_identity_records (
            session_id      TEXT PRIMARY KEY,
            workspace_id    TEXT NOT NULL,
            provider        TEXT NOT NULL,
            purpose         TEXT NOT NULL,
            worktree_path   TEXT,
            context_usage_json TEXT NOT NULL DEFAULT '{}',
            auth_state      TEXT NOT NULL DEFAULT 'unknown',
            install_state   TEXT NOT NULL DEFAULT 'unknown',
            binary_source   TEXT NOT NULL DEFAULT 'path',
            profile_source  TEXT NOT NULL DEFAULT 'workspace',
            usage_limits_json TEXT NOT NULL DEFAULT '{}',
            guardrail_profile TEXT NOT NULL DEFAULT 'manual',
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_identity_workspace
            ON agent_identity_records(workspace_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS history_search_entries (
            id            TEXT PRIMARY KEY,
            workspace_id  TEXT NOT NULL,
            entry_type    TEXT NOT NULL,
            entity_id     TEXT NOT NULL,
            title         TEXT NOT NULL,
            body          TEXT NOT NULL DEFAULT '',
            provenance_id TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_history_search_workspace
            ON history_search_entries(workspace_id, entry_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_search_text
            ON history_search_entries(title, body);

        -- User-assigned pane names/roles keyed by terminal id, so panes
        -- re-adopted from the PTY sidecar daemon after an app restart keep
        -- their identity (which agent ran where) instead of resetting to
        -- bare shell names.
        CREATE TABLE IF NOT EXISTS pane_metadata (
            terminal_id TEXT PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            role        TEXT NOT NULL DEFAULT '',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Runtime Hardening P1: durable Agent Runtime Core state. The Context
        -- Store (shared ADR) and Task Graph were in-memory only and lost on
        -- restart; these tables make them survive. See docs/hardening/02_SPEC.md.
        CREATE TABLE IF NOT EXISTS context_decisions (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS intents (
            id           TEXT PRIMARY KEY,
            agent_id     TEXT NOT NULL,
            proposal     TEXT NOT NULL,
            targets_json TEXT NOT NULL DEFAULT '[]',
            status       TEXT NOT NULL DEFAULT 'open' CHECK (
                status IN ('open', 'accepted', 'rejected', 'superseded')
            ),
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
        );
        CREATE INDEX IF NOT EXISTS idx_intents_status_created
            ON intents(status, created_at);

        CREATE TABLE IF NOT EXISTS tasks (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            status           TEXT NOT NULL DEFAULT 'pending',
            owner            TEXT,
            model            TEXT,
            priority         TEXT NOT NULL DEFAULT 'medium',
            estimate         INTEGER,
            outputs_json     TEXT NOT NULL DEFAULT '[]',
            source_branch    TEXT,
            target_branch    TEXT,
            crash_attempts   INTEGER NOT NULL DEFAULT 0,
            rework_attempts  INTEGER NOT NULL DEFAULT 0,
            timeout_attempts INTEGER NOT NULL DEFAULT 0,
            sort_order       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(sort_order);

        CREATE TABLE IF NOT EXISTS task_dependencies (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            dep_id  TEXT NOT NULL,
            PRIMARY KEY (task_id, dep_id)
        );

        -- Runtime Hardening P3: durable, append-only coordination event log. The
        -- in-memory Event Bus ring (cap 256) silently evicts old events, so a
        -- slow poller or a restart loses notifications. This log keeps every
        -- event with a monotonic `seq` so subscribers poll `seq > cursor` and
        -- never miss one (no-loss). See docs/hardening/02_SPEC.md.
        CREATE TABLE IF NOT EXISTS agent_events (
            seq          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind         TEXT NOT NULL,
            channel      TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT 'null',
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_channel_seq
            ON agent_events(channel, seq);

        -- The Knowledge Graph (code dependency map agents reason over), brought in
        -- from the shared-brain work. Persisted as a whole-graph snapshot
        -- (atomically replaced) so the populated graph survives an app restart
        -- instead of resetting to empty. `node_json` holds the full serde CodeNode
        -- (forward-compatible via #[serde(default)]). Context Store + Task Graph
        -- persistence is owned by P1 above (context_decisions / tasks), so the
        -- shared-brain duplicates of those tables are intentionally not created.
        CREATE TABLE IF NOT EXISTS code_graph_nodes (
            id         TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL,
            kind       TEXT NOT NULL,
            node_json  TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_order
            ON code_graph_nodes(sort_order);
        CREATE TABLE IF NOT EXISTS code_graph_edges (
            dependent  TEXT NOT NULL,
            dependency TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY (dependent, dependency)
        );
        CREATE INDEX IF NOT EXISTS idx_code_graph_edges_order
            ON code_graph_edges(sort_order);

        -- Shared-brain G3: durable active ownership projection. Context decisions
        -- and the event stream already persist; these rows close the restart-loss
        -- gap for who-owns-which-lane-right-now without introducing a redundant
        -- raw brain_snapshots table.
        CREATE TABLE IF NOT EXISTS file_ownership_claims (
            claim_id         TEXT PRIMARY KEY,
            task_id          TEXT,
            agent_id         TEXT NOT NULL,
            pattern          TEXT NOT NULL,
            lease_expires_at INTEGER,
            updated_at       INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_file_ownership_agent_pattern
            ON file_ownership_claims(agent_id, pattern);
        CREATE INDEX IF NOT EXISTS idx_file_ownership_task
            ON file_ownership_claims(task_id);
        CREATE INDEX IF NOT EXISTS idx_file_ownership_lease
            ON file_ownership_claims(lease_expires_at);

        CREATE TABLE IF NOT EXISTS symbol_ownership_claims (
            claim_id         TEXT PRIMARY KEY,
            agent_id         TEXT NOT NULL,
            task_id          TEXT,
            path             TEXT NOT NULL,
            symbol           TEXT NOT NULL,
            start_line       INTEGER NOT NULL,
            end_line         INTEGER NOT NULL,
            mode             TEXT NOT NULL,
            confidence       TEXT NOT NULL,
            lease_expires_at INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_symbol_ownership_agent
            ON symbol_ownership_claims(agent_id);
        CREATE INDEX IF NOT EXISTS idx_symbol_ownership_task
            ON symbol_ownership_claims(task_id);
        CREATE INDEX IF NOT EXISTS idx_symbol_ownership_path
            ON symbol_ownership_claims(path);
        CREATE INDEX IF NOT EXISTS idx_symbol_ownership_lease
            ON symbol_ownership_claims(lease_expires_at);

        -- WU-RT-1 RT-1c: visible CLI session lifecycle checkpoints. These rows
        -- keep logical session identity separate from transient PTY ids so a
        -- recycled visible agent can restore metadata after restart.
        CREATE TABLE IF NOT EXISTS session_checkpoints (
            logical_session_id     TEXT NOT NULL,
            checkpoint_seq         INTEGER NOT NULL,
            pty_id                 TEXT NOT NULL,
            cli                    TEXT NOT NULL,
            model                  TEXT NOT NULL,
            cwd                    TEXT NOT NULL,
            worktree_branch        TEXT,
            worktree_path          TEXT,
            repo_path              TEXT,
            status                 TEXT NOT NULL,
            cost                   REAL NOT NULL DEFAULT 0,
            tokens_used            INTEGER NOT NULL DEFAULT 0,
            started_at             INTEGER NOT NULL,
            last_activity          INTEGER NOT NULL,
            turn_count             INTEGER NOT NULL DEFAULT 0,
            context_remaining_json TEXT,
            summary_json           TEXT,
            summary_path           TEXT,
            inflight_ref           TEXT,
            predecessor_session_id TEXT,
            created_at             INTEGER NOT NULL,
            updated_at             INTEGER NOT NULL,
            PRIMARY KEY (logical_session_id, checkpoint_seq)
        );
        CREATE INDEX IF NOT EXISTS idx_session_checkpoints_latest
            ON session_checkpoints(logical_session_id, checkpoint_seq DESC);
        CREATE INDEX IF NOT EXISTS idx_session_checkpoints_lineage
            ON session_checkpoints(predecessor_session_id);

        -- WU-RT-1 RT-1c: durable handoff intent/state rows. RT-1d will advance
        -- these states before any irreversible predecessor retire.
        CREATE TABLE IF NOT EXISTS session_handoffs (
            predecessor_id TEXT NOT NULL,
            successor_id   TEXT NOT NULL,
            handoff_seq    INTEGER NOT NULL,
            state          TEXT NOT NULL DEFAULT 'pending_summary' CHECK (
                state IN (
                    'pending_summary', 'checkpointed', 'successor_spawning',
                    'successor_spawned', 'successor_acked',
                    'predecessor_retired', 'failed'
                )
            ),
            correlation_id TEXT NOT NULL,
            checkpoint_seq INTEGER,
            summary_path   TEXT,
            failure_reason TEXT,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL,
            PRIMARY KEY (predecessor_id, handoff_seq)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_handoffs_correlation
            ON session_handoffs(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_session_handoffs_state
            ON session_handoffs(state);
        CREATE TRIGGER IF NOT EXISTS trg_session_handoffs_immutable
        BEFORE UPDATE ON session_handoffs
        FOR EACH ROW WHEN
               NEW.predecessor_id IS NOT OLD.predecessor_id
            OR NEW.successor_id   IS NOT OLD.successor_id
            OR NEW.handoff_seq    IS NOT OLD.handoff_seq
            OR NEW.correlation_id IS NOT OLD.correlation_id
            OR NEW.created_at     IS NOT OLD.created_at
        BEGIN
            SELECT RAISE(ABORT, 'session_handoffs: handoff-defining columns are immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS trg_session_handoffs_no_delete
        BEFORE DELETE ON session_handoffs
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'session_handoffs: rows are permanent (append-only)');
        END;
        -- P0-3 world-release hardening: durable, IMMUTABLE merge intents. The MCP
        -- merge approval path (aelyris.request_merge -> aelyris.review.approve) kept
        -- intents in a RAM Vec and let the approver supply repo/source/target, so
        -- an intent id was a mere token a caller could re-point at any merge. These
        -- rows are the source of truth: the merge-defining columns are captured at
        -- request time and an UPDATE trigger makes them immutable, so approve takes
        -- only an intentId and can never be redirected.
        CREATE TABLE IF NOT EXISTS merge_intents (
            -- NOT NULL is explicit: a rowid-table PRIMARY KEY allows NULL in
            -- SQLite, and a NULL id would let the immutability trigger's
            -- comparison evaluate to NULL (not true) and be bypassed.
            intent_id      TEXT NOT NULL PRIMARY KEY,
            repo_path      TEXT NOT NULL,
            source_branch  TEXT NOT NULL,
            target_branch  TEXT NOT NULL,
            source_oid     TEXT NOT NULL,
            target_oid     TEXT NOT NULL,
            merge_base_oid TEXT,
            task_id        TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
            state          TEXT NOT NULL DEFAULT 'queued',
            updated_at     INTEGER NOT NULL,
            session_id     TEXT,
            reviewer_id    TEXT,
            gates_digest   TEXT
        );
        -- Idempotency key (audit §P0-3): one intent per (task, source commit,
        -- target commit). A duplicate request_merge resolves to the existing one.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_intents_idempotency
            ON merge_intents(task_id, source_oid, target_oid);
        CREATE INDEX IF NOT EXISTS idx_merge_intents_state
            ON merge_intents(state);
        -- Immutability guard (hard boundary #4): the merge-defining columns can
        -- NEVER change after creation. Only state/updated_at and late metadata
        -- (session_id/reviewer_id/gates_digest) are mutable. `IS NOT` is the
        -- null-safe distinct operator: it is true when exactly one side is NULL
        -- (so a NULL intent_id or a merge_base_oid flip between NULL and '' is
        -- caught), unlike `<>`/`IFNULL` which would let those through.
        CREATE TRIGGER IF NOT EXISTS trg_merge_intents_immutable
        BEFORE UPDATE ON merge_intents
        FOR EACH ROW WHEN
               NEW.intent_id      IS NOT OLD.intent_id
            OR NEW.repo_path      IS NOT OLD.repo_path
            OR NEW.source_branch  IS NOT OLD.source_branch
            OR NEW.target_branch  IS NOT OLD.target_branch
            OR NEW.source_oid     IS NOT OLD.source_oid
            OR NEW.target_oid     IS NOT OLD.target_oid
            OR NEW.merge_base_oid IS NOT OLD.merge_base_oid
            OR NEW.task_id        IS NOT OLD.task_id
            OR NEW.created_at     IS NOT OLD.created_at
        BEGIN
            SELECT RAISE(ABORT, 'merge_intents: merge-defining columns are immutable');
        END;
        -- Append-only guard: a merge intent is a permanent audit record. Blocking
        -- DELETE also closes the `INSERT OR REPLACE` bypass — REPLACE deletes the
        -- conflicting row first, and with recursive_triggers ON (set below) this
        -- BEFORE DELETE fires and aborts the whole statement, so REPLACE cannot
        -- rewrite the immutable columns the UPDATE trigger protects.
        CREATE TRIGGER IF NOT EXISTS trg_merge_intents_no_delete
        BEFORE DELETE ON merge_intents
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'merge_intents: rows are permanent (append-only)');
        END;
        ",
    )?;

    // REPLACE-conflict deletes only fire DELETE triggers when recursive triggers
    // are enabled; the append-only guard above relies on this to block an
    // `INSERT OR REPLACE` that would otherwise rewrite immutable merge columns.
    conn.pragma_update(None, "recursive_triggers", "ON")?;

    // Enable WAL mode for better concurrent read performance
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Enable foreign keys
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Wait for the WAL write lock instead of failing immediately. The Context
    // Store and Task Graph managers each open their OWN connection to this file
    // (Runtime Hardening P1), so three+ writers now contend. Without a busy
    // timeout a contended write-through returns SQLITE_BUSY at once and would be
    // logged-and-dropped — a silent durability hole that defeats "SQLite = the
    // source of truth". A modest timeout makes the loser wait for the lock.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent_and_create_runtime_core_tables() {
        let conn = Connection::open_in_memory().unwrap();
        // Running twice must not error (IF NOT EXISTS / INSERT OR IGNORE).
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        // P1 Context Store table round-trips a decision.
        conn.execute(
            "INSERT INTO context_decisions (key, value) VALUES (?1, ?2)",
            ["auth_method", "jwt"],
        )
        .unwrap();
        let value: String = conn
            .query_row(
                "SELECT value FROM context_decisions WHERE key = ?1",
                ["auth_method"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "jwt");

        conn.execute(
            "INSERT INTO intents
             (id, agent_id, proposal, targets_json, status, created_at)
             VALUES ('intent-1', 'agent-a', 'extract AuthService', '[\"src/auth.rs\"]', 'open', 100)",
            [],
        )
        .unwrap();
        let intent_status: String = conn
            .query_row(
                "SELECT status FROM intents WHERE id = 'intent-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(intent_status, "open");

        // P1 Task tables: a task plus a dependency edge survive insert/select.
        conn.execute("INSERT INTO tasks (id, title) VALUES ('a', 'A')", [])
            .unwrap();
        conn.execute("INSERT INTO tasks (id, title) VALUES ('b', 'B')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO task_dependencies (task_id, dep_id) VALUES ('b', 'a')",
            [],
        )
        .unwrap();
        let dep: String = conn
            .query_row(
                "SELECT dep_id FROM task_dependencies WHERE task_id = 'b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dep, "a");

        conn.execute(
            "INSERT INTO file_ownership_claims
             (claim_id, agent_id, pattern, updated_at)
             VALUES ('file:a:src/**', 'a', 'src/**', 1)",
            [],
        )
        .unwrap();
        let file_owner: String = conn
            .query_row(
                "SELECT agent_id FROM file_ownership_claims WHERE claim_id = 'file:a:src/**'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(file_owner, "a");

        conn.execute(
            "INSERT INTO symbol_ownership_claims
             (claim_id, agent_id, path, symbol, start_line, end_line, mode, confidence,
              lease_expires_at, updated_at)
             VALUES ('s1', 'a', 'src/x.rs', 'f', 1, 3, 'write', 'parser', 100, 1)",
            [],
        )
        .unwrap();
        let symbol: String = conn
            .query_row(
                "SELECT symbol FROM symbol_ownership_claims WHERE claim_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(symbol, "f");

        conn.execute(
            "INSERT INTO session_checkpoints
             (logical_session_id, checkpoint_seq, pty_id, cli, model, cwd, status,
              started_at, last_activity, turn_count, created_at, updated_at)
             VALUES ('logical-a', 1, 'pty-a', 'claude', 'sonnet', 'C:/repo', 'idle', 1, 2, 3, 4, 4)",
            [],
        )
        .unwrap();
        let checkpoint_status: String = conn
            .query_row(
                "SELECT status FROM session_checkpoints
                 WHERE logical_session_id = 'logical-a' AND checkpoint_seq = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(checkpoint_status, "idle");

        conn.execute(
            "INSERT INTO session_handoffs
             (predecessor_id, successor_id, handoff_seq, state, correlation_id, created_at, updated_at)
             VALUES ('logical-a', 'logical-b', 1, 'pending_summary', 'corr-a', 10, 10)",
            [],
        )
        .unwrap();
        let handoff_state: String = conn
            .query_row(
                "SELECT state FROM session_handoffs
                 WHERE predecessor_id = 'logical-a' AND handoff_seq = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(handoff_state, "pending_summary");
    }

    #[test]
    fn busy_timeout_is_set_so_contended_writers_wait() {
        // Guards the multi-writer durability fix: every connection that runs
        // migrations must come out with a non-zero busy_timeout, otherwise a
        // contended write-through silently fails with SQLITE_BUSY.
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let timeout_ms: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout_ms, 5000);
    }
}
