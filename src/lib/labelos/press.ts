/**
 * PR and press (LABEL-66). Pure: the vocabulary, who may do what, the embargo
 * rule, the share token, the outreach stamps and the PUBLIC view of a kit. The
 * database reads are `press-store.ts`; the member routes are under
 * `/api/org/[orgId]/releases/[releaseId]/press`, the public ones under
 * `/api/press/[token]`.
 *
 * Decisions (flagged in the PR):
 *  - READ the kit and outreach: `pr.read`; WRITE: `pr.write` (the `pr` function
 *    holds it; owner and admin have both), on top of `catalog.read` + the
 *    release's artist scope. A role-`artist` member has neither the kit nor the
 *    tracker: press is the label's business side, and the artist sees the
 *    published result like anyone else. The OUTREACH tracker also needs the
 *    whole-org view (press contacts are directory people, which an artists-scoped
 *    member's directory read does not include).
 *  - The public page is built FIELD BY FIELD by `publicPressView`. It is never
 *    given a row, and it has no key for an internal note, a budget, another
 *    contact, an org id or a storage reference.
 *  - EMBARGO: until `embargo_at` the page is `embargoed` and carries exactly
 *    the title, the artist, the line the label wrote for that moment and the
 *    photos marked `pre_embargo`. No date, no tracklist, no bio, no audio. The
 *    lift moment itself is not shown either. It is decided per request.
 *  - AUDIO: only a RELEASED release (`isReleasedForStore`) that is also on the
 *    public store, through the store's own same-origin stream URLs (the preview
 *    clip or the full-playback derivative under the store's rules). Never the
 *    master, never an org key, never anything for unreleased music.
 *  - `opened` in the tracker is set by hand: this module sends no mail, so
 *    there is no signal to read it from. The page counts its own views per link.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Capability } from './capabilities';
import { isReleasedForStore } from './store-listing';

export const PRESS_LIMITS = { headline: 140, bio: 3000, note: 200, label: 60, caption: 120, url: 500, links: 10, photos: 12, shares: 25 } as const;

// ── Who may do what ───────────────────────────────────────────────────────

export const mayReadPress = (caps: ReadonlySet<Capability | string>, role: string): boolean => role !== 'artist' && caps.has('pr.read');
export const mayWritePress = (caps: ReadonlySet<Capability | string>, role: string): boolean => role !== 'artist' && caps.has('pr.write');
/** Press contacts are directory people; a member limited to some artists does not read the directory's other people. */
export const mayUseOutreach = (artistScope: readonly string[] | null | undefined): boolean => artistScope === null || artistScope === undefined;

// ── Links ─────────────────────────────────────────────────────────────────

/** https only, no whitespace, a host, no credentials, bounded. Returns the normalised URL or null. */
export function cleanHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length === 0 || v.length > PRESS_LIMITS.url || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    const out = u.toString();
    return out.length <= PRESS_LIMITS.url ? out : null;
  } catch {
    return null;
  }
}

// ── Embargo ───────────────────────────────────────────────────────────────

export type EmbargoState = 'none' | 'active' | 'lifted';

/** `active` strictly before the moment; a missing or unreadable date is no embargo at all (the owner screen refuses to save one). */
export function embargoState(embargoAt: string | null | undefined, now: Date): EmbargoState {
  if (!embargoAt) return 'none';
  const t = Date.parse(embargoAt);
  if (Number.isNaN(t)) return 'none';
  return now.getTime() < t ? 'active' : 'lifted';
}

// ── Share token ───────────────────────────────────────────────────────────

export const newPressToken = (): string => randomBytes(32).toString('base64url');
export const isWellFormedPressToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
export const hashPressToken = (token: string): string => createHash('sha256').update(`label-os.press-kit.v1\0${token}`).digest('hex');

/** A grant answers only while it is neither revoked nor expired. */
export function shareUsable(share: { revoked_at: string | null; expires_at: string | null }, now: Date): boolean {
  if (share.revoked_at) return false;
  if (share.expires_at) {
    const t = Date.parse(share.expires_at);
    if (Number.isNaN(t) || t <= now.getTime()) return false;
  }
  return true;
}

