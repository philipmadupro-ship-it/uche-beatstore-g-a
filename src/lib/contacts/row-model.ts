/**
 * Pure model behind a row of the CRM contact list (`components/crm/ContactRow`).
 *
 * The old table answered "what is this person?" with the DERIVED kind
 * (lib/contacts/kind): a contact filed as Press or Buyer showed "ARTIST" the
 * moment they were sent one beat, which contradicts the role the producer
 * chose. A row now leads with the ROLE (main plus "also X"), shows what was
 * SENT in words, and keeps the derived kind only as a quiet hint.
 */
import { ROLE_GROUP_LABEL, ROLE_SENDS, contactGroups, groupOfCategory, type RoleGroup, type RoleInput } from './roles';
import type { ContactKind } from './kind';

const DAY = 86_400_000;

/** "Rapper" from "rapper", "A&R" from "a&r". Words keep their own casing rules. */
export function roleName(category: string | null | undefined): string | null {
  const c = (category ?? '').trim();
  if (!c) return null;
  if (c.toLowerCase() === 'a&r' || c.toLowerCase() === 'ar') return 'A&R';
  if (c.toLowerCase() === 'dj') return 'DJ';
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/** One line: "Rapper · also Producer". Falls back to the free-text role or label, then null. */
export function roleLine(c: RoleInput & { role?: string | null; label?: string | null }): string | null {
  const main = roleName(c.category);
  const extra = roleName(c.secondary_category);
  if (main && extra && extra !== main) return `${main} · also ${extra}`;
  if (main) return main;
  if (extra) return `also ${extra}`;
  const free = (c.role || c.label || '').trim();
  return free || null;
}

/**
 * The derived kind as a quiet secondary hint, never a role-looking badge.
 * "contact" carries no information and shows nothing.
 */
export function kindHint(kind: ContactKind | null | undefined): string | null {
  switch (kind) {
    case 'buyer': return 'Has bought';
    case 'artist': return 'Has been sent music';
    case 'lead': return 'Lead';
    default: return null;
  }
}

export interface SendLike {
  sent_at: string;
  status?: string | null;
  opened_at?: string | null;
  link_clicked_at?: string | null;
  track_ids?: string[] | null;
}

export type SendOutcome = 'none' | 'sent' | 'opened' | 'clicked' | 'interested' | 'negotiating' | 'placed' | 'pass';

export interface SentSummary {
  count: number;
  lastAt: string | null;
  tracks: number;
  outcome: SendOutcome;
  /** "Opened", "Not opened yet", "Interested"… empty when nothing was sent. */
  outcomeLabel: string;
  /** True when the latest send is unanswered and old enough to chase. */
  stale: boolean;
}

const STATUS_OUTCOME: Record<string, SendOutcome> = { interested: 'interested', negotiating: 'negotiating', placed: 'placed', pass: 'pass' };
const OUTCOME_LABEL: Record<SendOutcome, string> = {
  none: '', sent: 'Not opened yet', opened: 'Opened', clicked: 'Clicked', interested: 'Interested',
  negotiating: 'Negotiating', placed: 'Placed', pass: 'Passed',
};

/** What a contact has been sent, in the words a producer scans for. The latest send decides the outcome. */
export function summarizeSends(sends: readonly SendLike[], now: number = Date.now(), nudgeAfterDays = 5): SentSummary {
  if (sends.length === 0) return { count: 0, lastAt: null, tracks: 0, outcome: 'none', outcomeLabel: '', stale: false };
  let latest = sends[0];
  const tracks = new Set<string>();
  for (const s of sends) {
    if (s.sent_at > latest.sent_at) latest = s;
    for (const t of s.track_ids ?? []) tracks.add(t);
  }
  const status = (latest.status ?? 'sent').toLowerCase();
  const outcome: SendOutcome = STATUS_OUTCOME[status]
    ?? (latest.link_clicked_at ? 'clicked' : latest.opened_at || status === 'opened' ? 'opened' : 'sent');
  const age = (now - Date.parse(latest.sent_at)) / DAY;
  return {
    count: sends.length,
    lastAt: latest.sent_at,
    tracks: tracks.size,
    outcome,
    outcomeLabel: OUTCOME_LABEL[outcome],
    stale: status === 'sent' && !latest.opened_at && age > nudgeAfterDays,
  };
}

/** "2 sends · 5 tracks" — or "Nothing sent yet". */
export function sentCountText(s: SentSummary): string {
  if (s.count === 0) return 'Nothing sent yet';
  const sends = `${s.count} send${s.count === 1 ? '' : 's'}`;
  return s.tracks > 0 ? `${sends} · ${s.tracks} track${s.tracks === 1 ? '' : 's'}` : sends;
}

export type SendPreset = (typeof ROLE_SENDS)[RoleGroup][number];

/** The send that fits the contact's MAIN role (Send beats / loops / toplines…), the row's primary action. */
export function nextSendPreset(c: RoleInput, inWorkspace = false): SendPreset {
  const group = contactGroups(c, inWorkspace)[0] ?? 'other';
  return ROLE_SENDS[group][0];
}

/** Presets for every role the contact holds, main first — the ⋯ menu offers each. */
export function sendPresetsFor(c: RoleInput, inWorkspace = false): SendPreset[] {
  const out: SendPreset[] = [];
  for (const g of contactGroups(c, inWorkspace)) for (const p of ROLE_SENDS[g]) if (!out.some((x) => x.id === p.id)) out.push(p);
  return out;
}

/** Sorted choices for "Change role": the groups' own labels order, the stored value is the category. */
export function roleChoices(categories: readonly string[]): Array<{ value: string; label: string; group: RoleGroup }> {
  const order: RoleGroup[] = ['artist', 'producer', 'label', 'other'];
  return categories
    .map((value) => ({ value, label: roleName(value) ?? value, group: groupOfCategory(value) ?? 'other' }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** Where a role change lands: the tab (group) label, so the toast can say it. */
export function tabLabelFor(category: string | null | undefined): string {
  return ROLE_GROUP_LABEL[groupOfCategory(category) ?? 'other'];
}

/**
 * The newest `limit` sends for the contact page's "Sent to" list, newest first.
 * Ties break on id so the order never flips between renders.
 */
export function recentSends<T extends SendLike & { id: string }>(sends: readonly T[], limit = 3): T[] {
  return [...sends].sort((a, b) => b.sent_at.localeCompare(a.sent_at) || b.id.localeCompare(a.id)).slice(0, limit);
}

/**
 * The PATCH for "Change role" in a row's menu: the new MAIN role, and the extra
 * role dropped when it now equals the main one ("Producer · also Producer").
 * Returns null when nothing changes, so the menu never sends an empty PATCH.
 */
export function rolePatch(
  c: { category?: string | null; secondary_category?: string | null },
  next: string,
): { category: string; secondary_category?: null } | null {
  const want = next.trim().toLowerCase();
  if (!want) return null;
  const sameMain = (c.category ?? '').trim().toLowerCase() === want;
  const extraIsNew = (c.secondary_category ?? '').trim().toLowerCase() === want;
  if (sameMain && !extraIsNew) return null;
  return extraIsNew ? { category: want, secondary_category: null } : { category: want };
}

/** "Night Shift +2" — the first known title and how many more went out with it. Falls back to a count. */
export function sendTitleText(trackIds: readonly string[] | null | undefined, titleOf: ReadonlyMap<string, string | null | undefined>): string {
  const ids = trackIds ?? [];
  if (ids.length === 0) return 'No tracks recorded';
  const first = ids.map((id) => titleOf.get(id)).find((t): t is string => !!t);
  if (!first) return `${ids.length} track${ids.length === 1 ? '' : 's'}`;
  return ids.length > 1 ? `${first} +${ids.length - 1}` : first;
}
