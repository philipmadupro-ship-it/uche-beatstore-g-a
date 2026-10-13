/**
 * The activity digest (LABEL-20, 08 §B5). Pure: events in, grouped lines out.
 * The loader (activity-store.ts) reads and filters the events; the UI renders
 * what this returns. Nothing here knows about scope or visibility — an event
 * that reaches `buildDigest` is one the viewer may see (activity-feed.ts).
 *
 * Grouping, per view (08 §B5, with 07 §3's "one grouped line per actor per
 * day"):
 *
 *   overview  artist → day → actor        (the org's "Since your last visit")
 *   artist    day → actor                 (the artist's Activity tab)
 *   project   day → actor
 *   song      day → one line per event    (the audit view: chronological, ungrouped)
 *
 * A LINE is everything one actor did on one day in that place. Inside it,
 * events collapse into PARTS:
 *
 *  - the same verb counts once per distinct subject: ten `song.created`
 *    within ten minutes are "added 10 demos" (and so are the same ten spread
 *    over a day — the per-day rule already makes them one line), and one file
 *    renamed five times is one file edited;
 *  - everything that happened to one release is ONE part. A tracklist edit is
 *    `release.updated` with `payload.items` (added | removed | reordered |
 *    edited), a cancel is `payload.state.to`: five moves of one tracklist
 *    read "edited the tracklist of ‘EP’", a new release absorbs its first
 *    edits ("created the release"), and a delete absorbs everything.
 *
 * Days are calendar days in the viewer's time zone (`dayKey`); the default is
 * UTC. Everything sorts newest first and ties break on stable keys, so the
 * result does not depend on the order events arrive in.
 */
// Types only: this module runs in the browser, and activity.ts is the server's writer.
import type { Verb } from './activity';
import { SONG_STAGE_LABEL, isSongStage } from './song-stage';
import { REVIEW_VERDICT_LABEL, isReviewVerdict } from './song-review';

// ── Input ───────────────────────────────────────────────────────────────

export type ReleaseItemsChange = 'added' | 'removed' | 'reordered' | 'edited';

/** The few payload fields a feed may carry (activity-feed.ts#toFeedEvent). */
export type EventSummary = {
  title?: string;
  /** `release.updated`: what happened to the tracklist (LABEL-19). */
  items?: ReleaseItemsChange;
  /** `release.updated`: a state change. */
  state?: { from?: string; to?: string };
  /** `song.created`: the stage the song arrived in. */
  stage?: string;
  /** `song.stage_changed`: where it moved from and to (LABEL-24). */
  move?: { from: string; to: string };
  /** `song.reviewed`: the rating and verdict given, never the note (LABEL-25). */
  review?: { rating?: number | null; verdict?: string | null };
};

export type DigestEvent = {
  id: string;
  /** A `Verb`, or one a newer server knows and this build does not. */
  verb: string;
  /** ISO timestamp. */
  at: string;
  actorId: string | null;
  artistId: string | null;
  projectId: string | null;
  songId: string | null;
  releaseId: string | null;
  subjectId: string | null;
  summary: EventSummary;
};

export type DigestView = 'overview' | 'artist' | 'project' | 'song';

export type DigestOptions = {
  view: DigestView;
  /** IANA zone for "which day is it"; default UTC. */
  timeZone?: string;
  /**
   * project id → the roster artists to file a project-only event under
   * (first wins). The loader builds it from the member's own scope, so a
   * scoped member's headings never name an artist outside it.
   */
  projectArtists?: ReadonlyMap<string, readonly string[]>;
};

// ── Output ──────────────────────────────────────────────────────────────

