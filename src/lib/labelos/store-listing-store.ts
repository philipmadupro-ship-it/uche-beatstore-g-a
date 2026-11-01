/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server reads for the released → store bridge (LABEL-42). The rules are the
 * pure `store-listing`; this module loads the rows they judge. Everything is
 * read with the service role by id and org — the routes above it decide who
 * may ask.
 *
 * Two audiences:
 *  - the org routes (`/api/org/[orgId]/releases/[id]/store`) load the facts a
 *    member's list / unlist needs (`loadListingContext`);
 *  - the PUBLIC routes (`/api/store/releases/**`) load what a visitor may see
 *    (`loadPublicRelease`, `loadPublicReleaseList`): a release only while it is
 *    listed, still released, and still the store owner's (or a connected
 *    artist's) — re-checked on every request, so an owner change or an ended
 *    connection takes it off the store without anyone unlisting it.
 */
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { resolveStoreOwner } from '@/lib/store/owner';
import { refusalsAndVetoes } from './store-consent-store';
import { orgTrackReadClass, type InboundLink } from './org-read';
import {
  boundedPut,
  effectivePlayback,
  isPubliclyVisible,
  isReleasedForStore,
  isStorePlayback,
  orgMayListOnStore,
  type ListingFacts,
  type PublicReleaseItemRow,
  type PublicReleaseRow,
  type StoreOwnerOrgs,
  type StorePlayback,
} from './store-listing';

const LISTING_COLUMNS = 'id, org_id, project_id, contact_id, title, type, label_name, primary_genre, release_date, artwork_asset_id, state, imported_released, store_listed, store_listed_at';

const PUBLIC_COLUMNS = `${LISTING_COLUMNS}, store_playback`;

/**
 * The public routes read a release WITH its playback in one select. Before
 * migration 158 the column does not exist: retry without it (everything then
 * plays as a preview), and let a missing table fall out as the caller's usual
 * "nothing there".
 */
async function selectPublic(admin: any, apply: (q: any) => any): Promise<{ data: any; error: any }> {
  const first = await apply(admin.from('releases').select(PUBLIC_COLUMNS));
  if (!first.error || !isMissingSchema(first.error)) return first;
  return apply(admin.from('releases').select(LISTING_COLUMNS));
}

/** Finished-music items only — what a visitor may ever be shown or played. */
export const listableItems = (items: readonly ListingItem[]) => items.filter((i) => i.master_class === 'finished');
export const blockedItems = (items: readonly ListingItem[]) => items.filter((i) => i.master_class !== 'finished').map((i) => ({ id: i.id, title: i.title }));

export type ListingRelease = ListingFacts & {
  store_playback?: string | null;
  id: string;
  org_id: string;
  project_id: string;
  contact_id: string;
  title: string;
  type: string;
  label_name: string | null;
  primary_genre: string | null;
  artwork_asset_id: string | null;
  store_listed_at: string | null;
};

/** The orgs the store's owner stands behind, or null when there is no store owner. */
export async function loadStoreOwnerOrgs(admin: any): Promise<StoreOwnerOrgs | null> {
  const owner = await resolveStoreOwner(admin);
  if (!owner) return null;
  const { data: seats, error } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', owner.user_id)
    .eq('role', 'owner');
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  const orgIds = ((seats ?? []) as { org_id: string }[]).map((s) => s.org_id);
  if (orgIds.length === 0) return { producerOrgId: null, connectedArtistOrgIds: [] };

  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, kind, created_at')
    .in('id', orgIds)
    .is('deleted_at', null);
  if (orgErr) throw new Error(orgErr.message);
  const rows = (orgs ?? []) as { id: string; kind: string; created_at?: string }[];
  // A producer has one personal org; if a transfer left several, the oldest is the studio.
  const producer = rows.filter((o) => o.kind === 'producer').sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0];
  const labels = rows.filter((o) => o.kind === 'label').map((o) => o.id);

  let connected: string[] = [];
  if (labels.length > 0) {
    const { data: links, error: linkErr } = await admin
      .from('org_connections')
      .select('artist_org_id')
      .in('label_org_id', labels)
      .eq('status', 'active');
    if (linkErr) {
      if (!isMissingSchema(linkErr)) throw new Error(linkErr.message);
    } else {
      const ids = [...new Set(((links ?? []) as { artist_org_id: string }[]).map((l) => l.artist_org_id))];
      if (ids.length > 0) {
        // An artist org that was deleted is not connected to anything any more.
        const { data: live } = await admin.from('organizations').select('id').in('id', ids).is('deleted_at', null);
        connected = ((live ?? []) as { id: string }[]).map((o) => o.id);
      }
    }
  }
  return { producerOrgId: producer?.id ?? null, connectedArtistOrgIds: connected };
}

