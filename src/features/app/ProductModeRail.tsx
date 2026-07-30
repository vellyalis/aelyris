import { useEffect } from "react";

import { PRODUCT_NAME } from "../../shared/constants/product";
import { PRODUCT_MODE_RAIL } from "../right-rail/rightRailModel";
import type { ProductModeRailActions, ProductModeRailViewModel } from "./productModeRailContract";

export interface ProductModeRailProps {
  readonly viewModel: ProductModeRailViewModel;
  readonly actions: ProductModeRailActions;
}

export function ProductModeRail({ viewModel, actions }: ProductModeRailProps) {
  const { activeMode, hidden } = viewModel;
  const { onSelectMode } = actions;

  useEffect(() => {
    const handleModeShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const mode = Number.isInteger(index) ? PRODUCT_MODE_RAIL[index] : undefined;
      if (!mode) return;
      event.preventDefault();
      onSelectMode(mode.id);
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-product-mode="${mode.id}"]`)?.focus();
      });
    };

    window.addEventListener("keydown", handleModeShortcut);
    return () => window.removeEventListener("keydown", handleModeShortcut);
  }, [onSelectMode]);

  if (hidden) return null;

  return (
    <nav className="mode-rail" aria-label={`${PRODUCT_NAME} mode rail`} data-active-mode={activeMode}>
      <div className="mode-rail-brand" aria-hidden="true">
        {PRODUCT_NAME[0]}
      </div>
      <div className="mode-rail-list">
        {PRODUCT_MODE_RAIL.map((mode) => {
          const Icon = mode.icon;
          const active = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              className="mode-rail-button"
              data-active={active ? "true" : "false"}
              data-product-mode={mode.id}
              aria-pressed={active}
              aria-label={`${mode.label}. ${mode.description} ${mode.shortcut}`}
              title={`${mode.shortcut} - ${mode.description}`}
              onClick={() => onSelectMode(mode.id)}
            >
              <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
              <span className="mode-rail-label">{mode.label}</span>
              <span className="mode-rail-shortcut">{mode.shortcut.replace("Alt+", "")}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
