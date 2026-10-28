/**
 * Released → store bridge (LABEL-42, 14 §LABEL-42, D8). Pure: the routes load
 * rows and write through the service role; this module decides.
 *
 *  - WHAT counts as released. A release is released when it was IMPORTED as
 *    already out (`imported_released`), or it was delivered and has a release
 *    date that is today or earlier (no release date = not out; target_date
 *    never counts). Migration 144's CHECK
 *    (`releases_store_listed_released`) is the looser SQL twin: it admits a
 *    delivered release with a future date. The storefront is stricter on
 *    purpose — D8 keeps a preview private until the music is out, and a
 *    delivered album with a street date next month is not out.
 *  - WHO may list. Only releases of the org the current store owner stands
 *    behind: their personal PRODUCER org, or an ARTIST org connected (LABEL-41)
 *    to a label org they own. Label- and artist-owned stores are Phase 8.
 *  - WHAT unlisting removes. The release leaves the store. Its promoted public
 *    previews are deleted only if the music was never publicly out
 *    (`releasedPublicly` false) AND the owner said so — the owner is asked
 *    only then, so a question is never put whose answer changes nothing.
 *  - WHAT a visitor receives. `publicReleaseView` builds the JSON field by
 *    field: no org id, no track id of the org, no storage reference, no
 *    creator ids. The item id is the public handle of a playable track.
 */
import { isUUID } from '@/lib/validate';
import { planConsentGate, type ConsentRow } from './store-consent';

export const STORE_PLAYBACKS = ['preview', 'full'] as const;
export type StorePlayback = (typeof STORE_PLAYBACKS)[number];

export function isStorePlayback(v: unknown): v is StorePlayback {
  return typeof v === 'string' && (STORE_PLAYBACKS as readonly string[]).includes(v);
}

/** The facts about a release this module reads. */
export interface ListingFacts {
  state: string;
  imported_released: boolean;
  /** `YYYY-MM-DD` or null. */
  release_date: string | null;
  store_listed: boolean;
  /** When it went on the store (null if never); read only by `releasedPublicly`. */
  store_listed_at?: string | null;
}

/** `YYYY-MM-DD` of `now` in UTC — the unit release dates are kept in. */
export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Released: imported as already out, or delivered with a date that has come (or none). Cancelled, draft and
 * WITHDRAWN (LABEL-56: pulled back after delivery, even one entered as already out): never.
 */
export function isReleasedForStore(r: Pick<ListingFacts, 'state' | 'imported_released' | 'release_date'>, now: Date): boolean {
  if (r.state === 'cancelled' || r.state === 'withdrawn') return false;
  if (r.imported_released) return true;
  if (r.state !== 'delivered') return false;
  // A date that has come, and only a RELEASE date: a target date is a plan, never "out", and a delivery
  // with no release date at all has not said when it comes out (readiness accepts a target date alone).
  return r.release_date !== null && r.release_date <= todayUtc(now);
}

/**
 * May this release be on the store at all — as a TEASER? (LABEL-72.) A delivered release is on its way out, so
 * its preview clips may be listed before the release date (and with no date yet); the whole songs wait for the
 * date (`effectivePlayback`). A draft, cancelled or withdrawn release is never on the store.
 */
export function canListOnStore(r: Pick<ListingFacts, 'state' | 'imported_released'>): boolean {
  if (r.state === 'cancelled' || r.state === 'withdrawn') return false;
  return r.imported_released || r.state === 'delivered';
}

/**
 * How a visitor hears a listed release RIGHT NOW. `full` is only ever the stored choice AND a release date that
 * has come: it is derived on every read, so a date that is stated later (or a release that is withdrawn) turns the
 * release back into `preview` by itself — nothing is stored on the way down, and nothing needs to be undone when
 * the date comes. Imported releases are released by definition.
 */
export function effectivePlayback(
  stored: StorePlayback,
  r: Pick<ListingFacts, 'state' | 'imported_released' | 'release_date'>,
  now: Date,
): StorePlayback {
  return stored === 'full' && isReleasedForStore(r, now) ? 'full' : 'preview';
}

/**
 * Has the music EVER been publicly out? Conservative on purpose — this decides
 * whether unlisting may offer to delete promoted previews, and a wrong "no" is
 * the harmful answer. It is true when the release is released NOW, and also
 * when it was listed at a time it was released (listing requires released, so
 * any `store_listed_at` on a release whose date had come by then counts).
 * Only a release that is neither — in practice a delivered one whose date was
 * pushed out after listing, which the date lock now forbids — is "never out".
 */
export function releasedPublicly(r: Pick<ListingFacts, 'state' | 'imported_released' | 'release_date' | 'store_listed_at'>, now: Date): boolean {
  if (isReleasedForStore(r, now)) return true;
  if (r.store_listed_at && !Number.isNaN(Date.parse(r.store_listed_at))) {
    return isReleasedForStore({ ...r, state: r.state === 'cancelled' || r.state === 'withdrawn' ? 'delivered' : r.state }, new Date(r.store_listed_at));
  }
  return false;
}

