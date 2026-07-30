import type { ProductModeId } from "../right-rail/rightRailModel";

export interface ProductModeRailViewModel {
  readonly activeMode: ProductModeId;
  readonly hidden: boolean;
}

export interface ProductModeRailActions {
  readonly onSelectMode: (mode: ProductModeId) => void;
}
