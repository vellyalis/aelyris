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
        ",
    )?;

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