/** An org that may put releases on the store of this owner. */
export interface StoreOwnerOrgs {
  /** The store owner's personal producer org (kind `producer`, they are its owner). */
  producerOrgId: string | null;
  /** Artist orgs with an ACTIVE connection to a label org the store owner owns. */
  connectedArtistOrgIds: readonly string[];
}

export function orgMayListOnStore(orgId: string, owner: StoreOwnerOrgs): boolean {
  const id = orgId.toLowerCase();
  if (owner.producerOrgId && owner.producerOrgId.toLowerCase() === id) return true;
  return owner.connectedArtistOrgIds.some((o) => o.toLowerCase() === id);
}

export type ListingProblem = { ok: false; status: 404 | 409 | 400; error: string; field?: string };

export type ListPlan =
  | {
      ok: true;
      /** What is stored on the release. */
      playback: StorePlayback;
      /** What a visitor hears now (`effectivePlayback`): `full` only once the release date has come. */
      effective: StorePlayback;
      alreadyListed: boolean;
    }
  | ListingProblem;

export interface ListInput {
  release: ListingFacts;
  itemCount: number;
  orgId: string;
  owner: StoreOwnerOrgs | null;
  /** Items whose recording is not finished music (D4): any one blocks the listing and is named. */
  blockedItems?: readonly { id: string; title: string }[];
  /** Requested playback; omitted keeps the release's current one. */
  playback?: StorePlayback;
  currentPlayback: StorePlayback;
  /**
   * Artist consent rows of the release (LABEL-71; absent before migration 186 = no rows). Any `no` blocks the
   * listing until that artist says yes; so does the store owner's veto.
   */
  consent?: readonly ConsentRow[];
  vetoed?: boolean;
}

/** Can this release go on the store, and with what playback? */
export function planList(input: ListInput, now: Date): ListPlan {
  const { release } = input;
  if (!input.owner || !orgMayListOnStore(input.orgId, input.owner)) {
    return {
      ok: false,
      status: 409,
      error: "Only releases of the store owner's studio, or of an artist connected to it, can be listed",
      field: 'org',
    };
  }
  if (release.state === 'cancelled') return { ok: false, status: 409, error: 'A cancelled release cannot be listed', field: 'state' };
  if (release.state === 'withdrawn') return { ok: false, status: 409, error: 'A withdrawn release cannot be listed', field: 'state' };
  if (!canListOnStore(release)) {
    return { ok: false, status: 409, error: 'Only a delivered or released release can be listed', field: 'state' };
  }
  // LABEL-72: before the release date a delivered release may be listed as a TEASER (preview clips only).
  // Whole songs are chosen from the date on; a stored `full` that meets a later date simply reads as preview.
  if (input.playback === 'full' && !isReleasedForStore(release, now)) {
    return {
      ok: false,
      status: 409,
      error: 'Full songs can be chosen from the release date; until then visitors hear preview clips',
      field: 'playback',
    };
  }
  if (input.blockedItems && input.blockedItems.length > 0) {
    const names = input.blockedItems.map((i) => `“${i.title}”`).join(', ');
    return {
      ok: false,
      status: 409,
      error: `${names} ${input.blockedItems.length === 1 ? 'is' : 'are'} not finished music yet (a demo or work in progress), so ${input.blockedItems.length === 1 ? 'it' : 'they'} cannot go on the store`,
      field: 'items',
    };
  }
  if (input.itemCount === 0) return { ok: false, status: 409, error: 'Add the songs of the release before listing it', field: 'items' };
  const consent = planConsentGate(input.consent ?? [], input.vetoed === true);
  if (!consent.ok) return consent;
  const playback = input.playback ?? input.currentPlayback;
  return { ok: true, playback, effective: effectivePlayback(playback, release, now), alreadyListed: release.store_listed };
}

export type UnlistPlan =
  | { ok: true; deletePreviews: boolean; askToDeletePreviews: boolean }
  | ListingProblem;

/**
 * Unlisting. `askToDeletePreviews` says whether the owner has a choice at
 * all (the music was never publicly out); `deletePreviews` is that choice
 * honoured — never true for music that was released publicly.
 */
export function planUnlist(release: ListingFacts, wantsDelete: boolean, now: Date): UnlistPlan {
  if (!release.store_listed) return { ok: false, status: 409, error: 'This release is not on the store', field: 'store_listed' };
  const ask = !releasedPublicly(release, now);
  return { ok: true, askToDeletePreviews: ask, deletePreviews: ask && wantsDelete };
}

/** Should the public store show this release right now? Listed AND still deliverable (a teaser counts). */
export function isPubliclyVisible(r: ListingFacts, _now?: Date): boolean {
  return r.store_listed && canListOnStore(r);
}

