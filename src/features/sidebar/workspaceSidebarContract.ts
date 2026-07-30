export interface WorkspaceSidebarViewModel {
  readonly hidden: boolean;
  readonly width: number;
}

export interface WorkspaceSidebarActions {
  readonly onWidthChange: (width: number) => void;
}