/**
 * The public routes re-check the store owner's side on every request, and a
 * `full`-mode player makes one request per Range. The answer (two or three
 * small reads) is kept in-process for a short while; `store_listed`, the
 * release's state/date and each item are still read fresh every time. Ending a
 * connection or changing the owner therefore takes effect within the TTL.
 */
export const STORE_OWNER_CACHE_MS = 30_000;
let ownerCache: { at: number; value: StoreOwnerOrgs | null } | null = null;
export function resetStoreOwnerCache(): void {
  ownerCache = null;
  itemsCache.clear();
}
async function cachedStoreOwnerOrgs(admin: any): Promise<StoreOwnerOrgs | null> {
  const now = Date.now();
  if (ownerCache && now - ownerCache.at < STORE_OWNER_CACHE_MS) return ownerCache.value;
  const value = await loadStoreOwnerOrgs(admin);
  ownerCache = { at: now, value };
  return value;
}

/** `store_playback` of a release; 'preview' before migration 158 (`schemaReady` false). */
export async function readPlayback(admin: any, releaseId: string): Promise<{ playback: StorePlayback; schemaReady: boolean }> {
  const { data, error } = await admin.from('releases').select('store_playback').eq('id', releaseId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { playback: 'preview', schemaReady: false };
    throw new Error(error.message);
  }
  const v = (data as { store_playback?: unknown } | null)?.store_playback;
  return { playback: isStorePlayback(v) ? v : 'preview', schemaReady: true };
}

export type ListingItem = {
  id: string;
  position: number;
  song_track_id: string;
  master_track_id: string;
  title: string;
  version_title: string | null;
  explicit: boolean;
  duration_seconds: number | null;
  /** Stored references: server-side only, never in a response. */
  master_audio_ref: string | null;
  master_preview_ref: string | null;
  /**
   * D4 class of the item's recording: only `finished` music may be public.
   * Judged from the recording's inbound links and its song's stage, never
   * from "it is on a release" (that would make the rule vouch for itself).
   */
  master_class: 'finished' | 'working';
};

const IN_CHUNK = 100;
const PAGE_ROWS = 1000;
const MAX_PAGES = 50;

/**
 * `select … where column in (ids)` that never silently truncates: ids go in chunks of at most 100 (URL
 * length), and each chunk is paged (PostgREST caps a response at about 1000 rows), in a fixed order so
 * the pages do not overlap. `extra` adds filters; the first error is returned with what was read.
 */
async function selectChunked(
  admin: any,
  table: string,
  columns: string,
  column: string,
  ids: readonly string[],
  orderBy: readonly string[],
  extra?: (q: any) => any,
): Promise<{ data: any[]; error: any }> {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let q = admin.from(table).select(columns).in(column, chunk);
      if (extra) q = extra(q);
      for (const col of orderBy) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(page * PAGE_ROWS, page * PAGE_ROWS + PAGE_ROWS - 1);
      if (error) return { data: rows, error };
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE_ROWS) break;
    }
  }
  return { data: rows, error: null };
}

type ItemRow = { id: string; release_id: string; position: number; song_track_id: string; master_track_id: string; version_title: string | null; explicit: boolean };
type TrackRow = { id: string; org_id: string | null; title: string | null; type: string | null; song_stage: string | null; audio_url: string | null; preview_url: string | null; duration_seconds: number | null };

/**
 * Items of several releases in a fixed number of queries (no per-release
 * reads), grouped by release. A recording is read only if it belongs to the
 * SAME org as the release: an item pointing at another org's track gets no
 * title, no audio and the `working` class.
 */
