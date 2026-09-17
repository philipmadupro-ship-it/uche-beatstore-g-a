/**
 * What "mark read" actually changes.
 *
 * The bell used to PATCH `action=read_all` whenever its panel opened, so
 * glancing at it cleared every notification whether or not the producer had
 * looked at one — open it to check a sale and the other nineteen rows were
 * gone from the badge. Reading is now something done to a notification.
 *
 * The arithmetic is here rather than in `nav/TopBar` because it is the part
 * that goes quietly wrong: decrementing the badge by the number of ids the
 * caller passed rather than the number that were actually unread drives the
 * count negative the second time the same row is clicked, and re-PATCHing rows
 * that are already read writes for nothing.
 */

export interface ReadableNotification {
  id: string;
  read: boolean | null;
}

export interface ReadPlan<T extends ReadableNotification> {
  /** Ids that were genuinely unread — the only ones worth sending. */
  ids: string[];
  /** The list with those rows flipped. Unchanged when nothing was pending. */
  next: T[];
  /** New unread total, never below zero. */
  unread: number;
  /** False when there is nothing to do and no request should be made. */
  changed: boolean;
}

/** Mark specific notifications read. */
export function planMarkRead<T extends ReadableNotification>(
  notifications: T[],
  unread: number,
  ids: string[],
): ReadPlan<T> {
  const wanted = new Set(ids);
  const pending = notifications.filter((n) => wanted.has(n.id) && !n.read).map((n) => n.id);
  if (pending.length === 0) {
    return { ids: [], next: notifications, unread, changed: false };
  }
  const pendingSet = new Set(pending);
  return {
    ids: pending,
    next: notifications.map((n) => (pendingSet.has(n.id) ? { ...n, read: true } : n)),
    unread: Math.max(0, unread - pending.length),
    changed: true,
  };
}

/** Mark everything read — the explicit button, not a side effect of opening. */
export function planMarkAllRead<T extends ReadableNotification>(
  notifications: T[],
  unread: number,
): ReadPlan<T> {
  if (unread === 0 && notifications.every((n) => n.read)) {
    return { ids: [], next: notifications, unread: 0, changed: false };
  }
  return {
    ids: notifications.filter((n) => !n.read).map((n) => n.id),
    next: notifications.map((n) => (n.read ? n : { ...n, read: true })),
    unread: 0,
    changed: true,
  };
}
