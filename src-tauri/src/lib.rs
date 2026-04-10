pub mod agent;
mod config;
mod git;
mod ipc;
pub mod pty;
pub mod watchdog;

use agent::AgentManager;
use pty::PtyManager;

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
        .setup(|_app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether Terminal");
}
