pub mod agent;
mod config;
pub mod db;
mod git;
pub mod gpu;
mod ipc;
pub mod lsp;
pub mod pty;
pub mod session;
mod watcher;
pub mod watchdog;
pub mod workflow;

use tauri::Manager;
use agent::AgentManager;
use db::Database;
use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    let t0 = std::time::Instant::now();
    log::info!("Aether Terminal starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::new())
        .manage(AgentManager::new())
        .manage(ipc::OutputBufferRegistry::new())
        .manage(pty::PaneRegistry::new())
        .manage(ipc::FsWatcherRegistry::new())
        .manage(workflow::WorkflowExecutor::new())
        .manage(lsp::LspManager::new())
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
            // Mica/Acrylic applied via tauri.conf.json windowEffects
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
            // Workspace pane commands
            ipc::send_keys,
            ipc::broadcast_keys,
            ipc::capture_pane,
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
            // Agent session persistence
            ipc::save_agent_to_db,
            ipc::update_agent_in_db,
            ipc::list_agent_history,
            // LSP commands
            ipc::lsp_start,
            ipc::lsp_request,
            ipc::lsp_stop,
            ipc::lsp_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether Terminal");
}
