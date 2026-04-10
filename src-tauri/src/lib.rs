pub mod agent;
mod config;
pub mod db;
mod git;
mod ipc;
pub mod pty;
pub mod session;
pub mod watchdog;

use agent::AgentManager;
use db::Database;
use pty::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    log::info!("Aether Terminal starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::new())
        .manage(AgentManager::new())
        .setup(|app| {
            // Initialize database
            let db_path = db::db_path();
            match Database::open(&db_path) {
                Ok(_db) => {
                    log::info!("Database initialized at {:?}", db_path);
                }
                Err(e) => {
                    log::error!("Failed to initialize database: {}", e);
                }
            }

            // Apply Mica/Acrylic transparency
            let window = app.get_webview_window("main")
                .expect("main window not found");
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::{apply_mica, apply_acrylic};
                if apply_mica(&window, Some(true)).is_err() {
                    // Win10 fallback: Acrylic with dark tint
                    let _ = apply_acrylic(&window, Some((13, 13, 13, 200)));
                }
            }

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
            ipc::list_directory,
            ipc::git_status,
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
            // Session management
            ipc::create_session,
            ipc::list_db_sessions,
            ipc::delete_session,
            ipc::restore_last_session,
            ipc::create_window,
            ipc::create_pane,
            ipc::save_session_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether Terminal");
}
