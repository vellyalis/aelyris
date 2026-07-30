import { type ReactNode, Suspense } from "react";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { HandoffDialog } from "../../shared/ui/HandoffDialog";
import { LazyDialog } from "../../shared/ui/LazyDialog";
import { OrchestraDialog } from "../../shared/ui/OrchestraDialog";
import { PromptDialog } from "../../shared/ui/PromptDialog";
import { HistorySearchDialog } from "../history/HistorySearchDialog";
import type { AppDialogHostActions, AppDialogHostViewModel } from "./appDialogHostContract";
import { FleetHud, OnboardingOverlay } from "./lazyPanels";

export type AppLazyDialogId =
  | "command-palette"
  | "settings"
  | "watchdog"
  | "about"
  | "help"
  | "web-inspector"
  | "pr-inspector"
  | "merge-queue"
  | "quick-open"
  | "pane-switcher";

export interface AppLazyDialogEntry {
  readonly id: AppLazyDialogId;
  readonly visible: boolean;
  readonly content: ReactNode;
}

export interface AppDialogHostProps {
  readonly viewModel: AppDialogHostViewModel;
  readonly actions: AppDialogHostActions;
  readonly lazyDialogs: readonly AppLazyDialogEntry[];
}

export function AppDialogHost({ viewModel, actions, lazyDialogs }: AppDialogHostProps) {
  return (
    <>
      {lazyDialogs.map((dialog) => (dialog.visible ? <LazyDialog key={dialog.id}>{dialog.content}</LazyDialog> : null))}
      <PromptDialog />
      <ConfirmDialog />
      <HandoffDialog />
      <OrchestraDialog />
      <HistorySearchDialog onAccept={actions.onHistoryAccept} defaultCwdPrefix={viewModel.historyCwdPrefix} />
      <Suspense fallback={null}>
        <OnboardingOverlay />
        <FleetHud />
      </Suspense>
    </>
  );
}
