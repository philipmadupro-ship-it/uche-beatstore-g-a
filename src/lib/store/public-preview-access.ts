/**
 * Which tracks the public preview + peaks routes may stream, and from what.
 *
 * The routes used to serve only `store_listed = true`. A featured project
 * bundle is public too — `/store/projects/[id]` lists its tracks and gives
 * each a Preview — but a bundle's tracks are usually not listed on their own.
 * In production 125 of 131 bundle tracks 404'd, so a buyer pressed Preview on
 * a bundle and heard nothing. A track is now previewable when it is listed OR
 * it sits in a featured bundle, and in both cases its owner must be the
 * producer. A bundle only vouches for tracks its own owner owns:
 * `project_tracks` is a plain junction, and a project must not make someone
 * else's track public.
 *
 * WHAT is streamed does not change: the public preview derivative, or a
 * non-private `audio_url`. A private `r2://` master is never a source.
 */
import { isProducerUserId } from '@/lib/auth/producer';

export interface PreviewTrackRow {
  user_id: string | null;
  store_listed: boolean | null;
  preview_url?: string | null;
  audio_url?: string | null;
}

export interface BundleRow {
  user_id: string | null;
  store_featured: boolean | null;
}

/** The source a public route may stream, or null. Never a private master. */
export function publicPreviewSource(track: Pick<PreviewTrackRow, 'preview_url' | 'audio_url'>): string | null {
  if (track.preview_url) return track.preview_url;
  if (typeof track.audio_url === 'string' && track.audio_url && !track.audio_url.startsWith('r2://')) {
    return track.audio_url;
  }
  return null;
}

/** True when one of `bundles` is featured and owned by the track's owner. */
export function featuredBundleCovers(trackOwner: string | null, bundles: BundleRow[]): boolean {
  if (!trackOwner) return false;
  return bundles.some((b) => b.store_featured === true && b.user_id === trackOwner);
}

/**
 * Full access decision for a track row the route has already loaded.
 * `admin` is the service client; the route is public, so this is the only
 * gate between an anonymous request and the audio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canStreamPublicly(admin: any, trackId: string, track: PreviewTrackRow | null): Promise<boolean> {
  if (!track) return false;
  // Only the producer's catalogue is public, whichever way it became public.
  if (!(await isProducerUserId(admin, track.user_id))) return false;
  if (track.store_listed === true) return true;

  const { data: links, error: linkErr } = await admin
    .from('project_tracks')
    .select('project_id')
    .eq('track_id', trackId);
  if (linkErr) throw linkErr;
  const projectIds = ((links ?? []) as Array<{ project_id: string }>).map((l) => l.project_id);
  if (projectIds.length === 0) return false;

  const { data: bundles, error: bundleErr } = await admin
    .from('projects')
    .select('user_id, store_featured')
    .in('id', projectIds)
    .eq('store_featured', true);
  if (bundleErr) throw bundleErr;
  return featuredBundleCovers(track.user_id, (bundles ?? []) as BundleRow[]);
}

/**
 * Tracks made public by a featured bundle, as `trackId → the bundle owner`.
 *
 * The preview backfill used to consider only listed tracks, so a track that is
 * public only through a bundle never got a preview clip — and then 404'd on
 * the bundle page even after the stream route learned to serve it. The
 * backfill joins these ids back to `tracks` and keeps a row only when its
 * `user_id` matches, which is the same owner rule `canStreamPublicly` applies.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function featuredBundleTrackOwners(admin: any, ownerId?: string): Promise<Map<string, string>> {
  let projectQuery = admin.from('projects').select('id, user_id').eq('store_featured', true);
  if (ownerId) projectQuery = projectQuery.eq('user_id', ownerId);
  const { data: projects, error: pErr } = await projectQuery;
  if (pErr) throw pErr;
  const rows = (projects ?? []) as Array<{ id: string; user_id: string | null }>;
  // Only the producer's bundles make anything public (same rule as streaming).
  const producers = new Set<string>();
  for (const owner of new Set(rows.map((p) => p.user_id).filter((u): u is string => !!u))) {
    if (await isProducerUserId(admin, owner)) producers.add(owner);
  }
  const ownerByProject = new Map<string, string>();
  for (const p of rows) {
    if (p.user_id && producers.has(p.user_id)) ownerByProject.set(p.id, p.user_id);
  }
  if (ownerByProject.size === 0) return new Map();

  const { data: links, error: lErr } = await admin
    .from('project_tracks')
    .select('project_id, track_id')
    .in('project_id', [...ownerByProject.keys()]);
  if (lErr) throw lErr;
  const out = new Map<string, string>();
  for (const l of (links ?? []) as Array<{ project_id: string; track_id: string }>) {
    const owner = ownerByProject.get(l.project_id);
    if (owner) out.set(l.track_id, owner);
  }
  return out;
}

/** Keep only rows whose owner is the owner of the bundle that listed them. */
export function ownedByTheirBundle<T extends { id: string; user_id?: string | null }>(
  rows: T[],
  owners: Map<string, string>,
): T[] {
  return rows.filter((r) => !!r.user_id && owners.get(r.id) === r.user_id);
}

/**
 * Preview-backfill candidates that are public only through a featured bundle.
 * `select` must include `user_id`; `needsWorkOr` is the same PostgREST `.or()`
 * the caller uses for listed tracks. Ids go in chunks so the query string
 * stays well inside URL limits on a large bundle.
 */
export async function bundlePreviewCandidates<T extends { id: string; user_id?: string | null }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  select: string,
  needsWorkOr: string,
  ownerId?: string,
): Promise<T[]> {
  const owners = await featuredBundleTrackOwners(admin, ownerId);
  const ids = [...owners.keys()];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from('tracks')
      .select(select)
      .in('id', ids.slice(i, i + 100))
      .or(needsWorkOr);
    if (error) throw error;
    out.push(...ownedByTheirBundle((data ?? []) as T[], owners));
  }
  return out;
}

/** Listed rows first, then bundle rows not already present. */
export function mergeCandidates<T extends { id: string }>(listed: T[], bundled: T[]): T[] {
  const seen = new Set(listed.map((r) => r.id));
  return [...listed, ...bundled.filter((r) => !seen.has(r.id))];
}
