/**
 * Detect duplicate sends (SHARE-08), as pure functions.
 *
 * Re-sending a beat to someone who already has it is rarely deliberate, and
 * nothing used to say so. A send is a DUPLICATE for a recipient when an
 * earlier `beat_sends` row to the same contact, inside the last 90 days, holds
 * any of the tracks about to go out. It is a warning, never a block.
 *
 * Track sets, both directions:
 *  - the new send's tracks are the picked tracks, or a project's CURRENT
 *    tracks (`project_id`);
 *  - a prior row's tracks are its `track_ids`; when the row's share is a
 *    project share (`share_token` resolves to a project) they are widened with
 *    that project's current tracks, so a beat added to a project after it was
 *    sent still counts as "they have the project".
 *
 * Recipients are keyed by `contact_id`, else the email normalised with
 * `normalizeEmail`. Resolving an email to a contact is the route's job.
 */
import { normalizeEmail } from '@/lib/contacts/email';

export const DUPLICATE_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecipientRef {
  contact_id?: string | null;
  email?: string | null;
}

/** The stable key a recipient is reported under. */
export function recipientKey(r: RecipientRef): string | null {
  if (r.contact_id) return r.contact_id;
  const email = r.email ? normalizeEmail(r.email) : '';
  return email || null;
}

export interface PriorSend {
  contact_id: string | null;
  track_ids: string[] | null;
  share_token: string | null;
  sent_at: string;
  opened_at?: string | null;
  link_clicked_at?: string | null;
}

/** Share-level activity from `share_events` (mig 203). */
export interface ShareActivity {
  opens: number;
  plays: number;
  downloads: number;
}

export interface DuplicateOutcome {
  emailOpened: boolean;
  linkClicked: boolean;
  /** Null when share_events is unavailable (before 203): nothing is claimed. */
  activity: ShareActivity | null;
}

export interface DuplicateEntry {
  /** `recipientKey` of the recipient this entry is for. */
  key: string;
  contactId: string;
  overlappingTrackIds: string[];
  lastSentAt: string;
  outcome: DuplicateOutcome;
  /** Token of the most recent overlapping send (the route reads its events). */
  shareToken: string | null;
}

export interface FindDuplicatesInput {
  /** key → contact id. A recipient with no contact has no history. */
  recipients: ReadonlyArray<{ key: string; contactId: string | null }>;
  newTrackIds: readonly string[];
  priorSends: readonly PriorSend[];
  /** share token → the project's current track ids (project shares only). */
  projectTracksByToken?: ReadonlyMap<string, readonly string[]>;
  /** share token → activity, when share_events could be read. */
  activityByToken?: ReadonlyMap<string, ShareActivity> | null;
  now?: number;
}

/** The tracks a prior send put in front of the contact. */
export function priorSendTrackIds(
  send: PriorSend,
  projectTracksByToken?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const out = new Set(send.track_ids ?? []);
  const project = send.share_token ? projectTracksByToken?.get(send.share_token) : undefined;
  for (const id of project ?? []) out.add(id);
  return [...out];
}

export function findDuplicateSends(input: FindDuplicatesInput): DuplicateEntry[] {
  const now = input.now ?? Date.now();
  const cutoff = now - DUPLICATE_WINDOW_DAYS * DAY_MS;
  const fresh = new Set(input.newTrackIds);
  if (fresh.size === 0) return [];

  const byContact = new Map<string, Array<{ send: PriorSend; overlap: string[]; at: number }>>();
  for (const send of input.priorSends) {
    if (!send.contact_id) continue;
    const at = Date.parse(send.sent_at);
    // Earlier than now, inside the window. An unreadable date is not evidence.
    if (!Number.isFinite(at) || at < cutoff || at > now) continue;
    const overlap = priorSendTrackIds(send, input.projectTracksByToken).filter((id) => fresh.has(id));
    if (overlap.length === 0) continue;
    const list = byContact.get(send.contact_id) ?? [];
    list.push({ send, overlap, at });
    byContact.set(send.contact_id, list);
  }

  const seenKeys = new Set<string>();
  const out: DuplicateEntry[] = [];
  for (const r of input.recipients) {
    if (!r.contactId || seenKeys.has(r.key)) continue;
    seenKeys.add(r.key);
    const rows = byContact.get(r.contactId);
    if (!rows || rows.length === 0) continue;
    const latest = rows.reduce((a, b) => (b.at > a.at ? b : a));
    const overlapping = new Set<string>();
    for (const row of rows) for (const id of row.overlap) overlapping.add(id);
    const token = latest.send.share_token;
    out.push({
      key: r.key,
      contactId: r.contactId,
      // New send's own order, so the notice lists tracks as picked.
      overlappingTrackIds: input.newTrackIds.filter((id, i, all) => overlapping.has(id) && all.indexOf(id) === i),
      lastSentAt: latest.send.sent_at,
      outcome: {
        emailOpened: !!latest.send.opened_at,
        linkClicked: !!latest.send.link_clicked_at,
        activity: input.activityByToken && token ? input.activityByToken.get(token) ?? { opens: 0, plays: 0, downloads: 0 } : null,
      },
      shareToken: token,
    });
  }
  return out;
}

/** "today", "yesterday", "3 days ago", "5 weeks ago". */
export function agoLabel(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const days = Math.max(0, Math.floor((now - at) / DAY_MS));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/**
 * What happened to the earlier send, from data that exists. Share events count
 * a visit as opened, so "opened" holds for an email open, a link click or a
 * page open, and "played 2×" / "downloaded" follow only from share_events.
 */
export function outcomeParts(o: DuplicateOutcome): string[] {
  const parts: string[] = [];
  const a = o.activity;
  if (o.emailOpened || o.linkClicked || (a && a.opens > 0)) parts.push('opened');
  if (a && a.plays > 0) parts.push(`played ${a.plays}×`);
  if (a && a.downloads > 0) parts.push(a.downloads === 1 ? 'downloaded' : `downloaded ${a.downloads}×`);
  // Email-open stamps miss blocked images, so silence is not claimed as "not opened".
  return parts;
}

/** "3 days ago · opened · played 2×" */
export function describeEarlierSend(entry: Pick<DuplicateEntry, 'lastSentAt' | 'outcome'>, now: number = Date.now()): string {
  return [agoLabel(entry.lastSentAt, now), ...outcomeParts(entry.outcome)].filter(Boolean).join(' · ');
}
