/**
 * Who may touch which release (LABEL-16), shared by the
 * `/api/org/[orgId]/releases*` routes. Not a route itself.
 *
 *  - The RELEASE: requireObjectAccess on `releases` reads its org from the
 *    row and its scope through its PROJECT (migration 144's read policy,
 *    `can_see_org_project`): another org's release, one outside the
 *    member's artists, or a missing id is 404; lacking the capability is 403.
 *    Reads need `catalog.read`, every write `release.write`.
 *  - A TRACK named in a body (a song, a master): requireObjectAccess on
 *    `tracks` with `catalog.read` — a producer track, another org's, or one
 *    outside the member's artists is 404, the same answer as a missing one.
 *    The release rules themselves (song type, master relation) are the pure
 *    lib/labelos/releases, and 144's trigger holds them again.
 *
 * Everything is read with the service role, by id and org — never by user.
 */
import { NextResponse } from 'next/server';
import { requireObjectAccess, type ObjectAccessResult } from '@/lib/auth/org-access';
import type { OwnershipFail } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import {
  ARTWORK_PROBLEM_MESSAGES,
  MASTER_PROBLEM_MESSAGES,
  RELEASE_COLUMNS,
  RELEASE_ITEM_COLUMNS,
  releaseArtworkProblem,
  releaseMasterProblem,
  type ReleaseItemRow,
  type ReleaseRow,
} from '@/lib/labelos/releases';

export type ObjectAccessOk = Extract<ObjectAccessResult, { ok: true }>;

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): OwnershipFail => ({
  ok: false,
  res: NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } }),
});

export const notReady = () =>
  fail(503, 'Releases need migration 144 applied on Supabase.', { migration: '144', schemaReady: false });

/** A Postgres error from a write, as the member should see it. */
export function writeError(error: { code?: string; message?: string }, fallback: string): OwnershipFail {
  if (isMissingSchema(error)) return notReady();
  // 144's triggers and CHECKs: our own wording, safe to show.
  if (error.code === '23514') return fail(400, error.message ?? fallback);
  // The deferred (release, position) key: two edits of one tracklist at once.
  if (error.code === '23505') return fail(409, 'The tracklist changed at the same time; reload and try again');
  if (error.code === '23503') return fail(409, 'Something this release points at no longer exists');
  return fail(500, fallback);
}

export type ReleaseAccess = { ok: true; release: ReleaseRow };

/**
 * After the route's `requireObjectAccess({ table: 'releases', … })`: the
 * release row, read by id and org.
 */
export async function releaseRow(access: ObjectAccessOk): Promise<ReleaseAccess | OwnershipFail> {
  const { data, error } = await access.admin
    .from('releases')
    .select(RELEASE_COLUMNS)
    .eq('id', access.object.id)
    .eq('org_id', access.object.orgId)
    .maybeSingle();
  if (error) return isMissingSchema(error) ? notReady() : fail(500, 'Could not read the release');
  if (!data) return fail(404, 'Not found');
  return { ok: true, release: data as unknown as ReleaseRow };
}

/** The release's items in tracklist order. Throws when the read fails. */
export async function itemsOf(access: ObjectAccessOk, releaseId: string): Promise<ReleaseItemRow[]> {
  const { data, error } = await access.admin
    .from('release_items')
    .select(RELEASE_ITEM_COLUMNS)
    .eq('release_id', releaseId)
    .eq('org_id', access.orgId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReleaseItemRow[]).sort((a, b) => a.position - b.position);
}

type TrackRef = { id: string; type: string | null };

/** An org track the member can see (catalog.read + scope), else the 404 / 403 of requireObjectAccess. */
async function visibleTrack(orgId: string, trackId: string): Promise<{ ok: true; track: TrackRef } | OwnershipFail> {
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access;
  const { data, error } = await access.admin
    .from('tracks')
    .select('id, type')
    .eq('id', access.object.id)
    .eq('org_id', access.object.orgId)
    .maybeSingle();
  if (error) return fail(500, 'Could not read the track');
  if (!data) return fail(404, 'Not found');
  return { ok: true, track: data as TrackRef };
}

/**
 * The song and master of an item, both visible to the member, and the
 * master one the song may be released as. 400 names the field at fault.
 */
export async function checkItemTracks(
  access: ObjectAccessOk,
  songId: string,
  masterId: string,
): Promise<{ ok: true } | OwnershipFail> {
  const song = await visibleTrack(access.orgId, songId);
  if (!song.ok) return song;
  if (masterId.toLowerCase() !== songId.toLowerCase()) {
    const master = await visibleTrack(access.orgId, masterId);
    if (!master.ok) return master;
  }
  const { data, error } = await access.admin
    .from('track_links')
    .select('from_track_id, to_track_id, relation')
    .eq('from_track_id', song.track.id)
    .eq('to_track_id', masterId);
  if (error) return fail(500, 'Could not read the song’s links');
  const links = (data ?? []) as { from_track_id: string; to_track_id: string; relation: string }[];
  const problem = releaseMasterProblem(song.track, masterId, links);
  if (problem) {
    const { field, error: message } = MASTER_PROBLEM_MESSAGES[problem];
    return fail(400, message, { field });
  }
  return { ok: true };
}

/** The artwork file, which must be an artwork / photo of the release's own project. */
export async function checkArtwork(
  access: { admin: ObjectAccessOk['admin']; orgId: string },
  release: { org_id: string; project_id: string },
  assetId: string,
): Promise<{ ok: true } | OwnershipFail> {
  const { data, error } = await access.admin
    .from('project_assets')
    .select('id, org_id, project_id, kind')
    .eq('id', assetId)
    .eq('org_id', access.orgId)
    .maybeSingle();
  if (error) return isMissingSchema(error) ? notReady() : fail(500, 'Could not read the artwork');
  const problem = releaseArtworkProblem(release, data as { org_id: string | null; project_id: string; kind: string } | null);
  return problem ? fail(400, ARTWORK_PROBLEM_MESSAGES[problem], { field: 'artwork_asset_id' }) : { ok: true };
}