export type DigestPart =
  | { kind: 'verb'; verb: string; count: number; /** `song.created` only: how many arrived as demos. */ demos?: number }
  /** One song's moves in one line: the first `from` and the last `to`. `moves` is how many events it took. */
  | { kind: 'stage'; songId: string | null; from: string; to: string; moves: number }
  /** One song's review by one actor in one line: the last rating and verdict they gave it that day. */
  | { kind: 'review'; songId: string | null; rating: number | null; verdict: string | null }
  | {
      kind: 'release';
      releaseId: string | null;
      title: string | null;
      created: boolean;
      deleted: boolean;
      delivered: boolean;
      cancelled: boolean;
      /** Distinct tracklist changes (`items`), and edits to the release itself. */
      tracklist: number;
      edited: number;
    };

export type DigestLine = {
  key: string;
  actorId: string | null;
  parts: DigestPart[];
  /** Events folded into this line (a part's count is of subjects, this is of events). */
  events: number;
  firstAt: string;
  lastAt: string;
  eventIds: string[];
};

export type DigestDay = { day: string; lines: DigestLine[] };

export type DigestSection = {
  /** The roster artist, or null: the organization itself (or the one section of a non-overview view). */
  artistId: string | null;
  days: DigestDay[];
  events: number;
};

export type Digest = { view: DigestView; sections: DigestSection[]; events: number };

export type DigestNames = {
  actors: Readonly<Record<string, string>>;
  artists: Readonly<Record<string, string>>;
  releases: Readonly<Record<string, string>>;
  /** song id → title, for the songs the events name (optional: a feed from before LABEL-24 has none). */
  songs?: Readonly<Record<string, string>>;
};

// ── Days ────────────────────────────────────────────────────────────────

/** One formatter per zone: building an `Intl.DateTimeFormat` costs far more than using one, and a feed formats hundreds of instants. */
const dayFormats = new Map<string, Intl.DateTimeFormat | null>();

function dayFormat(zone: string): Intl.DateTimeFormat | null {
  if (!dayFormats.has(zone)) {
    try {
      dayFormats.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }));
    } catch {
      dayFormats.set(zone, null); // a zone this runtime does not know
    }
  }
  return dayFormats.get(zone) ?? null;
}

