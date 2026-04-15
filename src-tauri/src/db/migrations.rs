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
        ",
    )?;

    // Enable WAL mode for better concurrent read performance
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Enable foreign keys
    conn.pragma_update(None, "foreign_keys", "ON")?;

    Ok(())
}