// ── Outreach ──────────────────────────────────────────────────────────────

export type OutreachStage = 'planned' | 'sent' | 'opened' | 'replied';
export type OutreachStamps = { sent_at: string | null; opened_at: string | null; replied_at: string | null; coverage_url?: string | null };

/** The furthest step reached. Coverage is a separate fact, shown beside the stage. */
export function outreachStage(o: Pick<OutreachStamps, 'sent_at' | 'opened_at' | 'replied_at'>): OutreachStage {
  if (o.replied_at) return 'replied';
  if (o.opened_at) return 'opened';
  if (o.sent_at) return 'sent';
  return 'planned';
}

export type OutreachChange = { sent?: boolean; opened?: boolean; replied?: boolean; coverage_url?: string | null };

/**
 * The columns to write for a change. Setting a step stamps `now` once (a repeat keeps the first time); clearing a
 * step clears it AND the steps after it, so a row never says "replied" without "sent". Replying or opening implies
 * having sent: it stamps `sent_at` if it was empty.
 */
export function applyOutreachChange(current: OutreachStamps, change: OutreachChange, now: Date): Partial<OutreachStamps> {
  const stamp = now.toISOString();
  let { sent_at, opened_at, replied_at } = current;
  if (change.replied === true) {
    sent_at = sent_at ?? stamp;
    replied_at = replied_at ?? stamp;
  }
  if (change.opened === true) {
    sent_at = sent_at ?? stamp;
    opened_at = opened_at ?? stamp;
  }
  if (change.sent === true) sent_at = sent_at ?? stamp;
  if (change.replied === false) replied_at = null;
  if (change.opened === false) {
    opened_at = null;
    replied_at = null;
  }
  if (change.sent === false) {
    sent_at = null;
    opened_at = null;
    replied_at = null;
  }
  const out: Partial<OutreachStamps> = {};
  if (sent_at !== current.sent_at) out.sent_at = sent_at;
  if (opened_at !== current.opened_at) out.opened_at = opened_at;
  if (replied_at !== current.replied_at) out.replied_at = replied_at;
  if (change.coverage_url !== undefined && change.coverage_url !== (current.coverage_url ?? null)) out.coverage_url = change.coverage_url;
  return out;
}

// ── The PUBLIC view ───────────────────────────────────────────────────────

export type PressReleaseFacts = {
  title: string;
  type: string;
  label_name: string | null;
  primary_genre: string | null;
  release_date: string | null;
  state: string;
  imported_released: boolean;
};

export type PressKitFacts = {
  headline: string | null;
  bio: string | null;
  pre_embargo_note: string | null;
  embargo_at: string | null;
};

export type PressPhotoFacts = { id: string; caption: string | null; pre_embargo: boolean; position: number };
export type PressLinkFacts = { label: string; url: string; position: number };
export type PressTrackFacts = { position: number; title: string; version_title: string | null; explicit: boolean };
/** What the store's own public release view says is playable; absent unless the release is on the store. */
export type PressListenFacts = { id: string; title: string; audio_url: string; duration_seconds: number | null };

export type PressPublicPhoto = { id: string; url: string; caption: string | null };
export type PublicPressView =
  | { state: 'embargoed'; title: string; artist: string | null; note: string | null; photos: PressPublicPhoto[] }
  | {
      state: 'live';
      title: string;
      artist: string | null;
      type: string;
      label: string | null;
      genre: string | null;
      releaseDate: string | null;
      released: boolean;
      headline: string | null;
      bio: string | null;
      links: { label: string; url: string }[];
      photos: PressPublicPhoto[];
      tracklist: { position: number; title: string; explicit: boolean }[];
      listen: { tracks: { id: string; title: string; audioUrl: string; durationSeconds: number | null }[] } | null;
    };