/** `YYYY-MM-DD` of an instant in a zone. An unknown zone reads as UTC. */
export function dayKey(iso: string, timeZone = 'UTC'): string {
  const date = new Date(iso);
  return (dayFormat(timeZone) ?? (dayFormat('UTC') as Intl.DateTimeFormat)).format(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DIGEST_DEFAULT_DAYS = 7;
export const DIGEST_MAX_DAYS = 30;

/**
 * Where "since your last visit" starts: the last visit, but never further
 * back than 30 days (an org nobody opened for a quarter is not one long
 * list), a week when there was no visit, and never in the future.
 */
export function sinceWindow(lastSeenAt: string | null | undefined, now: Date): string {
  const floor = now.getTime() - DIGEST_MAX_DAYS * DAY_MS;
  const parsed = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (Number.isNaN(parsed)) return new Date(now.getTime() - DIGEST_DEFAULT_DAYS * DAY_MS).toISOString();
  return new Date(Math.min(Math.max(parsed, floor), now.getTime())).toISOString();
}

// ── Collapse ────────────────────────────────────────────────────────────

/** More stage-moved songs than this in one line read as a count ("moved 5 songs…"), not a list of titles. */
const STAGE_PARTS_MAX = 2;

const RELEASE_VERBS = new Set(['release.created', 'release.updated', 'release.deleted', 'release.delivered']);

/** Verbs in the order a line mentions them; a project is mentioned before the release made in it. Unlisted verbs follow in `VERBS` order. */
const PART_ORDER: readonly string[] = [
  'song.created',
  'recording.uploaded',
  'stage',
  'song.stage_changed',
  'song.reviewed',
  'project.created',
  'release',
  'file.uploaded',
];

function partRank(part: DigestPart): number {
  const name = part.kind === 'release' ? 'release' : part.kind === 'stage' ? 'stage' : part.kind === 'review' ? 'song.reviewed' : part.verb;
  const i = PART_ORDER.indexOf(name);
  if (i >= 0) return i;
  // Everything else follows in the order VERB_PHRASES lists the verbs (which is `VERBS` order; a test holds it total).
  const known = Object.keys(VERB_PHRASES);
  const v = known.indexOf(name);
  return PART_ORDER.length + (v >= 0 ? v : known.length);
}

const byTime = (a: DigestEvent, b: DigestEvent) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);

function releasePart(events: readonly DigestEvent[]): DigestPart {
  const part = {
    kind: 'release' as const,
    releaseId: events[0].releaseId ?? events[0].subjectId,
    title: null as string | null,
    created: false,
    deleted: false,
    delivered: false,
    cancelled: false,
    tracklist: 0,
    edited: 0,
  };
  for (const e of events) {
    part.title = e.summary.title ?? part.title;
    if (e.verb === 'release.created') part.created = true;
    else if (e.verb === 'release.deleted') part.deleted = true;
    else if (e.verb === 'release.delivered') part.delivered = true;
    else {
      if (e.summary.state?.to === 'cancelled') part.cancelled = true;
      if (e.summary.state?.to === 'delivered') part.delivered = true;
      if (e.summary.items) part.tracklist += 1;
      else if (!e.summary.state) part.edited += 1;
    }
  }
  return part;
}

/** Fold one actor's events of one day (one place) into parts. Events must be sorted by time. */
function collapse(events: readonly DigestEvent[]): DigestPart[] {
  const parts: DigestPart[] = [];
  const releases = new Map<string, DigestEvent[]>();
  const verbs = new Map<string, DigestEvent[]>();
  const stageMoves = new Map<string, DigestEvent[]>();
  const reviews = new Map<string, DigestEvent[]>();
  for (const e of events) {
    const move = e.verb === 'song.stage_changed' ? e.summary.move : undefined;
    if (move && isSongStage(move.from) && isSongStage(move.to)) {
      const key = (e.songId ?? e.subjectId ?? e.id).toLowerCase();
      stageMoves.set(key, [...(stageMoves.get(key) ?? []), e]);
    } else if (e.verb === 'song.reviewed' && e.summary.review && (e.summary.review.rating !== undefined || e.summary.review.verdict !== undefined)) {
      const key = (e.songId ?? e.subjectId ?? e.id).toLowerCase();
      reviews.set(key, [...(reviews.get(key) ?? []), e]);
    } else if (RELEASE_VERBS.has(e.verb)) {
      const key = e.releaseId ?? e.subjectId ?? e.id;
      releases.set(key, [...(releases.get(key) ?? []), e]);
    } else {
      verbs.set(e.verb, [...(verbs.get(e.verb) ?? []), e]);
    }
  }
  for (const group of releases.values()) parts.push(releasePart(group));
  if (stageMoves.size > STAGE_PARTS_MAX) {
    // A bulk move: a list of titles would crowd the line. Count the songs, and let any unreadable move join the same count.
    const subjects = new Set([...stageMoves.keys(), ...(verbs.get('song.stage_changed') ?? []).map((e) => (e.songId ?? e.subjectId ?? e.id).toLowerCase())]);
    verbs.delete('song.stage_changed');
    parts.push({ kind: 'verb', verb: 'song.stage_changed', count: subjects.size });
  } else {
    for (const [songKey, group] of stageMoves) {
      // `events` arrive sorted by time, so the first is where the song started the day and the last where it ended.
      const first = group[0].summary.move!;
      const last = group[group.length - 1].summary.move!;
      parts.push({ kind: 'stage', songId: songKey, from: first.from, to: last.to, moves: group.length });
    }
  }
  if (reviews.size > STAGE_PARTS_MAX) {
    // A review spree: count the songs, and let any unreadable review join the same count.
    const subjects = new Set([...reviews.keys(), ...(verbs.get('song.reviewed') ?? []).map((e) => (e.songId ?? e.subjectId ?? e.id).toLowerCase())]);
    verbs.delete('song.reviewed');
    parts.push({ kind: 'verb', verb: 'song.reviewed', count: subjects.size });
  } else {
    for (const [songKey, group] of reviews) {
      // Sorted by time: what the reviewer ended the day saying. A later review that left a field out keeps the earlier one's.
      let rating: number | null = null;
      let verdict: string | null = null;
      for (const e of group) {
        // Absent = that save did not touch the field; null = the reviewer cleared it.
        if (e.summary.review?.rating !== undefined) rating = e.summary.review.rating;
        if (e.summary.review?.verdict !== undefined) verdict = e.summary.review.verdict;
      }
      parts.push({ kind: 'review', songId: songKey, rating, verdict });
    }
  }
  for (const [verb, group] of verbs) {
    const subjects = new Set(group.map((e) => e.subjectId ?? e.id));
    const part: DigestPart = { kind: 'verb', verb, count: subjects.size };
    if (verb === 'song.created') {
      part.demos = new Set(group.filter((e) => e.summary.stage === 'inbox').map((e) => e.subjectId ?? e.id)).size;
    }
    parts.push(part);
  }
  // Stable: by rank, then (for releases) by when the release was first touched, which is insertion order.
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => partRank(a.p) - partRank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

function line(key: string, actorId: string | null, events: readonly DigestEvent[]): DigestLine {
  const sorted = [...events].sort(byTime);
  return {
    key,
    actorId,
    parts: collapse(sorted),
    events: sorted.length,
    firstAt: sorted[0].at,
    lastAt: sorted[sorted.length - 1].at,
    eventIds: sorted.map((e) => e.id),
  };
}

// ── Build ───────────────────────────────────────────────────────────────

/** The artist an overview event is filed under: its own, else its project's, else the organization (null). */
function artistOf(e: DigestEvent, projectArtists: DigestOptions['projectArtists']): string | null {
  if (e.artistId) return e.artistId;
  if (e.projectId) return projectArtists?.get(e.projectId)?.[0] ?? null;
  return null;
}

function buildDays(events: readonly DigestEvent[], view: DigestView, timeZone: string | undefined): DigestDay[] {
  const byDay = new Map<string, DigestEvent[]>();
  for (const e of events) {
    const day = dayKey(e.at, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, inDay]) => {
      let lines: DigestLine[];
      if (view === 'song') {
        lines = inDay.map((e) => line(`${day}|${e.id}`, e.actorId, [e]));
      } else {
        const byActor = new Map<string, DigestEvent[]>();
        for (const e of inDay) {
          const k = e.actorId ?? '';
          byActor.set(k, [...(byActor.get(k) ?? []), e]);
        }
        lines = [...byActor.entries()].map(([actor, evs]) => line(`${day}|${actor || 'system'}`, actor || null, evs));
      }
      lines.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.key.localeCompare(b.key));
      return { day, lines };
    });
}

