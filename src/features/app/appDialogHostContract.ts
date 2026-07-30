import type { SearchHit } from "../../shared/types/history";

export interface AppDialogHostViewModel {
  readonly historyCwdPrefix?: string;
}

export interface AppDialogHostActions {
  readonly onHistoryAccept: (hit: SearchHit) => void;
}
