/**
 * Moving one track on a tracklist (LABEL-33). The release page reorders with
 * explicit up / down controls and a position field — never by dragging, and
 * the server takes the WHOLE order in one call (`PATCH …/items { order }`),
 * so the helpers return the whole new order, or null when there is nothing
 * to send.
 */
export function moveBy(order: readonly string[], id: string, delta: number): string[] | null {
  const from = order.indexOf(id);
  if (from < 0) return null;
  return moveTo(order, id, from + delta + 1);
}

/** `position` is 1-based, as the page shows it; out-of-range is clamped, no move is null. */
export function moveTo(order: readonly string[], id: string, position: number): string[] | null {
  const from = order.indexOf(id);
  if (from < 0 || !Number.isFinite(position)) return null;
  const to = Math.min(order.length, Math.max(1, Math.trunc(position))) - 1;
  if (to === from) return null;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