export function buildDigest(events: readonly DigestEvent[], opts: DigestOptions): Digest {
  const { view, timeZone, projectArtists } = opts;
  if (events.length === 0) return { view, sections: [], events: 0 };

  if (view !== 'overview') {
    return { view, sections: [{ artistId: null, days: buildDays(events, view, timeZone), events: events.length }], events: events.length };
  }

  const byArtist = new Map<string | null, DigestEvent[]>();
  for (const e of events) {
    const artist = artistOf(e, projectArtists);
    byArtist.set(artist, [...(byArtist.get(artist) ?? []), e]);
  }
  const latest = (evs: readonly DigestEvent[]) => evs.reduce((m, e) => (e.at > m ? e.at : m), '');
  const sections = [...byArtist.entries()]
    .map(([artistId, evs]) => ({ artistId, evs, latest: latest(evs) }))
    // The organization's own events trail the artists; artists lead by latest activity.
    .sort((a, b) => Number(a.artistId === null) - Number(b.artistId === null) || b.latest.localeCompare(a.latest) || String(a.artistId).localeCompare(String(b.artistId)))
    .map(({ artistId, evs }): DigestSection => ({ artistId, days: buildDays(evs, view, timeZone), events: evs.length }));
  return { view, sections, events: events.length };
}

// ── Words ───────────────────────────────────────────────────────────────

