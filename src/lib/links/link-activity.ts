/**
 * What happened on a share link, as pure functions (SHARE-06).
 *
 * Three sources feed one summary:
 *  - the link's own `plays` counter — page OPENS, all time, every refresh
 *    (`shareOpensLabel`); the existing number /links already shows, so it is
 *    what "Opened" means here;
 *  - `share_events` (mig 203) — distinct visitors, per-track plays, downloads
 *    and last activity. Recorded from the day 203 was applied, so a link older
 *    than its first event gets a `since` date instead of looking quiet;
 *  - `beat_sends` — how often the link was sent, with Resend's email open /
 *    click stamps.
 */

export type ShareEventKind = 'open' | 'play' | 'download' | 'download_all';

export interface ShareEventRow {
  kind: ShareEventKind;
  ip_hash: string | null;
  created_at: string;
}

export interface SendRow {
  contact_id: string | null;
  sent_at: string;
  opened_at?: string | null;
  link_clicked_at?: string | null;
}

export interface ContactActivity {
  contactId: string;
  sends: number;
  emailOpened: boolean;
  linkClicked: boolean;
  lastSentAt: string;
}

export interface LinkActivity {
  /** Times this link was emailed (beat_sends rows carrying its token). */
  sends: number;
  /** The link's own counter: page loads, all time. */
  opens: number;
  /** Distinct visitors (salted IP hashes) seen since events were recorded. */
  people: number;
  plays: number;
  /** A zip of the whole share counts as one download. */
  downloads: number;
  lastActivityAt: string | null;
  /**
   * First recorded event, when the link is OLDER than it: people / plays /
   * downloads only cover the time since. Null when the link is no older than
   * its first event (nothing is missing) or nothing was recorded.
   */
  since: string | null;
  contacts: ContactActivity[];
}

/** A link made minutes before its first visit is not "older than the log". */
const SINCE_GRACE_MS = 60 * 60 * 1000;

const time = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  return Date.parse(iso);
};

export function summarizeLinkActivity(input: {
  link: { plays?: number | null; created_at: string };
  events: readonly ShareEventRow[];
  sends: readonly SendRow[];
}): LinkActivity {
  const { link, events, sends } = input;

  const visitors = new Set<string>();
  let plays = 0;
  let downloads = 0;
  let first = Infinity;
  let last = -Infinity;

  for (const e of events) {
    if (e.ip_hash) visitors.add(e.ip_hash);
    if (e.kind === 'play') plays += 1;
    else if (e.kind === 'download' || e.kind === 'download_all') downloads += 1;
    const t = time(e.created_at);
    if (Number.isFinite(t)) {
      if (t < first) first = t;
      if (t > last) last = t;
    }
  }

  // Resend's stamps are activity too: the recipient opened the email.
  for (const s of sends) {
    for (const stamp of [s.opened_at, s.link_clicked_at]) {
      const t = time(stamp);
      if (Number.isFinite(t) && t > last) last = t;
    }
  }

  const byContact = new Map<string, ContactActivity>();
  for (const s of sends) {
    if (!s.contact_id) continue;
    const prev = byContact.get(s.contact_id);
    const row: ContactActivity = prev ?? {
      contactId: s.contact_id,
      sends: 0,
      emailOpened: false,
      linkClicked: false,
      lastSentAt: s.sent_at,
    };
    row.sends += 1;
    row.emailOpened ||= Boolean(s.opened_at);
    row.linkClicked ||= Boolean(s.link_clicked_at);
    if (time(s.sent_at) > time(row.lastSentAt)) row.lastSentAt = s.sent_at;
    byContact.set(s.contact_id, row);
  }

  const created = time(link.created_at);
  const since = Number.isFinite(first) && Number.isFinite(created) && created < first - SINCE_GRACE_MS ? new Date(first).toISOString() : null;
  const opens = typeof link.plays === 'number' && Number.isFinite(link.plays) && link.plays > 0 ? Math.floor(link.plays) : 0;

  return {
    sends: sends.length,
    opens,
    people: visitors.size,
    plays,
    downloads,
    lastActivityAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
    since,
    contacts: [...byContact.values()].sort((a, b) => time(b.lastSentAt) - time(a.lastSentAt)),
  };
}

/** "2h ago" style, for the strip. */
export function agoLabel(iso: string | null, now: number = Date.now()): string | null {
  const t = time(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
