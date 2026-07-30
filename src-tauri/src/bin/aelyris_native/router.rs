use super::*;

pub(super) async fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let Some(command) = args.first().map(String::as_str) else {
        print_help();
        return Ok(());
    };

    // A6.6_COMMAND_ROUTER_START
    match command {
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        "contract" => contract().await,
        "window-proof" => window_proof(&args[1..]).await,
        "render-proof" => render_proof(&args[1..]).await,
        "grid-render-proof" => grid_render_proof(&args[1..]).await,
        "present-loop-proof" => present_loop_proof(&args[1..]).await,
        "gpu-render-proof" => gpu_render_proof(&args[1..]).await,
        "winit-wgpu-proof" => winit_wgpu_proof(&args[1..]).await,
        "text-shaping-fixture-proof" => text_shaping_fixture_proof(&args[1..]).await,
        "ime-proof" => ime_proof(&args[1..]).await,
        "ime-dogfood-proof" => ime_dogfood_proof(&args[1..]).await,
        "ime-os-dogfood-proof" => ime_os_dogfood_proof(&args[1..]).await,
        "ime-os-dogfood-worker" => ime_os_dogfood_worker(&args[1..]).await,
        "paste-guard-proof" => paste_guard_proof(&args[1..]).await,
        "settings-proof" => settings_proof(&args[1..]).await,
        "settings-window-proof" => settings_window_proof(&args[1..]).await,
        "command-center-proof" => command_center_proof(&args[1..]).await,
        "command-center-window-proof" => command_center_window_proof(&args[1..]).await,
        "command-center-input-scroll-proof" => command_center_input_scroll_proof(&args[1..]).await,
        "mode-shell-proof" => mode_shell_proof(&args[1..]).await,
        "mode-rail-window-proof" => mode_rail_window_proof(&args[1..]).await,
        "inspector-window-proof" => inspector_window_proof(&args[1..]).await,
        "right-rail-demotion-proof" => right_rail_demotion_proof(&args[1..]).await,
        "accessibility-proof" => accessibility_proof(&args[1..]).await,
        "uia-provider-proof" => uia_provider_proof(&args[1..]).await,
        "visual-qa-proof" => visual_qa_proof(&args[1..]).await,
        "primary-shell-proof" => primary_shell_proof(&args[1..]).await,
        "power-events-proof" => power_events_proof(&args[1..]).await,
        "db-smoke-proof" => db_smoke_proof().await,
        "upper-compat-proof" => upper_compat_proof().await,
        "sleep-now" => sleep_now(&args[1..]).await,
        "list" | "mux" => {
            let value = request(Method::GET, "/mux/workspaces", None).await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "list",
                "daemon": daemon_summary().await?,
                "workspaces": value,
            }))
        }
        "graph" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "graph requires a workspace/session id".to_string())?;
            let value = request(
                Method::GET,
                &format!("/mux/workspaces/{workspace_id}"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "graph",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "attach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "attach requires a workspace/session id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/attach"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "attach",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "detach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "detach requires a workspace/session id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/detach"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "detach",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "send" => send_input(&args[1..]).await,
        "capture" => capture_output(&args[1..]).await,
        other => Err(format!("unknown command: {other}")),
    }
    // A6.6_COMMAND_ROUTER_END
}

fn print_help() {
    println!(
        "aelyris-native commands:\n  contract\n  window-proof [--duration-ms n] [--alpha 1..255] [--show]\n  render-proof [--session id] [--text text] [--expect text] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  grid-render-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  present-loop-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  gpu-render-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n]\n  winit-wgpu-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--show]\n  text-shaping-fixture-proof [--text text] [--cols n] [--rows n] [--png path] [--out path]\n  ime-proof [--prompt text] [--preedit text] [--commit text] [--cols n] [--rows n]\n  ime-dogfood-proof [--commit text]\n  ime-os-dogfood-proof [--preedit text] [--commit text]\n  settings-proof [--theme text] [--mood text] [--wallpaper path] [--opacity n] [--wallpaper-opacity n]\n  settings-window-proof [--theme text] [--mood text] [--wallpaper path] [--opacity n] [--wallpaper-opacity n] [--duration-ms n] [--alpha 1..255] [--show]\n  command-center-proof\n  command-center-window-proof [--duration-ms n] [--alpha 1..255] [--show]\n  command-center-input-scroll-proof\n  mode-shell-proof [--mode id]\n  mode-rail-window-proof [--mode id] [--duration-ms n] [--alpha 1..255] [--show]\n  inspector-window-proof [--mode id] [--alpha 1..255] [--duration-ms n] [--show]\n  right-rail-demotion-proof\n  accessibility-proof\n  uia-provider-proof\n  visual-qa-proof\n  primary-shell-proof [--duration-ms n] [--alpha 1..255] [--show]\n  power-events-proof --start-epoch n --end-epoch n\n  db-smoke-proof\n  sleep-now [--i-understand-this-sleeps-windows]\n  list\n  graph <workspace>\n  attach <workspace>\n  detach <workspace>\n  send <session> <text...> [--enter]\n  capture <session> [--lines n] [--raw]\n\nEnvironment:\n  AELYRIS_API_URL    daemon URL; defaults to sidecar token location or http://127.0.0.1:9333\n  AELYRIS_API_TOKEN  bearer token; otherwise reads the Aelyris sidecar token file"
    );
}
