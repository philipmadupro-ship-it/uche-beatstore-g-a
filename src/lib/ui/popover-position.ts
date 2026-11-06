/**
 * Where a portaled popover panel starts vertically (viewport coordinates).
 *
 * Under the trigger when it fits; otherwise above it when that fits; otherwise
 * slid up to the bottom margin so the whole panel is reachable. `Popover` used
 * to clamp only the panel's top edge to the viewport, so a tall panel opened
 * near the bottom (the member Abilities list) ran off the screen with nothing
 * to scroll — its lower switches could not be reached by pointer at all.
 */
export const POPOVER_GAP = 6;
export const POPOVER_MARGIN = 8;

export function fitPanelTop({
  triggerTop,
  triggerBottom,
  panelHeight,
  viewportHeight,
}: {
  triggerTop: number;
  triggerBottom: number;
  panelHeight: number;
  viewportHeight: number;
}): number {
  const below = triggerBottom + POPOVER_GAP;
  if (below + panelHeight <= viewportHeight - POPOVER_MARGIN) return Math.max(POPOVER_MARGIN, below);
  const above = triggerTop - POPOVER_GAP - panelHeight;
  if (above >= POPOVER_MARGIN && above + panelHeight <= viewportHeight - POPOVER_MARGIN) return above;
  return Math.max(POPOVER_MARGIN, Math.min(below, viewportHeight - POPOVER_MARGIN - panelHeight));
}
