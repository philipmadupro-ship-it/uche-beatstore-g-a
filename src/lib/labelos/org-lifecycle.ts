/**
 * The rules of an organization's last chapter (LABEL-39), pure so the routes,
 * the crons and the settings page cannot disagree about them.
 *
 *  - Deleting is two steps (D10). The owner soft-deletes: `organizations.
 *    deleted_at` is stamped, every org route and policy treats the org as gone
 *    (migration 136), and nothing else moves. After GRACE_DAYS the purge cron
 *    deletes the rows and the `orgs/<org_id>/` object prefix. In between the
 *    owner can restore it.
 *  - Everyday activity is kept RETENTION_MONTHS (D9); audit rows are kept for
 *    the life of the org, i.e. until the purge.
 *  - Export and delete are owner-only acts and need a RECENT sign-in: a fresh
 *    magic link, not merely a session that is still alive.
 */

export const GRACE_DAYS = 30;
export const RETENTION_MONTHS = 24;
/** How recent the owner's sign-in must be to export or delete. */
export const REAUTH_WINDOW_MINUTES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date from an ISO string, or null when it is missing or not a date. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Did the user sign in (password, magic link, OAuth) within the window? Unknown or future-dated reads as no. */
export function isFreshSignIn(lastSignInAt: string | null | undefined, now: Date = new Date()): boolean {
  const at = toDate(lastSignInAt);
  if (!at) return false;
  const age = now.getTime() - at.getTime();
  // A little clock skew into the future is tolerated, a lot is not.
  return age >= -60_000 && age <= REAUTH_WINDOW_MINUTES * 60_000;
}

/** When a soft-deleted org is purged: GRACE_DAYS after it was deleted. */
export function purgeAfter(deletedAt: string | Date): Date | null {
  const at = toDate(deletedAt);
  return at ? new Date(at.getTime() + GRACE_DAYS * DAY_MS) : null;
}

/** Is the grace period over? An org that is not soft-deleted is never due. */
export function isPurgeDue(deletedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  const at = toDate(deletedAt);
  if (!at) return false;
  return now.getTime() >= at.getTime() + GRACE_DAYS * DAY_MS;
}

/** The `deleted_at` before which an org is due: anything stamped at or earlier than this. */
export function purgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - GRACE_DAYS * DAY_MS);
}

/** Whole days of grace left (rounded up, never negative). */
export function graceDaysLeft(deletedAt: string | Date, now: Date = new Date()): number {
  const due = purgeAfter(deletedAt);
  if (!due) return 0;
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / DAY_MS));
}

/** Can the owner still restore it? Soft-deleted and inside the grace period. */
export function canRestore(deletedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  const at = toDate(deletedAt);
  return !!at && !isPurgeDue(at, now);
}

/** Non-audit events older than this are pruned (D9): RETENTION_MONTHS back, calendar months. */
export function retentionCutoff(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  // 31 March minus one month is "31 February": clamp to that month's last day.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The typed confirmation must be the org's name: whitespace-collapsed and trimmed, case kept. */
export function normalizeOrgName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function confirmationMatches(typed: unknown, orgName: string): boolean {
  return typeof typed === 'string' && normalizeOrgName(typed).length > 0 && normalizeOrgName(typed) === normalizeOrgName(orgName);
}

/**
 * The producer's own `producer`-kind org is the app's tenant shadow of the
 * producer account (LABEL-07), not something a button should remove.
 */
export function canDeleteOrgKind(kind: string): boolean {
  return kind !== 'producer';
}