/** A same-origin store stream and nothing else: the only audio reference the page may carry. */
export const isStoreStreamUrl = (u: string): boolean => /^\/api\/store\/releases\/[0-9a-f-]{36}\/audio\/[0-9a-f-]{36}$/i.test(u);

const photoUrl = (token: string, photoId: string) => `/api/press/${token}/assets/${photoId}`;
const text = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The page for a visitor holding `token`. `listen` is whatever the STORE would play for this release right now
 * (already filtered by its own rules); it is used only when the release is released.
 */
export function publicPressView(input: {
  token: string;
  now: Date;
  kit: PressKitFacts;
  release: PressReleaseFacts;
  artist: string | null;
  photos: readonly PressPhotoFacts[];
  links: readonly PressLinkFacts[];
  tracks: readonly PressTrackFacts[];
  listen: readonly PressListenFacts[] | null;
}): PublicPressView {
  const { token, now, kit, release } = input;
  const byPosition = <T extends { position: number }>(xs: readonly T[]) => [...xs].sort((a, b) => a.position - b.position);
  const photoOf = (p: PressPhotoFacts): PressPublicPhoto => ({ id: p.id, url: photoUrl(token, p.id), caption: text(p.caption) });

  if (embargoState(kit.embargo_at, now) === 'active') {
    return {
      state: 'embargoed',
      title: release.title,
      artist: text(input.artist),
      note: text(kit.pre_embargo_note),
      photos: byPosition(input.photos.filter((p) => p.pre_embargo)).map(photoOf),
    };
  }

  const released = isReleasedForStore(release, now);
  const listen =
    released && input.listen && input.listen.length > 0
      ? {
          tracks: input.listen
            .filter((t) => isStoreStreamUrl(t.audio_url))
            .map((t) => ({ id: t.id, title: t.title, audioUrl: t.audio_url, durationSeconds: t.duration_seconds })),
        }
      : null;
  return {
    state: 'live',
    title: release.title,
    artist: text(input.artist),
    type: release.type,
    label: text(release.label_name),
    genre: text(release.primary_genre),
    releaseDate: release.release_date,
    released,
    headline: text(kit.headline),
    bio: text(kit.bio),
    links: byPosition(input.links).map((l) => ({ label: l.label, url: l.url })),
    photos: byPosition(input.photos).map(photoOf),
    tracklist: byPosition(input.tracks).map((t) => ({
      position: t.position,
      title: t.version_title?.trim() ? `${t.title} (${t.version_title.trim()})` : t.title,
      explicit: t.explicit,
    })),
    listen: listen && listen.tracks.length > 0 ? listen : null,
  };
}

/** May this photo be streamed on this request? (The embargo hides every photo not marked for it.) */
export function photoVisible(photo: Pick<PressPhotoFacts, 'pre_embargo'>, embargoAt: string | null, now: Date): boolean {
  return embargoState(embargoAt, now) !== 'active' || photo.pre_embargo;
}

/** The release can be shown publicly at all: a cancelled or withdrawn one is gone. */
export const releasePublishable = (state: string): boolean => state !== 'cancelled' && state !== 'withdrawn';

/** Plain-text one-sheet of a kit, for a copy button: the same words the live page shows, nothing the page does not. */
export function oneSheetText(view: Extract<PublicPressView, { state: 'live' }>): string {
  const lines: string[] = [];
  lines.push(view.artist ? `${view.artist} — ${view.title}` : view.title);
  const meta = [view.type, view.label, view.genre, view.releaseDate].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (view.headline) lines.push('', view.headline);
  if (view.bio) lines.push('', view.bio);
  if (view.tracklist.length > 0) {
    lines.push('', 'Tracklist');
    for (const t of view.tracklist) lines.push(`${t.position}. ${t.title}${t.explicit ? ' (explicit)' : ''}`);
  }
  if (view.links.length > 0) {
    lines.push('', 'Links');
    for (const l of view.links) lines.push(`${l.label}: ${l.url}`);
  }
  return lines.join('\n');
}
