//! Focused coverage for the authoritative SQLite session/window/pane owner.

use aelyris_lib::db::Database;

#[test]
fn database_session_window_pane_round_trip_restores_layout() {
    let db = Database::open_memory().unwrap();
    let session = db.create_session("my-project").unwrap();
    let first_window = db.create_window(&session.id, "Tab 1").unwrap();
    let second_window = db.create_window(&session.id, "Tab 2").unwrap();
    db.create_pane(&first_window.id, "powershell", "C:/proj1", 120, 30)
        .unwrap();
    db.create_pane(&first_window.id, "cmd", "C:/proj1", 80, 24)
        .unwrap();
    db.create_pane(&second_window.id, "gitbash", "C:/proj2", 100, 25)
        .unwrap();
    db.update_window_layout(&first_window.id, "hsplit").unwrap();

    let restored = db
        .restore_last_session()
        .unwrap()
        .expect("active session should restore");
    assert_eq!(restored.session.id, session.id);
    assert_eq!(restored.windows.len(), 2);
    assert_eq!(restored.windows[0].window.layout_type, "hsplit");
    assert_eq!(restored.windows[0].panes.len(), 2);
    assert_eq!(restored.windows[0].panes[0].shell_type, "powershell");
    assert_eq!(restored.windows[0].panes[1].shell_type, "cmd");
    assert_eq!(restored.windows[1].panes[0].shell_type, "gitbash");
}

#[test]
fn database_session_delete_cascades_to_windows_and_panes() {
    let db = Database::open_memory().unwrap();
    let session = db.create_session("project").unwrap();
    let window = db.create_window(&session.id, "Tab").unwrap();
    db.create_pane(&window.id, "cmd", ".", 80, 24).unwrap();

    db.delete_session(&session.id).unwrap();

    assert!(db.list_sessions().unwrap().is_empty());
    assert!(db.list_windows(&session.id).unwrap().is_empty());
    assert!(db.list_panes(&window.id).unwrap().is_empty());
}

#[test]
fn database_deactivate_all_sessions_clears_active_state() {
    let db = Database::open_memory().unwrap();
    db.create_session("first").unwrap();
    db.create_session("second").unwrap();

    db.deactivate_all_sessions().unwrap();

    assert!(db
        .list_sessions()
        .unwrap()
        .iter()
        .all(|session| !session.is_active));
}
