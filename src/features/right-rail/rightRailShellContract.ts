import type { RightRailMode } from "../../shared/lib/rightRailAdvisor";

export interface RightRailShellViewModel {
  readonly hidden: boolean;
  readonly width: number;
  readonly activeMode: RightRailMode;
  readonly modeBadges: Readonly<Record<RightRailMode, number>>;
}

export interface RightRailShellActions {
  readonly onWidthChange: (width: number) => void;
  readonly onModeChange: (mode: RightRailMode) => void;
}
