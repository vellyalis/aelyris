// The MCP `tools/list` schema is one large `serde_json::json!` literal; its
// macro expansion needs more than the default recursion budget.
#![recursion_limit = "256"]

pub mod agent;
pub mod api;
pub mod audit;
pub mod config;
pub mod context_store;
pub mod control;
pub mod cost;
pub mod db;
pub mod event_bus;
pub mod failure_policy;
pub mod file_ownership;
pub mod ghostdiff;
pub mod git;
pub mod history;
pub mod intent;
mod ipc;
pub mod knowledge_graph;
pub mod logging;
pub mod lsp;
pub mod mux;
pub mod orchestrator;
pub mod persistence;
pub mod process;
pub mod pty;
pub mod pty_sidecar;
pub mod review;
pub mod session;
pub mod shell_integration;
pub mod snapshot;
pub mod suggest;
pub mod supervisor;
pub mod task;
pub mod term;
pub mod watchdog;
mod watcher;
pub mod workflow;

use agent::AgentManager;
use agent::InteractiveSessionManager;
use db::Database;
use ghostdiff::{LayerEvent, LayerRegistry, LayerTint, WatcherPool};
use history::{HashingNgramEmbedder, HistoryStore};
use pty::PtyManager;
use suggest::SuggestEngine;
use tauri::{Emitter, Manager};
use watchdog::auto_repair::{AutoRepairManager, RepairPhase};

/// Store handle managed by Tauri. Wraps the default (char-n-gram) embedder;
/// the trait object abstraction is intentionally hidden here — if we ever
/// swap embedders we update this alias + call site.
pub type ManagedHistoryStore = std::sync::Arc<HistoryStore<HashingNgramEmbedder>>;

#[cfg(windows)]
fn apply_windows_app_identity() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    // Apply before Tauri creates the WebView/window. This keeps taskbar and
    // shell identity stable without mixing it into the HWND/DWM setup path.
    let app_user_model_id = HSTRING::from("com.aether.terminal");
    if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&app_user_model_id) } {
        log::debug!("windows app identity: AppUserModelID not applied: {e}");
    }
}

