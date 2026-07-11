export const WORKSPACE_REGION_ORDER = ["sidebar", "center", "right-rail", "status-bar"] as const;

export function cycleWorkspaceRegion(reverse = false, root: ParentNode = document): HTMLElement | null {
  const regions = WORKSPACE_REGION_ORDER.flatMap((region) => {
    const element = root.querySelector<HTMLElement>(`[data-workspace-region="${region}"]`);
    return element &&
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0
      ? [element]
      : [];
  });
  if (regions.length === 0) return null;
  const currentIndex = regions.findIndex(
    (region) => region === document.activeElement || region.contains(document.activeElement),
  );
  const delta = reverse ? -1 : 1;
  const nextIndex =
    currentIndex < 0 ? (reverse ? regions.length - 1 : 0) : (currentIndex + delta + regions.length) % regions.length;
  regions[nextIndex].focus();
  return regions[nextIndex];
}
