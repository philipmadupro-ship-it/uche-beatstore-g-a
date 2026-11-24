/**
 * Producer Activity — the event taxonomy and its row builders (DASH-01).
 *
 * ONE pure module decides what counts as activity, which group it belongs to,
 * how it reads and where it links, so the API route, the slide-over panel and
 * the calendar's day panel cannot drift apart (the calendar used to carry its
 * own copy of the icon/colour/href maps).
 *
 * Groups (four, no more): Music · Sales · Artists · Sharing.
 *
 * Deliberately NOT activity (volume, or already a row of another kind):
 *   - plays, portal opens, downloads, notes, stage changes, "artist notified":
 *     the contact timeline and /analytics own those;
 *   - the notifications `share_comment` / `portal_comment` / `artist_reaction` /
 *     `portal_upload` / `artist_message` / `artist_request` rows: each is the
 *     bell's copy of a `project_comments` / `contact_activity` row that carries
 *     more, so reading both would list every one of them twice;
 *   - Label OS rows of any kind (org notifications, activity_events).
 *
 * Text is built FIELD BY FIELD from named columns. Never from a free-form body
 * beyond a short excerpt of a comment, never an email address, never a share or
 * portal token or URL.
 */

export const ACTIVITY_GROUPS = ['music', 'sales', 'artists', 'sharing'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const GROUP_LABEL: Record<ActivityGroup, string> = {
  music: 'Music',
  sales: 'Sales',
  artists: 'Artists',
  sharing: 'Sharing',
};

export const ACTIVITY_KINDS = [
  'upload', 'version', 'rating',
  'sale', 'refund', 'dispute', 'offer', 'delivery_issue',
  'artist_reaction', 'artist_message', 'artist_request', 'artist_request_done', 'artist_upload', 'comment',
  'send', 'opened',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const KIND_GROUP: Record<ActivityKind, ActivityGroup> = {
  upload: 'music', version: 'music', rating: 'music',
  sale: 'sales', refund: 'sales', dispute: 'sales', offer: 'sales', delivery_issue: 'sales',
  artist_reaction: 'artists', artist_message: 'artists', artist_request: 'artists',
  artist_request_done: 'artists', artist_upload: 'artists', comment: 'artists',
  send: 'sharing', opened: 'sharing',
};

export type ActivityTone = 'positive' | 'neutral' | 'warning' | 'danger';

export type ActivityIconName =
  | 'upload' | 'git-branch' | 'star' | 'shopping-bag' | 'rotate-ccw' | 'alert-triangle' | 'tag' | 'package-x'
  | 'heart' | 'message-circle' | 'hand-helping' | 'file-up' | 'message-square' | 'send' | 'eye';

export const KIND_ICON: Record<ActivityKind, ActivityIconName> = {
  upload: 'upload', version: 'git-branch', rating: 'star',
  sale: 'shopping-bag', refund: 'rotate-ccw', dispute: 'alert-triangle', offer: 'tag', delivery_issue: 'package-x',
  artist_reaction: 'heart', artist_message: 'message-circle', artist_request: 'hand-helping',
  artist_request_done: 'hand-helping', artist_upload: 'file-up', comment: 'message-square',
  send: 'send', opened: 'eye',
};

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  group: ActivityGroup;
  tone: ActivityTone;
  at: string;
  title: string;
  subject_id?: string | null;
  subject_kind?: 'track' | 'project' | 'contact' | null;
  /** In-app path the row opens, or null. Always a same-origin path, never a share/portal URL. */
  href: string | null;
  meta?: Record<string, unknown>;
}

/* ── small pure helpers ───────────────────────────────────────────────── */

// Ids only ever key into the owner's own name maps, so any non-empty string is safe to look up.
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** Collapse whitespace and cut to `max` characters with an ellipsis. */
export function excerpt(text: unknown, max = 80): string {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

const quote = (title: unknown, fallback = 'a track') => {
  const t = excerpt(title, 60);
  return t ? `“${t}”` : fallback;
};

const pathFor = (kind: 'track' | 'project' | 'contact', id: string | null | undefined, tab?: string): string | null => {
  if (!id) return null;
  if (kind === 'track') return `/library/${id}`;
  if (kind === 'project') return `/projects/${id}`;
  return `/contacts/${id}${tab ? `?tab=${tab}` : ''}`;
};

function make(
  kind: ActivityKind,
  id: string,
  at: string,
  title: string,
  tone: ActivityTone,
  subject: { id?: string | null; kind?: ActivityItem['subject_kind']; href: string | null },
  meta?: Record<string, unknown>,
): ActivityItem {
  return {
    id, kind, group: KIND_GROUP[kind], tone, at, title,
    subject_id: subject.id ?? null,
    subject_kind: subject.kind ?? null,
    href: subject.href,
    ...(meta ? { meta } : {}),
  };
}

/** Name lookups the route resolves from the owner's own rows. */
export interface Names {
  track: (id: string | null | undefined) => string | null;
  contact: (id: string | null | undefined) => string | null;
  project: (id: string | null | undefined) => string | null;
}

const who = (n: string | null) => excerpt(n, 40) || 'An artist';

/* ── Music ────────────────────────────────────────────────────────────── */

export const uploadItem = (t: { id: string; title: string | null; created_at: string }): ActivityItem =>
  make('upload', `upload-${t.id}`, t.created_at, `Uploaded ${quote(t.title)}`, 'neutral',
    { id: t.id, kind: 'track', href: pathFor('track', t.id) });

export const versionItem = (v: { id: string; track_id: string; version_label: string | null; created_at: string }, names: Names): ActivityItem => {
  const label = excerpt(v.version_label, 30);
  const track = names.track(v.track_id);
  return make('version', `version-${v.id}`, v.created_at,
    `New version${label ? ` ${label}` : ''}${track ? ` of ${quote(track)}` : ''}`, 'neutral',
    { id: v.track_id, kind: 'track', href: pathFor('track', v.track_id) });
};

export const ratingItem = (r: { id: string; track_id: string; rating: number; rated_at: string }, names: Names): ActivityItem =>
  make('rating', `rating-${r.id}`, r.rated_at, `Rated ${quote(names.track(r.track_id))} ${r.rating}/5`, 'neutral',
    { id: r.track_id, kind: 'track', href: pathFor('track', r.track_id) });

/* ── Sharing ──────────────────────────────────────────────────────────── */

export function sendItem(s: { id: string; contact_id: string; track_ids: unknown; sent_at: string; message?: string | null }, names: Names): ActivityItem {
  const ids = Array.isArray(s.track_ids) ? (s.track_ids as unknown[]).filter(isId) : [];
  const first = ids.length ? names.track(ids[0]) : null;
  const what = ids.length === 0
    ? 'a track'
    : first ? `${quote(first)}${ids.length > 1 ? ` +${ids.length - 1}` : ''}` : `${ids.length} track${ids.length === 1 ? '' : 's'}`;
  const to = names.contact(s.contact_id);
  return make('send', `send-${s.id}`, s.sent_at, `Sent ${what}${to ? ` to ${excerpt(to, 40)}` : ''}`, 'neutral',
    { id: s.contact_id, kind: 'contact', href: pathFor('contact', s.contact_id) }, { send_id: s.id });
}

/** "Opened" is one row per send (the first open); a link click folds into the same row. */
export function openedItem(s: { id: string; contact_id: string; opened_at?: string | null; link_clicked_at?: string | null }, names: Names): ActivityItem | null {
  const at = s.opened_at || s.link_clicked_at;
  if (!at) return null;
  const to = names.contact(s.contact_id);
  const clicked = !!s.link_clicked_at;
  return make('opened', `opened-${s.id}`, at,
    `${to ? excerpt(to, 40) : 'A recipient'} opened your send${clicked ? ' and clicked the link' : ''}`, 'positive',
    { id: s.contact_id, kind: 'contact', href: pathFor('contact', s.contact_id) }, { send_id: s.id });
}

/* ── Artists ──────────────────────────────────────────────────────────── */

export function commentItem(c: { id: string; project_id: string; track_id?: string | null; user_id?: string | null; share_token?: string | null; author_name?: string | null; contact_id?: string | null; body?: string | null; created_at: string }, names: Names): ActivityItem {
  const author = c.user_id ? 'You' : (c.contact_id && names.contact(c.contact_id)) || excerpt(c.author_name, 40) || 'A guest';
  const project = names.project(c.project_id);
  const body = excerpt(c.body, 80);
  const via = c.contact_id ? 'portal' : c.share_token ? 'share' : null;
  return make('comment', `comment-${c.id}`, c.created_at,
    `${author} commented${project ? ` on ${quote(project, 'a project')}` : ''}${body ? `: “${body}”` : ''}`, 'neutral',
    { id: c.project_id, kind: 'project', href: pathFor('project', c.project_id) },
    { track_id: c.track_id ?? null, via_share: !!c.share_token, via });
}

/** Stored contact timeline rows that are activity. Anything else returns null (see the exclusions above). */
export function contactActivityItem(
  a: { id: string; contact_id: string; kind: string; metadata?: Record<string, unknown> | null; occurred_at: string },
  names: Names,
): ActivityItem | null {
  const md = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const name = who(names.contact(a.contact_id));
  const id = `ca-${a.id}`;
  switch (a.kind) {
    case 'decision_changed': {
      // Only the artist's own answer is news; the producer's own decisions are theirs.
      if (md.set_by !== 'artist') return null;
      const track = quote(names.track(isId(md.track_id) ? md.track_id : null));
      const d = md.decision;
      const text = d === 'passed' ? `${name} passed on ${track}`
        : d === 'interested' ? `${name} is interested in ${track}`
        : `${name} took back their answer on ${track}`;
      return make('artist_reaction', id, a.occurred_at, text, d === 'interested' ? 'positive' : 'neutral',
        { id: a.contact_id, kind: 'contact', href: pathFor('contact', a.contact_id, 'beats') });
    }
    case 'artist_message':
      return make('artist_message', id, a.occurred_at, `${name} sent you a message`, 'neutral',
        { id: a.contact_id, kind: 'contact', href: pathFor('contact', a.contact_id, 'messages') });
    case 'artist_request':
      return make('artist_request', id, a.occurred_at, `${name} made a request`, 'neutral',
        { id: a.contact_id, kind: 'contact', href: pathFor('contact', a.contact_id, 'messages') });
    case 'artist_request_resolved':
      return make('artist_request_done', id, a.occurred_at, `Request from ${name} closed`, 'neutral',
        { id: a.contact_id, kind: 'contact', href: pathFor('contact', a.contact_id, 'messages') });
    case 'file_uploaded': {
      const project = isId(md.project_id) ? names.project(md.project_id) : null;
      return make('artist_upload', id, a.occurred_at, `${name} sent a file${project ? ` to ${quote(project, 'a project')}` : ''}`, 'positive',
        { id: a.contact_id, kind: 'contact', href: pathFor('contact', a.contact_id, 'files') });
    }
    default:
      return null;
  }
}

/* ── Sales (producer notifications; only the money / delivery kinds) ──── */

const SALES_KINDS: Record<string, ActivityKind> = {
  purchase: 'sale', refund: 'refund', dispute: 'dispute', buyer_offer: 'offer', fulfillment_alert: 'delivery_issue',
};

export function notificationItem(
  n: { id: string; kind: string; title?: string | null; data?: unknown; created_at: string },
  presented: { tone: ActivityTone; href: string | null },
): ActivityItem | null {
  const kind = SALES_KINDS[n.kind];
  if (!kind) return null;
  const title = excerpt(n.title, 100) || (kind === 'sale' ? 'New sale' : kind === 'refund' ? 'Refund' : kind === 'dispute' ? 'Dispute' : kind === 'offer' ? 'New offer' : 'Delivery issue');
  return make(kind, `notif-${n.id}`, n.created_at, title, presented.tone, { href: presented.href });
}

/* ── Merge, filter, group ─────────────────────────────────────────────── */

/** Newest first, ids unique (first one wins), capped. */
export function mergeActivity(items: ActivityItem[], limit = 200): ActivityItem[] {
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const it of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export function groupCounts(items: Pick<ActivityItem, 'group'>[]): Record<ActivityGroup, number> {
  const counts: Record<ActivityGroup, number> = { music: 0, sales: 0, artists: 0, sharing: 0 };
  for (const i of items) counts[i.group] += 1;
  return counts;
}

export function filterByGroup<T extends Pick<ActivityItem, 'group'>>(items: T[], group: ActivityGroup | 'all'): T[] {
  return group === 'all' ? items : items.filter((i) => i.group === group);
}

export interface DaySection<T> { key: string; label: string; items: T[] }

/** Sections in the order given (so pass newest-first). Labels: Today / Yesterday / "Mon, Nov 17". */
export function groupByDay<T extends Pick<ActivityItem, 'at'>>(items: T[], now: number = Date.now(), timeZone?: string): DaySection<T>[] {
  const key = (ms: number) => new Date(ms).toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined);
  const todayKey = key(now);
  const yesterdayKey = key(now - 86_400_000);
  const sections: DaySection<T>[] = [];
  for (const it of items) {
    const ms = Date.parse(it.at);
    if (Number.isNaN(ms)) continue;
    const k = key(ms);
    let s = sections[sections.length - 1];
    if (!s || s.key !== k) {
      s = {
        key: k,
        label: k === todayKey ? 'Today' : k === yesterdayKey ? 'Yesterday'
          : new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) }),
        items: [],
      };
      sections.push(s);
    }
    s.items.push(it);
  }
  return sections;
}
