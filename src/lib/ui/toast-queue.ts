/**
 * Toast queue rules — the pure half.
 *
 * There are 333 `toast.*` call sites in this app and the store had no cap and
 * no deduplication: every push appended unconditionally. Two consequences,
 * both reachable in normal use:
 *
 *   - A batch operation that reports per-item failures stacks one card per
 *     item. Twenty failures cover the screen, and the cards nearest the top
 *     scroll out of view before they can be read.
 *   - A retry loop firing the same message repeatedly renders it repeatedly.
 *     Five identical "Could not save" cards convey nothing that one card and a
 *     count would not.
 *
 * Extracted as pure functions because this is queue *policy*, and policy in a
 * Zustand setter cannot be unit-tested — the project rule that untested logic
 * gets silently reverted applies exactly here.
 */

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface QueuedToast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  duration: number;
  /** How many identical pushes this card represents. Rendered as "x3". */
  count: number;
}

/**
 * Most cards on screen at once.
 *
 * Four is about what fits above the player bar without the oldest scrolling
 * out of reach. Beyond that the stack stops informing and starts obscuring.
 */
export const MAX_VISIBLE_TOASTS = 4;

/** Default lifetimes. Errors linger because they usually need reading twice. */
export function defaultDuration(kind: ToastKind): number {
  return kind === 'error' ? 6000 : 3500;
}

/**
 * Two toasts are "the same" when a user could not tell them apart.
 *
 * Deliberately ignores id and duration: the point is whether showing both adds
 * information, and two cards with identical kind, title and description do not.
 */
export function isSameToast(
  a: Pick<QueuedToast, 'kind' | 'title' | 'description'>,
  b: Pick<QueuedToast, 'kind' | 'title' | 'description'>,
): boolean {
  return a.kind === b.kind
    && a.title === b.title
    && (a.description ?? '') === (b.description ?? '');
}

/**
 * Add a toast to the queue.
 *
 * Returns the id of the card the caller should consider "theirs" — which is the
 * EXISTING card's id when this was a duplicate, so a caller holding an id to
 * dismiss later still dismisses the right thing.
 */
export function enqueueToast(
  queue: QueuedToast[],
  incoming: Omit<QueuedToast, 'count'>,
  maxVisible = MAX_VISIBLE_TOASTS,
): { queue: QueuedToast[]; id: string; deduped: boolean } {
  const existingIndex = queue.findIndex((t) => isSameToast(t, incoming));

  if (existingIndex !== -1) {
    const existing = queue[existingIndex];
    const next = [...queue];
    // Move the repeat to the end so it reads as the most recent event, and
    // bump its count rather than adding a card that says the same thing.
    next.splice(existingIndex, 1);
    next.push({ ...existing, count: existing.count + 1 });
    return { queue: next, id: existing.id, deduped: true };
  }

  const appended = [...queue, { ...incoming, count: 1 }];
  // Drop from the FRONT when over capacity: the oldest card has been readable
  // longest, and the newest is the one describing what just happened.
  const trimmed = appended.length > maxVisible
    ? appended.slice(appended.length - maxVisible)
    : appended;

  return { queue: trimmed, id: incoming.id, deduped: false };
}

/** Remove one toast by id. */
export function dismissToast(queue: QueuedToast[], id: string): QueuedToast[] {
  return queue.filter((t) => t.id !== id);
}