async function loadItemsFor(admin: any, releases: readonly { id: string; org_id: string }[], onlyItemId?: string): Promise<Map<string, ListingItem[]>> {
  const out = new Map<string, ListingItem[]>();
  if (releases.length === 0) return out;
  const orgOf = new Map(releases.map((r) => [r.id, r.org_id]));
  const { data, error } = await selectChunked(
    admin,
    'release_items',
    'id, release_id, position, song_track_id, master_track_id, version_title, explicit',
    'release_id',
    releases.map((r) => r.id),
    ['release_id', 'position', 'id'],
    onlyItemId ? (q) => q.eq('id', onlyItemId) : undefined,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ItemRow[];
  if (rows.length === 0) return out;
  const trackIds = [...new Set(rows.flatMap((i) => [i.song_track_id, i.master_track_id]))];
  const { data: tracks, error: tErr } = await selectChunked(admin, 'tracks', 'id, org_id, title, type, song_stage, audio_url, preview_url, duration_seconds', 'id', trackIds, ['id']);
  if (tErr) throw new Error(tErr.message);
  const byId = new Map(((tracks ?? []) as TrackRow[]).map((t) => [t.id, t]));
  const inbound = await inboundLinksOf(admin, [...new Set(releases.map((r) => r.org_id))], [...new Set(rows.map((i) => i.master_track_id))]);
  for (const i of rows.sort((a, b) => a.position - b.position)) {
    const org = orgOf.get(i.release_id);
    const own = (t: TrackRow | undefined) => (t && t.org_id === org ? t : undefined);
    const song = own(byId.get(i.song_track_id));
    const master = own(byId.get(i.master_track_id));
    const item: ListingItem = {
      id: i.id,
      position: i.position,
      song_track_id: i.song_track_id,
      master_track_id: i.master_track_id,
      version_title: i.version_title,
      explicit: i.explicit,
      title: song?.title?.trim() || master?.title?.trim() || 'Untitled',
      duration_seconds: master?.duration_seconds ?? song?.duration_seconds ?? null,
      master_audio_ref: master?.audio_url ?? null,
      master_preview_ref: master?.preview_url ?? null,
      master_class: master ? orgTrackReadClass({ type: master.type, song_stage: master.song_stage }, inbound.get(master.id) ?? []) : 'working',
    };
    out.set(i.release_id, [...(out.get(i.release_id) ?? []), item]);
  }
  return out;
}

/** A release's items in order, with the titles and stored references the listing needs. */
export async function loadListingItems(admin: any, orgId: string, releaseId: string, onlyItemId?: string): Promise<ListingItem[]> {
  return (await loadItemsFor(admin, [{ id: releaseId, org_id: orgId }], onlyItemId)).get(releaseId) ?? [];
}

/**
 * One-hop inbound links of each recording, as D4 reads them (lib/labelos/org-audio:
 * `track_links`, `song_beats`, a song's `beat_track_id`), with the type of the track they hang off.
 */
async function inboundLinksOf(admin: any, orgIds: string[], trackIds: string[]): Promise<Map<string, InboundLink[]>> {
  const out = new Map<string, InboundLink[]>();
  if (trackIds.length === 0) return out;
  const raw: { to: string; from: string; relation: string }[] = [];
  const { data: links, error: lErr } = await selectChunked(admin, 'track_links', 'from_track_id, to_track_id, relation', 'to_track_id', trackIds, ['to_track_id', 'from_track_id']);
  if (lErr) throw new Error(lErr.message);
  for (const l of (links ?? []) as { from_track_id: string; to_track_id: string; relation: string }[]) raw.push({ to: l.to_track_id, from: l.from_track_id, relation: l.relation });
  const { data: beats, error: bErr } = await selectChunked(admin, 'song_beats', 'song_track_id, beat_track_id', 'beat_track_id', trackIds, ['beat_track_id', 'song_track_id']);
  if (bErr && !isMissingSchema(bErr)) throw new Error(bErr.message);
  for (const b of (beats ?? []) as { song_track_id: string; beat_track_id: string }[]) raw.push({ to: b.beat_track_id, from: b.song_track_id, relation: 'beat' });
  const { data: mains, error: mErr } = await selectChunked(admin, 'tracks', 'id, beat_track_id', 'beat_track_id', trackIds, ['beat_track_id', 'id'], (q) => q.in('org_id', orgIds));
  if (mErr) throw new Error(mErr.message);
  for (const m of (mains ?? []) as { id: string; beat_track_id: string }[]) raw.push({ to: m.beat_track_id, from: m.id, relation: 'beat' });
  const fromIds = [...new Set(raw.map((r) => r.from))];
  const types = new Map<string, string | null>();
  if (fromIds.length > 0) {
    const { data: from, error: fErr } = await selectChunked(admin, 'tracks', 'id, type', 'id', fromIds, ['id']);
    if (fErr) throw new Error(fErr.message);
    for (const t of (from ?? []) as { id: string; type: string | null }[]) types.set(t.id, t.type);
  }
  for (const r of raw) out.set(r.to, [...(out.get(r.to) ?? []), { relation: r.relation as InboundLink['relation'], fromType: types.get(r.from) ?? null }]);
  return out;
}

/** The release row the listing rules read, scoped to its org. Null when there is none. */
export async function loadListingRelease(admin: any, orgId: string, releaseId: string): Promise<ListingRelease | null> {
  const { data, error } = await admin.from('releases').select(LISTING_COLUMNS).eq('id', releaseId).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ListingRelease | null) ?? null;
}

