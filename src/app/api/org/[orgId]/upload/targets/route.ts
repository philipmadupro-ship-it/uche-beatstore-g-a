/**
 * GET /api/org/[orgId]/upload/targets?contactId= (LABEL-14) — the songs an
 * upload can be added to "as…" for one roster artist (W3): the songs in that
 * artist's projects of this org (the Inbox, and projects linking the artist
 * through project_contacts).
 *
 * Narrowed by the project path, never by `scopedOrgQuery` (which lists no
 * tracks to a scoped member, LABEL-12 carry): the caller needs
 * `catalog.write` on the ARTIST, in scope (requireObjectAccess), and only
 * that artist's projects are read. A song reached here is in scope for the
 * caller by the same rule `requireObjectAccess` applies to a track.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { artistProjects } from '@/lib/labelos/org-workspace-store';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.upload.targets');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const contactId = req.nextUrl.searchParams.get('contactId') ?? '';
  // requireObjectAccess answers 404 for a malformed id too.
  const access = await requireObjectAccess({ table: 'contacts', id: isUUID(contactId) ? contactId : '-', cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const { admin } = access;
  const org = access.object.orgId;
  try {
    // The artist's projects of this org (Inbox + project_contacts), the
    // same rule the org workspace lists (lib/labelos/org-workspace-store).
    const projectIds = (await artistProjects(admin, org, contactId)).map((p) => p.id);
    if (projectIds.length === 0) return NextResponse.json({ songs: [] });

    const linksRes = await admin.from('project_tracks').select('track_id').in('project_id', projectIds);
    if (linksRes.error) throw new Error(linksRes.error.message);
    const trackIds = [...new Set(((linksRes.data ?? []) as { track_id: string }[]).map((l) => l.track_id))];
    if (trackIds.length === 0) return NextResponse.json({ songs: [] });

    const songsRes = await admin
      .from('tracks')
      .select('id, title, song_stage, created_at')
      .in('id', trackIds)
      .eq('org_id', org)
      .eq('type', 'song')
      .order('created_at', { ascending: false })
      .limit(200);
    if (songsRes.error) throw new Error(songsRes.error.message);
    // A song has a stage; a song-type master / demo linked to one does not.
    const songs = ((songsRes.data ?? []) as { id: string; title: string | null; song_stage: string | null }[])
      .filter((s) => s.song_stage !== null)
      .map((s) => ({
      id: s.id,
      title: s.title,
      songStage: s.song_stage,
    }));
    return NextResponse.json({ songs });
  } catch (err) {
    log.error('upload targets failed', { orgId: org, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the songs' }, { status: 500 });
  }
}
