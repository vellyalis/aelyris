mod config;
mod git;
mod ipc;
mod pty;

use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::new())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aether Terminal");
}