/** `one` for a single subject, `many` with `{n}` for more. A test holds this total over `Verb`. */
export const VERB_PHRASES: Readonly<Record<Verb, { one: string; many: string }>> = {
  'org.created': { one: 'created the organization', many: 'created the organization' },
  'org.settings_changed': { one: 'changed the organization settings', many: 'changed the organization settings' },
  'member.joined': { one: 'joined the organization', many: 'joined the organization' },
  'member.removed': { one: 'removed a member', many: 'removed {n} members' },
  'member.role_changed': { one: 'changed a member’s role', many: 'changed {n} members’ roles' },
  'member.scope_changed': { one: 'changed a member’s access to artists', many: 'changed {n} members’ access to artists' },
  'member.capabilities_changed': { one: 'changed a member’s abilities', many: 'changed {n} members’ abilities' },
  'member.artists_changed': { one: 'changed a member’s artist list', many: 'changed {n} members’ artist lists' },
  'invitation.created': { one: 'invited a member', many: 'invited {n} members' },
  'invitation.revoked': { one: 'revoked an invitation', many: 'revoked {n} invitations' },
  'contact.created': { one: 'added a contact', many: 'added {n} contacts' },
  'contact.updated': { one: 'updated a contact', many: 'updated {n} contacts' },
  'contact.deleted': { one: 'removed a contact', many: 'removed {n} contacts' },
  'project.created': { one: 'created a project', many: 'created {n} projects' },
  'project.member_added': { one: 'added a project member', many: 'added {n} project members' },
  'project.member_changed': { one: 'changed a project member\'s access', many: 'changed {n} project members\' access' },
  'project.member_removed': { one: 'removed a project member', many: 'removed {n} project members' },
  'share.created': { one: 'created a share link', many: 'created {n} share links' },
  'share.revoked': { one: 'revoked a share link', many: 'revoked {n} share links' },
  'song.created': { one: 'added a song', many: 'added {n} songs' },
  'song.stage_changed': { one: 'moved a song to a new stage', many: 'moved {n} songs to new stages' },
  'song.reviewed': { one: 'reviewed a song', many: 'reviewed {n} songs' },
  'recording.uploaded': { one: 'uploaded a recording', many: 'uploaded {n} recordings' },
  'recording.downloaded': { one: 'downloaded a recording', many: 'downloaded {n} recordings' },
  'recording.copied': { one: 'copied a recording', many: 'copied {n} recordings' },
  'comment.created': { one: 'left a comment', many: 'left {n} comments' },
  'comment.updated': { one: 'edited a comment', many: 'edited {n} comments' },
  'comment.resolved': { one: 'resolved a comment thread', many: 'resolved {n} comment threads' },
  'comment.deleted': { one: 'deleted a comment', many: 'deleted {n} comments' },
  'task.created': { one: 'added a task', many: 'added {n} tasks' },
  'task.updated': { one: 'updated a task', many: 'updated {n} tasks' },
  'task.completed': { one: 'completed a task', many: 'completed {n} tasks' },
  'task.deleted': { one: 'removed a task', many: 'removed {n} tasks' },
  'direction.updated': { one: 'updated the creative direction', many: 'updated the creative direction {n} times' },
  'reference.added': { one: 'added a reference', many: 'added {n} references' },
  'reference.updated': { one: 'edited a reference', many: 'edited {n} references' },
  'reference.removed': { one: 'removed a reference', many: 'removed {n} references' },
  'file.uploaded': { one: 'added a file', many: 'added {n} files' },
  'file.updated': { one: 'edited a file', many: 'edited {n} files' },
  'file.deleted': { one: 'removed a file', many: 'removed {n} files' },
  'file.restricted_downloaded': { one: 'downloaded a restricted file', many: 'downloaded {n} restricted files' },
  'credit.proposed': { one: 'proposed a credit', many: 'proposed {n} credits' },
  'credit.confirmed': { one: 'confirmed a credit', many: 'confirmed {n} credits' },
  'credit.disputed': { one: 'disputed a credit', many: 'disputed {n} credits' },
  'split_sheet.circulated': { one: 'circulated a split sheet', many: 'circulated {n} split sheets' },
  'approval.requested': { one: 'asked for an approval', many: 'asked for {n} approvals' },
  'approval.decided': { one: 'decided an approval', many: 'decided {n} approvals' },
  'release.created': { one: 'created a release', many: 'created {n} releases' },
  'release.updated': { one: 'updated a release', many: 'updated {n} releases' },
  'release.deleted': { one: 'deleted a release', many: 'deleted {n} releases' },
  'release.delivered': { one: 'delivered a release', many: 'delivered {n} releases' },
  'connection.requested': { one: 'asked to connect', many: 'asked to connect {n} times' },
  'connection.accepted': { one: 'accepted a connection', many: 'accepted {n} connections' },
  'connection.ended': { one: 'ended a connection', many: 'ended {n} connections' },
};

