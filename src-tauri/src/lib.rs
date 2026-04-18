pub mod agent;
pub mod config;
pub mod db;
pub mod git;
pub mod history;
mod ipc;
pub mod lsp;
pub mod pty;
pub mod session;
pub mod term;
pub mod suggest;
mod watcher;
pub mod watchdog;
pub mod workflow;

use tauri::{Emitter, Manager};
use agent::AgentManager;
use agent::InteractiveSessionManager;
use db::Database;
use pty::PtyManager;
use watchdog::auto_repair::AutoRepairManager;
use suggest::SuggestEngine;
use history::{HashingNgramEmbedder, HistoryStore};

/// Store handle managed by Tauri. Wraps the default (char-n-gram) embedder;
/// the trait object abstraction is intentionally hidden here — if we ever
/// swap embedders we update this alias + call site.
pub type ManagedHistoryStore = std::sync::Arc<HistoryStore<HashingNgramEmbedder>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    let t0 = std::time::Instant::now();
    log::info!("Aether Terminal starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::new())
        .manage(AgentManager::new())
        .manage(InteractiveSessionManager::new())
        .manage(ipc::OutputBufferRegistry::new())
        .manage(pty::PaneRegistry::new())
        .manage(ipc::FsWatcherRegistry::new())
        .manage(workflow::WorkflowExecutor::new())
        .manage({
            let (tx, _rx) = std::sync::mpsc::channel();
            lsp::LspManager::new(tx)
        })
        .manage(std::sync::Arc::new(term::NativeTerminalRegistry::new()))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(AutoRepairManager::new())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            watchdog::load_watchdog_rules().auto_repair,
        )))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(SuggestEngine::new())))
        .setup(move |app| {
            // Initialize database as managed state
            let db_path = db::db_path();
            match Database::open(&db_path) {
                Ok(database) => {
                    log::info!("Database initialized at {:?}", db_path);
                    app.handle().manage(db::ManagedDb::new(database));
                }
                Err(e) => {
                    log::error!("Failed to initialize database: {}", e);
                    // Provide a fallback in-memory db so commands don't panic
                    if let Ok(mem_db) = Database::open_memory() {
                        app.handle().manage(db::ManagedDb::new(mem_db));
                    }
                }
            }

            // Phase 3B-2: HistoryStore opens a second connection to the same
            // SQLite file (WAL mode is on) so semantic indexing writes don't
            // contend with the PTY-hot save_command_history path.
            match rusqlite::Connection::open(&db_path).and_then(|c| {
                db::migrations::run_migrations(&c).map(|_| c)
            }) {
                Ok(conn) => {
                    let store = std::sync::Arc::new(HistoryStore::open(
                        conn,
                        HashingNgramEmbedder::new(),
                    ));
                    app.handle().manage::<ManagedHistoryStore>(store.clone());
                    // Backfill on a worker thread so startup stays snappy.
                    std::thread::Builder::new()
                        .name("history-backfill".into())
                        .spawn(move || match store.backfill() {
                            Ok(n) if n > 0 => log::info!("semantic history: backfilled {n} rows"),
                            Ok(_) => {}
                            Err(e) => log::warn!("semantic history backfill failed: {e}"),
                        })
                        .ok();
                }
                Err(e) => {
                    log::warn!(
                        "Failed to open HistoryStore connection (semantic search disabled): {e}"
                    );
                }
            }
            // Mica/Acrylic applied via tauri.conf.json windowEffects

            // Seed the SuggestEngine from DB command history so fish-style
            // autosuggest works on the first keystroke of a fresh session.
            if let (Some(db), Some(engine)) = (
                app.try_state::<db::ManagedDb>(),
                app.try_state::<std::sync::Arc<std::sync::Mutex<SuggestEngine>>>(),
            ) {
                let recent = db.with(|d| d.recent_commands(500)).unwrap_or_default();
                if let Ok(mut guard) = engine.inner().lock() {
                    guard.seed(recent);
                }
            }

            // Auto-repair polling thread: flush `AutoRepairManager` phase/notification
            // messages every 500ms. Active jobs are re-broadcast on every tick so the
            // UI's elapsed timers stay live without a separate clock.
            let repair_handle = app.handle().clone();
            std::thread::Builder::new()
                .name("auto-repair-poller".into())
                .spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let Some(mgr) = repair_handle
                            .try_state::<std::sync::Arc<std::sync::Mutex<AutoRepairManager>>>()
                        else {
                            continue;
                        };
                        let mgr = mgr.inner().clone();
                        let (notifications, jobs) = match mgr.lock() {
                            Ok(mut g) => (g.poll(), g.jobs()),
                            Err(_) => continue,
                        };
                        for notif in notifications {
                            let _ = repair_handle.emit("repair:notification", notif);
                        }
                        let _ = repair_handle.emit("repair:jobs-updated", jobs);
                    }
                })
                .ok();

            log::info!("Setup complete in {:?}", t0.elapsed());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::spawn_terminal,
            ipc::write_terminal,
            ipc::resize_terminal,
            ipc::close_terminal,
            ipc::list_terminals,
            ipc::detect_shells,
            ipc::term_snapshot,
            ipc::discover_projects,
            ipc::list_branches,
            ipc::list_worktrees,
            ipc::create_worktree,
            ipc::remove_worktree,
            ipc::list_directory,
            ipc::git_status,
            ipc::git_stage,
            ipc::git_unstage,
            ipc::git_stage_all,
            ipc::git_discard,
            ipc::git_commit,
            ipc::git_push,
            ipc::search_files,
            ipc::grep_files,
            ipc::git_file_original,
            ipc::git_diff_file,
            ipc::git_diff_files,
            ipc::list_pull_requests,
            ipc::get_pr_diff,
            ipc::load_app_config,
            ipc::save_app_config,
            ipc::read_file,
            ipc::write_file,
            ipc::create_file,
            ipc::rename_path,
            ipc::delete_path,
            ipc::create_directory,
            ipc::get_watchdog_rules,
            ipc::save_watchdog_rules,
            ipc::create_watchdog,
            ipc::start_agent,
            ipc::stop_agent,
            ipc::list_agents,
            ipc::route_agent,
            ipc::start_chat_agent,
            ipc::stop_chat_agent,
            ipc::save_temp_image,
            // Session management
            ipc::create_session,
            ipc::list_db_sessions,
            ipc::delete_session,
            ipc::restore_last_session,
            ipc::create_window,
            ipc::create_pane,
            ipc::save_session_state,
            // Command history
            ipc::save_command_history,
            ipc::search_command_history,
            ipc::recent_commands,
            // Workspace pane commands
            ipc::send_keys,
            ipc::broadcast_keys,
            ipc::capture_pane,
            ipc::command_blocks,
            ipc::rename_pane,
            ipc::send_keys_by_name,
            ipc::list_panes_info,
            ipc::start_fs_watcher,
            ipc::stop_fs_watcher,
            // Workflow commands
            ipc::list_workflows,
            ipc::start_workflow,
            ipc::workflow_current_phase,
            ipc::workflow_set_agent,
            ipc::workflow_phase_done,
            ipc::workflow_approve_gate,
            ipc::workflow_reject_gate,
            ipc::workflow_status,
            ipc::list_running_workflows,
            ipc::workflow_remove,
            // Agent session persistence
            ipc::save_agent_to_db,
            ipc::update_agent_in_db,
            ipc::list_agent_history,
            // LSP commands
            ipc::lsp_start,
            ipc::lsp_request,
            ipc::lsp_stop,
            ipc::lsp_list,
            ipc::list_all_files,
            // Interactive agent session commands
            ipc::spawn_interactive_agent,
            ipc::stop_interactive_agent,
            ipc::end_session_and_remove_worktree,
            ipc::list_interactive_agents,
            // Auto-repair pipeline (Phase 3A-1)
            ipc::list_repair_jobs,
            ipc::trigger_repair_manual,
            ipc::get_auto_repair_config,
            ipc::set_auto_repair_config,
            // Fish-style command suggestion (Phase 3A-2)
            ipc::suggest_next,
            ipc::suggest_record,
            // Semantic history search (Phase 3B-2)
            ipc::semantic_search_history,
            ipc::rebuild_history_index,
            // IME positioning
            ipc::set_ime_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether Terminal");
}