/* ── The public side ─────────────────────────────────────────────────── */

/** Artist names for several releases in one read; a contact of another org than its release is not named. */
async function artistNames(admin: any, releases: readonly { contact_id: string; org_id: string }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const ids = [...new Set(releases.map((r) => r.contact_id))];
  if (ids.length === 0) return out;
  const { data } = await selectChunked(admin, 'contacts', 'id, org_id, name', 'id', ids, ['id']);
  const rows = (data ?? []) as { id: string; org_id: string | null; name: string | null }[];
  for (const r of releases) {
    const c = rows.find((x) => x.id === r.contact_id && x.org_id === r.org_id);
    out.set(`${r.org_id}:${r.contact_id}`, c?.name || null);
  }
  return out;
}

/**
 * How a visitor hears this release RIGHT NOW (LABEL-72): the stored choice, but `full` only once the release date
 * has come. Derived on every read, so a date stated later turns the release back into a preview by itself.
 */
function playbackOf(r: ListingRelease, now: Date): StorePlayback {
  return effectivePlayback(isStorePlayback(r.store_playback) ? r.store_playback : 'preview', r, now);
}

function toPublicRow(r: ListingRelease, playback: StorePlayback, artist: string | null, now: Date): PublicReleaseRow {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    label_name: r.label_name,
    primary_genre: r.primary_genre,
    release_date: r.release_date,
    imported_released: r.imported_released,
    store_listed_at: r.store_listed_at,
    store_playback: playback,
    has_artwork: !!r.artwork_asset_id,
    artist_name: artist,
    out: isReleasedForStore(r, now),
  };
}

export type PublicReleaseLoad = {
  release: ListingRelease;
  playback: StorePlayback;
  row: PublicReleaseRow;
  items: ListingItem[];
  /** An artist has a say on this release (a consent row exists) or the owner vetoed it: nothing about it may sit in a cache. */
  consentGoverned: boolean;
};

/**
 * A release as a visitor may see it: listed, still released, and its org still
 * on the store owner's side. Null for anything else — one answer (404) for
 * "no such release", "not listed" and "not yours to list".
 */
export async function loadPublicRelease(admin: any, releaseId: string, now: Date, opts: { itemId?: string } = {}): Promise<PublicReleaseLoad | null> {
  const { data, error } = await selectPublic(admin, (q) => q.eq('id', releaseId).maybeSingle());
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  const release = data as ListingRelease | null;
  if (!release || !isPubliclyVisible(release, now)) return null;
  const owner = await cachedStoreOwnerOrgs(admin);
  if (!owner || !orgMayListOnStore(release.org_id, owner)) return null;
  // LABEL-71: a credited artist's no, or the store owner's veto, takes the release off the store on this very
  // request. Read fresh every time (never cached), like `store_listed`, in parallel with the other reads; an
  // unreadable consent table fails closed.
  const [consent, loaded, names] = await Promise.all([refusalsAndVetoes(admin, [release.id]), cachedItems(admin, release, opts.itemId), artistNames(admin, [release])]);
  const key = release.id.toLowerCase();
  if (consent.refused.has(key) || consent.vetoed.has(key)) return null;
  // Per item: a recording that is not finished music is never served, even from a listed release.
  const items = listableItems(loaded);
  if (items.length === 0) return null;
  const playback = playbackOf(release, now);
  return { release, playback, consentGoverned: consent.governed.has(key), row: toPublicRow(release, playback, names.get(`${release.org_id}:${release.contact_id}`) ?? null, now), items };
}

/**
 * The D4 result for a release's items is a handful of reads per call and an
 * audio player makes one call per Range. It is kept for a few seconds per
 * (release, item); the release row itself — listed, state, date — is NOT
 * cached, so an unlist or a PATCH is seen at once, and only a change to a
 * recording's links or stage waits out the few seconds.
 */
