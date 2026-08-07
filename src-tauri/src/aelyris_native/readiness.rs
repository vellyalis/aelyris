use super::*;

pub(super) async fn contract() -> Result<(), String> {
    let daemon = request(Method::GET, "/daemon/contract", None).await?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "status": "client-boundary-spike",
        "daemon": daemon,
        "fullNativeReadiness": full_native_readiness_contract(),
        "claims": {
            "webviewUsed": false,
            "reactUsed": false,
            "muxTruthSource": "daemon-api",
            "terminalRenderer": "pending-native-terminal-renderer-after-window-proof",
            "inputOwner": "pending-native-window-ime",
            "purpose": "prove a native Rust client can attach to the same mux graph and create a no-WebView native window before a full UI rewrite"
        },
        "capabilities": [
            "daemon-contract",
            "mux-list",
            "mux-graph",
            "mux-attach",
            "mux-detach",
            "session-send",
            "session-capture",
            "native-window-proof",
            "native-text-render-proof",
            "native-grid-render-proof",
            "native-present-loop-proof",
            "native-gpu-render-proof",
            "native-winit-wgpu-surface-proof",
            "native-winit-wgpu-font-atlas-proof",
            "native-ime-state-proof",
            "native-ime-hwnd-dogfood-proof",
            "native-ime-os-dogfood-proof",
            "native-settings-proof",
            "native-settings-window-ui",
            "native-command-center-proof",
            "native-command-center-window-ui-proof",
            "native-command-center-input-scroll-proof",
            "native-mode-shell-proof",
            "native-mode-rail-window-ui-proof",
            "native-inspector-window-ui-proof",
            "native-right-rail-demotion-proof",
            "native-accessibility-tree-proof",
            "native-uia-provider-dogfood-proof",
            "native-visual-qa-harness-proof",
            "native-primary-shell-promotion-proof",
            "native-process-identity"
        ],
        "blockedUntil": [
            "native-ime-manual-japanese-candidate-sweep",
            "native-glass-theme-renderer",
            "native-visual-regression-harness"
        ]
    }))
}

pub(super) fn full_native_readiness_contract() -> Value {
    let text_shaping_policy = terminal_text_shaping_policy();
    let system_text_shaping = system_text_shaping_capability();
    json!({
        "schema": "aelyris.full-native-readiness.v1",
        "currentStage": "native-client-spike",
        "finalGoal": "operator-primary no-WebView Rust client",
        "textShapingPolicy": to_value(&text_shaping_policy).unwrap_or_else(|_| json!({
            "readyForNativeShapingClaim": false,
            "releaseBlockers": ["native text-shaping policy serialization failed"]
        })),
        "systemTextShapingCapability": to_value(&system_text_shaping).unwrap_or_else(|_| json!({
            "available": false,
            "readyForNativeShapingClaim": false,
            "blockers": ["native system text-shaping capability serialization failed"]
        })),
        "definitionOfDone": [
            "The primary terminal window runs in the aelyris-native process without React or WebView.",
            "The terminal present loop is native Rust and GPU-backed.",
            "Input, IME, clipboard, paste guard, mouse, selection, and accessibility are native-owned.",
            "Settings, theme/material customization, wallpaper, opacity, and launch profiles are editable in a native UI.",
            "Command Center/right rail evidence, recovery, provenance, and AI CLI orchestration are rendered and actionable in the native client.",
            "The React/Tauri shell is optional compatibility, not the product truth."
        ],
        "completed": {
            "daemonApiBoundary": true,
            "rustMuxSessionGraph": true,
            "rustTerminalModel": true,
            "nativeProcessIdentity": true,
            "nativeLayeredWindowProof": true,
            "nativeGdiTextProof": true,
            "nativeGdiGridProof": true,
            "rendererNeutralFrameContract": true,
            "nativePresentLoopProof": true,
            "wgpuOffscreenRenderProof": true,
            "winitWgpuSurfaceProof": true,
            "winitWgpuFontAtlasProof": true,
            "nativeImeStateProof": true,
            "nativeImeHwndDogfoodProof": true,
            "nativeImeOsDogfoodProof": true,
            "nativeSettingsConfigProof": true,
            "nativeSettingsWindowProof": true,
            "nativeCommandCenterDataProof": true,
            "nativeCommandCenterInputScrollProof": true,
            "nativeModeShellContractProof": true,
            "nativeModeRailWindowProof": true,
            "nativeInspectorWindowProof": true,
            "nativeRightRailDemotionProof": true,
            "nativeRightRailCompatibilityDemotionProof": true,
            "nativeAccessibilityTreeProof": true,
            "nativeUiaProviderDogfoodProof": true,
            "nativeVisualQaHarnessProof": true,
            "nativePrimaryShellPromotionProof": true,
            "nativeTextShapingPolicyContract": true,
            "nativeSystemTextShapingBoundary": system_text_shaping.available
        },
        "missing": {
            "nativeSystemTextShapingAndFallback": !(system_text_shaping.available && system_text_shaping.system_font_fallback),
            "nativeRendererConsumesSystemShapedRuns": !system_text_shaping.renderer_integration_ready,
            "nativeTextShapingVisualFixtures": !system_text_shaping.visual_fixture_ready,
            "nativePresentLoopDogfood": true,
            "nativeImeLiveDogfood": null,
            "nativeClipboardAndSelectionDogfood": true,
            "nativeThemeGlassWallpaperEditorUi": null,
            "nativeCommandCenterRightRailUi": null,
            "nativePrimaryOperatorPromotion": null,
            "nativeSettingsAndDialogsUi": null,
            "nativeAccessibilityAndKeyboardNavigation": null,
            "nativeUiaProviderDogfood": null,
            "nativeVisualRegressionHarness": null,
            "nativeSleepResumeVisualDogfood": true,
            "reactWebViewAsOptionalCompatibilityOnly": true
        },
        "nextMilestone": "dogfood Japanese candidate selection and primary operator-primary terminal input in aelyris-native while keeping the winit/wgpu font-atlas renderer on the same NativeRenderFrame contract",
        "doNotClaimFullNativeUntil": [
            "native present-loop is dogfooded by a visible interactive terminal window",
            "winit-wgpu font-atlas renderer is dogfooded as the primary visible terminal renderer",
            "Windows system-backed text shaping and real font fallback are wired into the native renderer without '?' substitution",
            "Japanese IME candidate selection is dogfooded with a real user-driven IME session inside aelyris-native",
            "Command Center/right rail runs as part of the primary operator-primary native shell",
            "native accessibility tree is exposed through UIA/accesskit to assistive technologies",
            "native visual QA proves nonblank rendering, contrast, focus, and input after resize/sleep/resume"
        ]
    })
}
