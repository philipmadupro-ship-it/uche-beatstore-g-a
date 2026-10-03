/**
 * GET    /api/org/[orgId]/releases/[releaseId] — the release and its tracklist.
 * PATCH  /api/org/[orgId]/releases/[releaseId] — edit its fields (`release.write`).
 * DELETE /api/org/[orgId]/releases/[releaseId] — delete it and its tracklist.
 *
 * LABEL-16. The release's project and artist are fixed (144's trigger
 * agrees). `state` moves only between draft and cancelled here: delivery is
 * LABEL-33, gates LABEL-32, the store LABEL-42. A delivered or
 * imported-as-released release went out and is not deleted — cancel it.
 * Items are ids only: who may read a song's title, audio or ISRC is the
 * track routes' question (scope and audio class), not the release's.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleasePatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { RELEASE_COLUMNS, toReleaseItemView, toReleaseView, type ReleaseRow } from '@/lib/labelos/releases';
import { checkArtwork, fail, itemsOf, releaseRow, writeError } from '../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.item');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const unconfigured = () => NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  try {
    const items = await itemsOf(access, found.release.id);
    return NextResponse.json({ release: toReleaseView(found.release), items: items.map(toReleaseItemView) }, { headers: NO_STORE });
  } catch (err) {
    log.error('read failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the release' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return access.res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgReleasePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const { release } = found;

  if (parsed.data.state && release.state === 'delivered') {
    return fail(409, 'A delivered release keeps its state', { field: 'state' }).res;
  }
  if (parsed.data.artwork_asset_id) {
    const art = await checkArtwork(access, release, parsed.data.artwork_asset_id);
    if (!art.ok) return art.res;
  }

  try {
    const { data, error } = await access.admin
      .from('releases')
      .update(parsed.data)
      .eq('id', release.id)
      .eq('org_id', access.object.orgId)
      .select(RELEASE_COLUMNS)
      .single();
    if (error || !data) return writeError(error ?? {}, 'Could not save the release').res;
    return NextResponse.json({ release: toReleaseView(data as unknown as ReleaseRow) }, { headers: NO_STORE });
  } catch (err) {
    log.error('patch failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not save the release' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return access.res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const { release } = found;
  if (release.state === 'delivered' || release.imported_released) {
    return fail(409, 'This release went out; cancel it instead of deleting it').res;
  }
  try {
    const { data, error } = await access.admin
      .from('releases')
      .delete()
      .eq('id', release.id)
      .eq('org_id', access.object.orgId)
      .select('id');
    if (error) return writeError(error, 'Could not delete the release').res;
    if (!(data as unknown[] | null)?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error('delete failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not delete the release' }, { status: 500 });
  }
}