/**
 * Where an item's promoted preview lives in the PUBLIC bucket. Both parts are
 * validated UUIDs, so a key is never built from free text; the extension is
 * left off — the object carries its own content type.
 */
export function publicPreviewKey(releaseId: string, masterTrackId: string): string | null {
  if (!isUUID(releaseId) || !isUUID(masterTrackId)) return null;
  return `store-releases/${releaseId.toLowerCase()}/${masterTrackId.toLowerCase()}`;
}

/** The prefix everything promoted for one release shares (for deletion). */
export function publicReleasePrefix(releaseId: string): string | null {
  return isUUID(releaseId) ? `store-releases/${releaseId.toLowerCase()}/` : null;
}

/**
 * How one item of a listed release is streamed to a visitor. There is NO plan that names the master (LABEL-72):
 * preview mode streams the promoted copy in the public bucket, full mode streams the private lossy full-length
 * derivative of the master through the server. A master's reference never reaches a public route.
 */
export type PublicStreamPlan =
  | { kind: 'public-preview'; key: string }
  | { kind: 'private-derivative'; orgId: string; masterTrackId: string }
  | null;

/** `playback` is the EFFECTIVE playback (`effectivePlayback`), never the stored one. */
export function publicStreamPlan(
  playback: StorePlayback,
  releaseId: string,
  item: { master_track_id: string },
  orgId: string,
): PublicStreamPlan {
  if (playback === 'full') return isUUID(orgId) && isUUID(item.master_track_id) ? { kind: 'private-derivative', orgId: orgId.toLowerCase(), masterTrackId: item.master_track_id.toLowerCase() } : null;
  const key = publicPreviewKey(releaseId, item.master_track_id);
  return key ? { kind: 'public-preview', key } : null;
}

/* ── What a visitor receives ─────────────────────────────────────────── */

export interface PublicReleaseRow {
  id: string;
  title: string;
  type: string;
  label_name: string | null;
  primary_genre: string | null;
  release_date: string | null;
  imported_released: boolean;
  store_listed_at: string | null;
  store_playback: StorePlayback;
  has_artwork: boolean;
  artist_name: string | null;
}

export interface PublicReleaseItemRow {
  id: string;
  position: number;
  title: string;
  version_title: string | null;
  explicit: boolean;
  duration_seconds: number | null;
}

export interface PublicReleaseTrack {
  id: string;
  title: string;
  type: 'song';
  /** Same-origin stream URL; never a storage reference. */
  audio_url: string;
  peaks_url: null;
  preview_url: null;
  wav_url: null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: null;
  key: null;
  scale: null;
  explicit: boolean;
  position: number;
}

export const publicReleaseAudioUrl = (releaseId: string, itemId: string) =>
  `/api/store/releases/${encodeURIComponent(releaseId)}/audio/${encodeURIComponent(itemId)}`;
export const publicReleaseCoverUrl = (releaseId: string) => `/api/store/releases/${encodeURIComponent(releaseId)}/cover`;

/** A tile on /store. */
export function publicReleaseTile(r: PublicReleaseRow, trackCount: number) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    artist: r.artist_name,
    label_name: r.label_name,
    primary_genre: r.primary_genre,
    release_date: r.release_date,
    already_out: r.imported_released,
    cover_url: r.has_artwork ? publicReleaseCoverUrl(r.id) : null,
    track_count: trackCount,
  };
}

/** The release page: the tile, the playback mode and the playable tracklist. */
export function publicReleaseView(r: PublicReleaseRow, items: readonly PublicReleaseItemRow[]) {
  const cover = r.has_artwork ? publicReleaseCoverUrl(r.id) : null;
  const tracks: PublicReleaseTrack[] = [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      id: i.id,
      title: i.version_title?.trim() ? `${i.title} (${i.version_title.trim()})` : i.title,
      type: 'song',
      audio_url: publicReleaseAudioUrl(r.id, i.id),
      peaks_url: null,
      preview_url: null,
      wav_url: null,
      cover_url: cover,
      duration_seconds: i.duration_seconds,
      bpm: null,
      key: null,
      scale: null,
      explicit: i.explicit,
      position: i.position,
    }));
  return { release: { ...publicReleaseTile(r, tracks.length), playback: r.store_playback }, tracks };
}

/**
 * Insert into a bounded insertion-ordered cache: the key is refreshed, and
 * when the cache is full the OLDEST entries go (one at a time), never the
 * whole map — so a flood of new keys cannot flush entries that are in use all
 * at once. Returns the number of entries evicted.
 */
export function boundedPut<K, V>(cache: Map<K, V>, key: K, value: V, max: number): number {
  cache.delete(key);
  let evicted = 0;
  while (cache.size >= max) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
    evicted += 1;
  }
  cache.set(key, value);
  return evicted;
}
