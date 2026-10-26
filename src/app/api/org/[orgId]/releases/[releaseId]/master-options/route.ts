/**
 * GET /api/org/[orgId]/releases/[releaseId]/master-options?song_track_id=… —
 * the recordings a song can go out as on this release, and which one is the
 * default (LABEL-55).
 *
 * `release.write` on the release, like the item routes that use the answer.
 * Reads only: the options are the song's own mix and the tracks it links to
 * as master, instrumental or version (`lib/labelos/master-choice`, the same
 * relations 144's trigger accepts), and each is named only if THIS member can
 * see that track (catalog.read + scope, the answer `checkItemTracks` would
 * give) AND may read its row under D4 (`memberMayReadSongRow`). A linked track the member cannot see is left out, as if it did not
 * exist, so it neither appears in the list nor becomes the default.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isUUID } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { RELEASE_MASTER_RELATIONS } from '@/lib/labelos/releases';
import { masterChoice, type MasterCandidate } from '@/lib/labelos/master-choice';
import { memberMayReadSongRow } from '@/lib/labelos/song-stage-store';
import { fail, releaseRow, schemaAware, visibleTrack } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.master-options');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;

  const songId = req.nextUrl.searchParams.get('song_track_id') ?? '';
  if (!isUUID(songId)) return fail(400, 'song_track_id: a song id is required', { field: 'song_track_id' }).res;
  const song = await visibleTrack(access.orgId, songId);
  if (!song.ok) return song.res;
  // D4's row rule, as the release page applies it: a song whose row this member may not read is "Restricted song" there, so it is 404 here.
  if (!(await memberMayReadSongRow(access.admin, access.orgId, song.track.id, access.capabilities))) return fail(404, 'Not found').res;
  if (song.track.type !== 'song') return fail(400, 'song_track_id: only a song goes on a release', { field: 'song_track_id' }).res;

  try {
    const { data, error } = await access.admin
      .from('track_links')
      .select('from_track_id, to_track_id, relation')
      .eq('from_track_id', song.track.id);
    if (error) throw new Error(error.message);
    const relations = RELEASE_MASTER_RELATIONS as readonly string[];
    const links = ((data ?? []) as { from_track_id: string; to_track_id: string; relation: string }[]).filter((l) => relations.includes(l.relation));

    // Only recordings this member may see take part, so a hidden master is neither offered nor the default.
    const targets = [...new Set(links.map((l) => l.to_track_id.toLowerCase()))];
    // Scope (catalog.read + artist scope) AND D4's row rule: a working mix this member may not read is not named.
    const checked = await Promise.all(
      targets.map(async (id) =>
        (await visibleTrack(access.orgId, id)).ok && (await memberMayReadSongRow(access.admin, access.orgId, id, access.capabilities)) ? id : null,
      ),
    );
    const visible = new Set(checked.filter((id): id is string => id !== null));
    const visibleLinks = links.filter((l) => visible.has(l.to_track_id.toLowerCase()));
    const choice = masterChoice(song.track.id, visibleLinks);

    const ids = choice.options.map((o) => o.id);
    const titleRes = await access.admin.from('tracks').select('id, title').eq('org_id', access.orgId).in('id', ids);
    if (titleRes.error) throw new Error(titleRes.error.message);
    const titles = new Map(((titleRes.data ?? []) as { id: string; title: string | null }[]).map((t) => [t.id.toLowerCase(), t.title?.trim() || 'Untitled']));
    const options: MasterCandidate[] = choice.options.map((o) => ({ ...o, title: titles.get(o.id.toLowerCase()) ?? 'Untitled' }));

    return NextResponse.json({ songId: song.track.id, options, defaultId: choice.defaultId, ask: choice.ask }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('master options failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the masters' }, { status: 500 });
  }
}