function quoted(title: string | null): string | null {
  return title ? `‘${title}’` : null;
}

function describeRelease(part: Extract<DigestPart, { kind: 'release' }>, names: DigestNames): string {
  const title = quoted((part.releaseId ? names.releases[part.releaseId] : undefined) ?? part.title);
  const the = (verb: string) => (title ? `${verb} the release ${title}` : `${verb} a release`);
  if (part.deleted) return the('deleted');
  if (part.created) return the('created');
  if (part.delivered) return the('delivered');
  if (part.cancelled) return title ? `cancelled ${title}` : 'cancelled a release';
  if (part.tracklist > 0 && part.edited === 0) return `edited the tracklist of ${title ?? 'a release'}`;
  if (part.tracklist > 0) return `updated ${title ?? 'a release'} and its tracklist`;
  return `updated ${title ?? 'a release'}`;
}

function describeStage(part: Extract<DigestPart, { kind: 'stage' }>, names: DigestNames): string {
  const title = part.songId ? names.songs?.[part.songId] : undefined;
  const to = (SONG_STAGE_LABEL as Record<string, string>)[part.to] ?? part.to;
  return `moved ${title ?? 'a song'} to ${to}`;
}

function describeReview(part: Extract<DigestPart, { kind: 'review' }>, names: DigestNames): string {
  const title = part.songId ? names.songs?.[part.songId] : undefined;
  const given = [
    part.rating !== null ? `${part.rating} of 5` : null,
    part.verdict && isReviewVerdict(part.verdict) ? REVIEW_VERDICT_LABEL[part.verdict] : null,
  ].filter((w): w is string => w !== null);
  return `reviewed ${title ?? 'a song'}${given.length > 0 ? `: ${given.join(', ')}` : ''}`;
}

export function describePart(part: DigestPart, names: DigestNames): string {
  if (part.kind === 'release') return describeRelease(part, names);
  if (part.kind === 'review') return describeReview(part, names);
  if (part.kind === 'stage') return describeStage(part, names);
  if (part.verb === 'song.created' && part.demos !== undefined && part.demos > 0 && part.demos === part.count) {
    return part.count === 1 ? 'added a demo' : `added ${part.count} demos`;
  }
  const phrase = (VERB_PHRASES as Record<string, { one: string; many: string } | undefined>)[part.verb];
  if (!phrase) return `did ${part.verb.replace(/[._]/g, ' ')}`;
  return part.count === 1 ? phrase.one : phrase.many.replace('{n}', String(part.count));
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "Sam" + "added 3 demos, created a project and added a file". No profile reads as a neutral word, never an id or an email. */
export function describeLine(l: DigestLine, names: DigestNames): { actor: string; text: string } {
  const actor = l.actorId === null ? 'Someone' : names.actors[l.actorId] ?? 'A team member';
  return { actor, text: joinWords(l.parts.map((p) => describePart(p, names))) };
}