#[cfg(not(windows))]
fn apply_windows_app_identity() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_windows_app_identity();

    // Tier 🟡 #7: structured tracing pipeline. The same `LogRing`
    // returned here is registered as managed state so the
    // `logs_recent` / `logs_since` IPCs read from it directly.
    let log_ring = logging::init();
    let t0 = std::time::Instant::now();
    log::info!("Aether Terminal starting...");
    let (lsp_tx, lsp_rx) = std::sync::mpsc::channel::<lsp::LspMessage>();

    tauri::Builder::default()
        .manage(log_ring)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Auto-updater (Tier 🔴 #3). Endpoint + pubkey come from
        // tauri.conf.json's `plugins.updater` block. With the placeholder
        // pubkey shipped in repo this plugin loads but cannot verify a
        // signed manifest — that is intentional. See
        // docs/auto_updater_setup.md for the one-time key generation step
        // that swaps the placeholder for a real pubkey.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyManager::new().with_env_scrollback_store())
        .manage(pty_sidecar::PtySidecarState::new(None))
        .manage(AgentManager::new())
        .manage(InteractiveSessionManager::new())
        .manage(std::sync::Arc::new(std::sync::Mutex::new(mux::manager::MuxManager::new())))
        .manage(ipc::OutputBufferRegistry::new())
        .manage(ipc::TerminalGenerationRegistry::new())
        .manage(ipc::MuxKeymapRegistry::new())
        .manage(pty::PaneRegistry::new())
        .manage(ipc::FsWatcherRegistry::new())
        .manage(workflow::WorkflowExecutor::new())
        .manage(lsp::LspManager::new(lsp_tx))
        .manage(std::sync::Arc::new(term::NativeTerminalRegistry::new()))
        .manage(std::sync::Arc::new(term::CommandBlockJournal::new()))
        .manage(std::sync::Arc::new(term::NativeTerminalInputHost::new()))
        .manage(std::sync::Arc::new(snapshot::SnapshotStore::new()))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(AutoRepairManager::new())))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            watchdog::load_watchdog_rules().auto_repair,
        )))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(SuggestEngine::new())))
        .manage(std::sync::Arc::new(LayerRegistry::new()))
        .manage(std::sync::Arc::new(WatcherPool::new()))
        .manage(std::sync::Arc::new(task::TaskManager::new()))
        .manage(std::sync::Arc::new(context_store::ContextStoreManager::new()))
        .manage(std::sync::Arc::new(event_bus::EventBus::new()))
        .manage(std::sync::Arc::new(cost::CostManager::new()))
        .manage(failure_policy::FailurePolicy::new())
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            file_ownership::FileOwnership::new(),
        )))
        .manage(std::sync::Arc::new(intent::IntentBus::new()))
        .manage(std::sync::Arc::new(
            knowledge_graph::KnowledgeGraphManager::new(),
        ))
        .setup(move |app| {
            let lsp_app = app.handle().clone();
            std::thread::Builder::new()
                .name("lsp-response-bridge".into())
                .spawn(move || {
                    while let Ok(msg) = lsp_rx.recv() {
                        let _ = lsp_app.emit(
                            "lsp:response",
                            serde_json::json!({
                                "server": msg.server_key,
                                "message": msg.json,
                            }),
                        );
                    }
                })
                .ok();

            // Visible-pane agent runtime (managed state): the autonomy loop's
            // cockpit-face dispatch backend. Shares the managed PtyManager so a
            // loop-dispatched agent runs in a real terminal the operator can
            // watch (1 pane = 1 agent), with completion sensed from PTY exit.
            {
                let pty = app.state::<PtyManager>().inner().clone();
                app.manage(control::pane_fleet::PaneFleet::new(pty));
            }

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

            // Runtime Hardening P1: make the Context Store (shared ADR) durable.
            // It opens its OWN connection to the same file (SQLite WAL allows
            // concurrent connections) rather than threading an Arc through the
            // 36 `State<ManagedDb>` consumers. On failure we log loudly and fall
            // back to in-memory — never silently start with an empty store.
            match Database::open(&db_path) {
                Ok(cs_db) => {
                    let cs = app.state::<std::sync::Arc<context_store::ContextStoreManager>>();
                    match cs.attach_db(std::sync::Arc::new(db::ManagedDb::new(cs_db))) {
                        Ok(n) => log::info!("Context store restored {} decision(s)", n),
                        Err(e) => log::error!("Context store restore failed: {}", e),
                    }
                }
                Err(e) => log::error!("Context store persistence unavailable: {}", e),
            }

            // Runtime Hardening P1: make the Task Graph durable the same way.
            // The autonomy loop's live fleet state (statuses, crash/rework/
            // timeout counters, branch bindings) was in-memory only; this
            // restores it across restart. Own connection, loud-fail to in-memory.
            match Database::open(&db_path) {
                Ok(t_db) => {
                    let tm = app.state::<std::sync::Arc<task::TaskManager>>();
                    match tm.attach_db(std::sync::Arc::new(db::ManagedDb::new(t_db))) {
                        Ok(n) => log::info!("Task graph restored {} task(s)", n),
                        Err(e) => log::error!("Task graph restore failed: {}", e),
                    }
                }
                Err(e) => log::error!("Task graph persistence unavailable: {}", e),
            }

            let sidecar_state = app.state::<pty_sidecar::PtySidecarState>().inner().clone();
            let sidecar_fallback_pty: PtyManager = app.state::<PtyManager>().inner().clone();
            let sidecar_adopt_app = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let Some(client) = pty_sidecar::launch_or_connect() else {
                    // Surface the fallback: without this, a daemon that fails
                    // to start (port squatted by a foreign process, token
                    // mismatch after manual deletion, spawn failure) silently
                    // downgrades every session to non-restart-surviving.
                    ipc::record_audit_event(
                        &sidecar_adopt_app,
                        "terminal",
                        "sidecar_unavailable",
                        "warning",
                        Some("terminal"),
                        None,
                        "PTY sidecar daemon unavailable; sessions will not survive app restarts",
                        serde_json::json!({
                            "backend": "native-fallback",
                            "port": 9334,
                        }),
                    );
                    return;
                };
                if !sidecar_fallback_pty.list().is_empty() {
                    log::info!(
                        "PTY sidecar became ready after native PTY sessions existed; keeping native backend for this app session"
                    );
                    return;
                }
                match sidecar_state.set_client(client.clone()) {
                    Ok(()) => {
                        log::info!("PTY sidecar connected in background");
                        let app_handle = sidecar_adopt_app.clone();
                        tauri::async_runtime::spawn(async move {
                            match ipc::adopt_sidecar_terminals(&app_handle, client).await {
                                Ok(count) if count > 0 => {
                                    log::info!("PTY sidecar adopted {count} existing terminal(s)")
                                }
                                Ok(_) => {}
                                Err(err) => {
                                    log::warn!("PTY sidecar terminal adoption failed: {err}")
                                }
                            }
                        });
                    }
                    Err(err) => log::warn!("PTY sidecar state update failed: {err}"),
                }
            });

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
            // Window chrome on Windows is provided by tauri.conf.json
            // `windowEffects` by default. Direct HWND/DWM mutation is kept
            // behind an explicit dogfood flag because startup stability wins
            // over experimental translucency tweaks in release builds.
            #[cfg(windows)]
            {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::Graphics::Dwm::{
                    DWMSBT_MAINWINDOW, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
                    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
                };

                let direct_dwm_enabled =
                    std::env::var("AETHER_EXPERIMENTAL_DWM_CHROME").as_deref() == Ok("1");
                if !direct_dwm_enabled {
                    log::info!(
                        "window chrome: using Tauri windowEffects; direct DWM chrome disabled"
                    );
                } else if let Some(window) = app.get_webview_window("main") {
                    match window.hwnd() {
                        Ok(hwnd_raw) => {
                            let hwnd = HWND(hwnd_raw.0 as *mut _);

                            // 1. Acrylic via DWMWA_SYSTEMBACKDROP_TYPE.
                            //    DWMSBT_TRANSIENTWINDOW = real translucency.
                            let acrylic_value: i32 = DWMSBT_TRANSIENTWINDOW.0;
                            let acrylic_result = unsafe {
                                DwmSetWindowAttribute(
                                    hwnd,
                                    DWMWA_SYSTEMBACKDROP_TYPE,
                                    &acrylic_value as *const i32 as *const _,
                                    std::mem::size_of::<i32>() as u32,
                                )
                            };
                            match acrylic_result {
                                Ok(()) => log::info!(
                                    "window chrome: Acrylic applied via DWMSBT_TRANSIENTWINDOW (real desktop translucency)"
                                ),
                                Err(acrylic_err) => {
                                    log::warn!(
                                        "window chrome: Acrylic refused ({acrylic_err}); falling back to Mica wallpaper tint"
                                    );
                                    let mica_value: i32 = DWMSBT_MAINWINDOW.0;
                                    let mica_result = unsafe {
                                        DwmSetWindowAttribute(
                                            hwnd,
                                            DWMWA_SYSTEMBACKDROP_TYPE,
                                            &mica_value as *const i32 as *const _,
                                            std::mem::size_of::<i32>() as u32,
                                        )
                                    };
                                    if let Err(mica_err) = mica_result {
                                        log::warn!(
                                            "window chrome: Mica also refused ({mica_err}); window will render with CSS-only glass"
                                        );
                                    } else {
                                        log::info!(
                                            "window chrome: Mica applied as fallback (wallpaper tint, not real translucency)"
                                        );
                                    }
                                }
                            }

                            // 2. Rounded outer-window corners.
                            //    DWMWCP_ROUND is a no-op on Win10 (the
                            //    API returns E_INVALIDARG, tolerated
                            //    silently).
                            let corner_pref: i32 = DWMWCP_ROUND.0;
                            let corner_result = unsafe {
                                DwmSetWindowAttribute(
                                    hwnd,
                                    DWMWA_WINDOW_CORNER_PREFERENCE,
                                    &corner_pref as *const i32 as *const _,
                                    std::mem::size_of::<i32>() as u32,
                                )
                            };
                            match corner_result {
                                Ok(()) => log::info!(
                                    "DWM window corners: rounded preference applied"
                                ),
                                Err(e) => log::debug!(
                                    "DWM rounded-corner request not honoured (likely Win10): {e}"
                                ),
                            }
                        }
                        Err(e) => log::warn!("hwnd unavailable for DWM chrome setup: {e}"),
                    }
                }
            }

            // Wire window focus state to the DOM so CSS can soften the
            // glass alpha on the inactive state. Win11 suppresses the
            // Acrylic backdrop on blurred windows by OS design (Files /
            // Notepad / Settings all do this), so without this bridge
            // the React panels read as suddenly opaque the moment the
            // user Alt-Tabs. The frontend listens for the
            // `aether:window-focused` event and toggles
            // `<body data-window-focused>`; CSS in global.css keys off
            // that attribute to lower each glass token's alpha when
            // blurred.
            if let Some(window) = app.get_webview_window("main") {
                let win_for_handler = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        if let Err(e) =
                            win_for_handler.emit("aether:window-focused", *focused)
                        {
                            log::debug!("focus-state emit failed: {e}");
                        }
                    }
                });
            }

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
            //
            // Phase 3C-1a: the same tick drives ghostdiff — every repair job that
            // has a live worktree gets mirrored into `LayerRegistry` so its diff
            // is visible to the ghost-diff panel, and layer events are drained
            // and re-emitted to the frontend.
            let repair_handle = app.handle().clone();
            std::thread::Builder::new()
                .name("auto-repair-poller".into())
                .spawn(move || {
                    use std::collections::{HashMap, HashSet};
                    let mut prev_ids: HashSet<String> = HashSet::new();
                    let mut prev_terminal: HashMap<String, bool> = HashMap::new();
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let Some(mgr_state) = repair_handle
                            .try_state::<std::sync::Arc<std::sync::Mutex<AutoRepairManager>>>()
                        else {
                            continue;
                        };
                        let mgr_arc = mgr_state.inner().clone();
                        let (notifications, jobs) = match mgr_arc.lock() {
                            Ok(mut g) => (g.poll(), g.jobs()),
                            Err(_) => continue,
                        };
                        for notif in notifications {
                            let _ = repair_handle.emit("repair:notification", notif);
                        }
                        let _ = repair_handle.emit("repair:jobs-updated", &jobs);

                        // --- Ghost layer sync ---
                        let (Some(layer_reg), Some(pool_state)) = (
                            repair_handle.try_state::<std::sync::Arc<LayerRegistry>>(),
                            repair_handle.try_state::<std::sync::Arc<WatcherPool>>(),
                        ) else {
                            continue;
                        };
                        let registry = layer_reg.inner().clone();
                        let watcher_pool = pool_state.inner().clone();
                        let cur_ids: HashSet<String> =
                            jobs.iter().map(|j| j.id.clone()).collect();

                        for gone in prev_ids.difference(&cur_ids) {
                            ghostdiff::unregister_and_unwatch(
                                &registry,
                                &watcher_pool,
                                gone,
                            );
                        }

                        for job in &jobs {
                            let is_terminal = matches!(
                                job.phase,
                                RepairPhase::Succeeded | RepairPhase::Failed(_)
                            );

                            // Register once the worktree exists on disk (fs
                            // watcher needs a real path). Empty `repo_path`
                            // would make `predict_worktree_path` resolve
                            // against the process CWD — skip those jobs.
                            if !registry.contains(&job.id)
                                && !job.repo_path.is_empty()
                                && !matches!(job.phase, RepairPhase::CreatingWorktree)
                            {
                                let worktree_path = crate::git::predict_worktree_path(
                                    &job.repo_path,
                                    &job.branch,
                                );
                                if worktree_path.exists() {
                                    if let Err(e) = ghostdiff::register_worktree_and_watch(
                                        &registry,
                                        &watcher_pool,
                                        job.id.clone(),
                                        worktree_path,
                                        job.branch.clone(),
                                        std::path::PathBuf::from(&job.repo_path),
                                        LayerTint::auto_repair(),
                                    ) {
                                        log::warn!(
                                            "ghostdiff: auto-repair register failed for {}: {e}",
                                            job.id
                                        );
                                    }
                                }
                            }

                            let was_terminal =
                                *prev_terminal.get(&job.id).unwrap_or(&false);
                            if is_terminal
                                && !was_terminal
                                && registry.contains(&job.id)
                            {
                                let _ = registry.mark_complete(&job.id);
                                watcher_pool.unwatch(&job.id);
                            }
                        }

                        prev_ids = cur_ids;
                        prev_terminal = jobs
                            .iter()
                            .map(|j| {
                                (
                                    j.id.clone(),
                                    matches!(
                                        j.phase,
                                        RepairPhase::Succeeded | RepairPhase::Failed(_)
                                    ),
                                )
                            })
                            .collect();

                        // Drain and re-emit ghost layer events (covers both
                        // auto-repair and orchestra-owned layers).
                        for ev in registry.poll() {
                            match ev {
                                LayerEvent::Updated { seq, summary } => {
                                    let _ = repair_handle.emit(
                                        "ghost-diff:layer-updated",
                                        crate::ghostdiff::LayerUpdatedPayload {
                                            seq,
                                            summary,
                                        },
                                    );
                                }
                                LayerEvent::Completed { seq, layer_id } => {
                                    let _ = repair_handle.emit(
                                        "ghost-diff:layer-completed",
                                        crate::ghostdiff::LayerIdPayload {
                                            seq,
                                            layer_id,
                                        },
                                    );
                                }
                                LayerEvent::Removed { seq, layer_id } => {
                                    let _ = repair_handle.emit(
                                        "ghost-diff:layer-removed",
                                        crate::ghostdiff::LayerIdPayload {
                                            seq,
                                            layer_id,
                                        },
                                    );
                                }
                            }
                        }
                    }
                })
                .ok();

            // Phase 3D-1: spin up the fallback in-process HTTP/WS PTY API on
            // 127.0.0.1:9333. Failures (e.g. port already taken by another
            // app instance or the long-lived sidecar) log a warning and leave
            // the rest of the app running normally.
            let sidecar_enabled = app
                .try_state::<pty_sidecar::PtySidecarState>()
                .and_then(|state| state.client())
                .is_some();
            if sidecar_enabled {
                log::info!("PTY sidecar is active; skipping in-process PTY API bind");
            } else {
                let pty: PtyManager = app.state::<PtyManager>().inner().clone();
                let mux_manager = app
                    .state::<std::sync::Arc<std::sync::Mutex<mux::manager::MuxManager>>>()
                    .inner()
                    .clone();
                let agent_manager = app.state::<AgentManager>().inner().clone();
                let ghost_layers = app.state::<std::sync::Arc<LayerRegistry>>().inner().clone();
                let cost_manager = app
                    .state::<std::sync::Arc<cost::CostManager>>()
                    .inner()
                    .clone();
                let task_manager = app
                    .state::<std::sync::Arc<task::TaskManager>>()
                    .inner()
                    .clone();
                let event_bus = app
                    .state::<std::sync::Arc<event_bus::EventBus>>()
                    .inner()
                    .clone();
                let file_ownership = app
                    .state::<std::sync::Arc<std::sync::Mutex<file_ownership::FileOwnership>>>()
                    .inner()
                    .clone();
                let context_store = app
                    .state::<std::sync::Arc<context_store::ContextStoreManager>>()
                    .inner()
                    .clone();
                let intent_bus = app
                    .state::<std::sync::Arc<intent::IntentBus>>()
                    .inner()
                    .clone();
                let knowledge_graph = app
                    .state::<std::sync::Arc<knowledge_graph::KnowledgeGraphManager>>()
                    .inner()
                    .clone();
                let api_state = api::ApiState::new(pty, api::AuthConfig::from_env())
                    .with_mux(mux_manager)
                    .with_agent_manager(agent_manager)
                    .with_ghost_layers(ghost_layers)
                    .with_cost_manager(cost_manager)
                    .with_task_manager(task_manager)
                    .with_event_bus(event_bus)
                    .with_file_ownership(file_ownership)
                    .with_context_store(context_store)
                    .with_intent_bus(intent_bus)
                    .with_knowledge_graph(knowledge_graph)
                    .with_env_mux_store();
                app.manage(api_state.clone());
                let serve_state = api_state.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = api::serve(serve_state, api::DEFAULT_PORT).await {
                        log::warn!(
                            "3D-1: PTY API server failed on port {}: {}",
                            api::DEFAULT_PORT,
                            e
                        );
                    }
                });
            }

            log::info!("Setup complete in {:?}", t0.elapsed());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::spawn_terminal,
            ipc::respawn_terminal,
            ipc::force_restart_terminal,
            ipc::write_terminal,
            ipc::native_terminal_input_commit,
            ipc::native_terminal_input_focus,
            ipc::native_terminal_input_drain,
            ipc::native_terminal_input_paste,
            ipc::native_terminal_input_preedit,
            ipc::native_terminal_input_status,
            ipc::resize_terminal,
            ipc::close_terminal,
            ipc::mux_process_keymap_event,
            ipc::mux_split_pane,
            ipc::mux_close_pane,
            ipc::mux_get_workspace,
            ipc::mux_swap_panes,
            ipc::mux_break_pane,
            ipc::mux_join_pane,
            ipc::mux_set_panes_synchronized,
            ipc::mux_apply_layout,
            ipc::mux_set_pane_zoom,
            ipc::list_terminals,
            ipc::detect_shells,
            ipc::term_snapshot,
            ipc::term_prompt_marks,
            ipc::term_command_blocks,
            ipc::term_persisted_command_blocks,
            ipc::term_history_size,
            ipc::term_history_rows,
            ipc::term_search_history,
            ipc::terminal_output_journal,
            ipc::term_image_data,
            ipc::term_image_metrics,
            ipc::performance_observatory_metrics,
            ipc::task_create,
            ipc::task_transition,
            ipc::task_list,
            ipc::task_recompute_ready,
            ipc::orchestrator_plan,
            ipc::orchestrator_step,
            ipc::context_set,
            ipc::context_get,
            ipc::context_all,
            ipc::context_remove,
            ipc::event_publish,
            ipc::event_recent,
            ipc::event_by_channel,
            ipc::cost_caps,
            ipc::cost_set_caps,
            ipc::cost_can_spawn,
            ipc::failure_decide,
            ipc::ownership_assign,
            ipc::ownership_owner_of,
            ipc::ownership_claims,
            ipc::ownership_conflicts,
            ipc::discover_projects,
            ipc::default_project_scan_dirs,
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
            ipc::open_in_vscode,
            ipc::open_in_vscode_diff,
            ipc::open_git_file_diff_in_vscode,
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
            ipc::list_agent_fleet,
            ipc::route_agent,
            ipc::inspect_merge_worktree_branch,
            ipc::start_chat_agent,
            ipc::stop_chat_agent,
            ipc::save_temp_image,
            ipc::save_clipboard_image,
            ipc::read_clipboard_text,
            ipc::write_clipboard_text,
            // Session management
            ipc::create_session,
            ipc::list_db_sessions,
            ipc::delete_session,
            ipc::restore_last_session,
            ipc::create_window,
            ipc::create_pane,
            ipc::save_session_state,
            ipc::save_pane_tree_layout,
            ipc::get_pane_tree_layout,
            ipc::delete_pane_tree_layout,
            // Command history
            ipc::save_command_history,
            ipc::search_command_history,
            ipc::recent_commands,
            ipc::recent_audit_events,
            ipc::append_audit_event,
            ipc::append_audit_events,
            ipc::list_audit_events,
            ipc::get_audit_trace,
            ipc::get_latest_snapshot,
            ipc::rebuild_snapshot_from_events,
            ipc::compact_event_journal,
            // Workspace pane commands
            ipc::send_keys,
            ipc::broadcast_keys,
            ipc::capture_pane,
            ipc::command_blocks,
            ipc::rename_pane,
            ipc::set_pane_role,
            ipc::send_keys_by_name,
            ipc::send_keys_by_role,
            ipc::send_keys_by_target,
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
            ipc::workflow_approve_gate_decision,
            ipc::workflow_reject_gate,
            ipc::workflow_reject_gate_decision,
            ipc::workflow_resume_from_phase,
            ipc::workflow_split_current_phase,
            ipc::workflow_request_decision,
            ipc::workflow_record_phase_evidence,
            ipc::workflow_status,
            ipc::list_running_workflows,
            ipc::workflow_remove,
            // Agent session persistence
            ipc::save_agent_to_db,
            ipc::update_agent_in_db,
            ipc::list_agent_history,
            ipc::save_agent_telemetry_snapshot,
            ipc::list_agent_telemetry_snapshots,
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
            // Ghost diff overlay (Phase 3C-1a)
            ipc::list_ghost_layers,
            ipc::get_ghost_layer_file,
            ipc::dismiss_ghost_layer,
            ipc::dismiss_ghost_file,
            ipc::apply_ghost_hunk,
            ipc::apply_ghost_file,
            ipc::start_branch_comparison,
            // Time-travel snapshots (Phase 3C-3a)
            ipc::list_snapshots,
            ipc::get_snapshot,
            ipc::mark_snapshot,
            // Snapshot overlay (Phase 3C-3b)
            ipc::start_snapshot_overlay,
            // IME positioning
            ipc::set_ime_position,
            // Shell integration installer (post-0.2.2 Tier 🔴 #2)
            ipc::shell_integration_status,
            ipc::shell_integration_one_liner,
            ipc::shell_integration_install,
            // Structured log viewer (post-0.2.2 Tier 🟡 #7)
            ipc::logs_recent,
            ipc::logs_since,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aether Terminal")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Phase 3D-1: tell the API server to drain WS clients before
                // the process tears down. Fire-and-forget — the Notify wakes
                // the axum graceful-shutdown future, which closes the listener
                // and aborts live WS tasks.
                if let Some(state) = app.try_state::<api::ApiState>() {
                    state.trigger_shutdown();
                }
                // Kill in-process PTYs on exit. These are the fallback owner's
                // user shells AND the autonomy loop's fleet panes (always spawned
                // in-process) — both are ephemeral and would otherwise orphan
                // live agent processes after the window closes. `close_all` only
                // touches PtyManager's in-process instances; the sidecar's own
                // tmux-like sessions live in a separate process and persist by
                // design (unless the user opted into full shutdown below).
                if let Some(pty) = app.try_state::<PtyManager>() {
                    pty.close_all();
                }
                let sidecar_client = app
                    .try_state::<pty_sidecar::PtySidecarState>()
                    .and_then(|state| state.client());
                if let Some(client) = sidecar_client {
                    if config::load_config().terminal.shutdown_sidecar_on_exit {
                        tauri::async_runtime::block_on(client.shutdown_daemon());
                    }
                }
            }
        });
}