export const ITEMS_CACHE_MS = 5_000;
export const ITEMS_CACHE_MAX = 500;
const itemsCache = new Map<string, { at: number; items: ListingItem[] }>();
async function cachedItems(admin: any, release: ListingRelease, itemId?: string): Promise<ListingItem[]> {
  // The key space is validated lowercase UUIDs only (the routes lower-case before they get here, and this
  // does too), so letter case cannot multiply entries.
  const key = `${release.id.toLowerCase()}:${itemId ? itemId.toLowerCase() : '*'}`;
  const hit = itemsCache.get(key);
  const t = Date.now();
  if (hit && t - hit.at < ITEMS_CACHE_MS) return hit.items;
  const items = await loadListingItems(admin, release.org_id, release.id, itemId);
  // Only a found item is kept: minting random item ids must not be able to churn real entries out.
  if (items.length > 0) {
    boundedPut(itemsCache, key, { at: t, items }, ITEMS_CACHE_MAX);
  }
  return items;
}

export function toPublicItems(items: readonly ListingItem[]): PublicReleaseItemRow[] {
  return items.map((i) => ({
    id: i.id,
    position: i.position,
    title: i.title,
    version_title: i.version_title,
    explicit: i.explicit,
    duration_seconds: i.duration_seconds,
  }));
}

const LIST_PAGE = 200;
const LIST_MAX_PAGES = 5;

/**
 * Every release on the store right now, newest listing first. A release
 * with no item that passes the same D4 filter as its detail page has no tile,
 * and that filter runs BEFORE the cut to `limit`: the releases are read in
 * pages of 200 (bounded), and the loop goes on until `limit` real tiles are
 * found or the pages run out, so stale or empty listings cannot crowd real
 * ones out. A failed read throws (the route answers 5xx, never a cacheable
 * empty list).
 */
export type PublicReleaseList = { row: PublicReleaseRow; trackCount: number }[] & { consentGoverned?: boolean };

export async function loadPublicReleaseList(admin: any, now: Date, limit = 24): Promise<PublicReleaseList> {
  /** `consentGoverned`: some tile belongs to a release an artist has a say on, so the list must not sit in a cache. */
  const out: PublicReleaseList = [];
  let owner: StoreOwnerOrgs | null | undefined;
  for (let page = 0; page < LIST_MAX_PAGES && out.length < limit; page += 1) {
    const { data, error } = await selectPublic(admin, (q) =>
      q
        .eq('store_listed', true)
        .order('store_listed_at', { ascending: false })
        .order('id', { ascending: true })
        .range(page * LIST_PAGE, page * LIST_PAGE + LIST_PAGE - 1),
    );
    if (error) {
      if (isMissingSchema(error)) return out;
      throw new Error(error.message);
    }
    const batch = (data ?? []) as ListingRelease[];
    if (batch.length === 0) break;
    const visible = batch.filter((r) => isPubliclyVisible(r, now));
    if (visible.length > 0) {
      if (owner === undefined) owner = await cachedStoreOwnerOrgs(admin);
      if (!owner) return out;
      const mine = visible.filter((r) => orgMayListOnStore(r.org_id, owner as StoreOwnerOrgs));
      // LABEL-71: one batched read per page; a release with an artist's no (or a veto) has no tile.
      const consent = mine.length > 0 ? await refusalsAndVetoes(admin, mine.map((r) => r.id)) : { refused: new Set<string>(), vetoed: new Set<string>(), governed: new Set<string>() };
      const rows = mine.filter((r) => !consent.refused.has(r.id.toLowerCase()) && !consent.vetoed.has(r.id.toLowerCase()));
      if (rows.some((r) => consent.governed.has(r.id.toLowerCase()))) out.consentGoverned = true;
      if (rows.length > 0) {
        const [itemsByRelease, names] = await Promise.all([loadItemsFor(admin, rows), artistNames(admin, rows)]);
        for (const r of rows) {
          if (out.length >= limit) break;
          const trackCount = listableItems(itemsByRelease.get(r.id) ?? []).length;
          if (trackCount === 0) continue;
          out.push({ row: toPublicRow(r, playbackOf(r, now), names.get(`${r.org_id}:${r.contact_id}`) ?? null, now), trackCount });
        }
      }
    }
    if (batch.length < LIST_PAGE) break;
  }
  return out;
}
