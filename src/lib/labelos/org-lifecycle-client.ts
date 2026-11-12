/**
 * Client-side helpers for the org data page and the restore page (LABEL-39):
 * what a route's answer means to the person looking at it. Pure, so the
 * words and the branches are tested, not buried in a component.
 */
import { GRACE_DAYS, confirmationMatches } from './org-lifecycle';

export type LifecycleFailure =
  | { kind: 'reauth' }
  | { kind: 'forbidden' }
  | { kind: 'rate' }
  | { kind: 'gone' }
  | { kind: 'conflict'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

/** Turn a failed response into one thing the page knows how to show. */
export function interpretFailure(status: number, body: unknown): LifecycleFailure {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; requiresReauth?: unknown };
  const message = typeof b.error === 'string' && b.error ? b.error : 'Something went wrong. Try again.';
  if (status === 403 && b.requiresReauth === true) return { kind: 'reauth' };
  if (status === 403 || status === 401) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rate' };
  if (status === 404 || status === 410) return { kind: 'gone' };
  if (status === 409) return { kind: 'conflict', message };
  if (status === 400) return { kind: 'invalid', message };
  return { kind: 'error', message };
}

export function failureMessage(f: LifecycleFailure): string {
  switch (f.kind) {
    case 'reauth':
      return 'For safety, confirm it is you with a fresh sign-in link, then try again.';
    case 'forbidden':
      return 'Only an owner of this organization can do this.';
    case 'rate':
      return 'Too many exports in a short time. Try again in an hour.';
    case 'gone':
      return 'This organization is no longer available.';
    default:
      return f.message;
  }
}

/** The delete button is live only when the typed name matches. */
export function canSubmitDelete(typed: string, orgName: string): boolean {
  return confirmationMatches(typed, orgName);
}

/** `Content-Disposition: attachment; filename="x.json"` → `x.json`, or the fallback. */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"\\/]+)"/);
  return match ? match[1] : fallback;
}

/** "Wed 11 Nov 2026" for an ISO date, or '' when it is not one. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export const DELETE_EXPLAINER =
  `Deleting starts a ${GRACE_DAYS}-day countdown. The organization disappears for everyone at once — members, ` +
  'external collaborators, artists — and nothing new can be added. Until the countdown ends you can restore it from the link we show you next. ' +
  'After that, every row and every file is deleted for good, including the activity history.';

export function daysLeftLabel(days: number): string {
  if (days <= 0) return 'less than a day';
  return days === 1 ? '1 day' : `${days} days`;
}
