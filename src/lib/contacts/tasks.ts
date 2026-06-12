/**
 * Task due-date categorization — pure, testable.
 *
 * Buckets an open follow-up task relative to "now" so the UI can group and
 * color it (overdue red, today amber, upcoming neutral, someday faint).
 */

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'someday';

export function categorizeDue(dueAt: string | null | undefined, now: number = Date.now()): DueBucket {
  if (!dueAt) return 'someday';
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return 'someday';

  // Compare on calendar-day boundaries in the local timezone.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = startOfToday.getTime() + 86_400_000;

  if (due < startOfToday.getTime()) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  return 'upcoming';
}

/** Short human label for a due date relative to now. */
export function dueLabel(dueAt: string | null | undefined, now: number = Date.now()): string {
  if (!dueAt) return 'No date';
  const bucket = categorizeDue(dueAt, now);
  const d = new Date(dueAt);
  if (bucket === 'today') return 'Today';
  if (bucket === 'overdue') {
    const days = Math.ceil((now - d.getTime()) / 86_400_000);
    return days <= 1 ? 'Yesterday' : `${days}d overdue`;
  }
  // upcoming
  const days = Math.ceil((d.getTime() - now) / 86_400_000);
  if (days === 1) return 'Tomorrow';
  if (days <= 7) return `In ${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const DUE_META: Record<DueBucket, { color: string; bg: string }> = {
  overdue:  { color: '#E8896A', bg: 'rgba(232,137,106,0.12)' },
  today:    { color: '#E8C86A', bg: 'rgba(232,200,106,0.12)' },
  upcoming: { color: '#D0C3AF', bg: 'rgba(160,138,106,0.10)' },
  someday:  { color: '#9B9282', bg: 'rgba(255,255,255,0.03)' },
};
