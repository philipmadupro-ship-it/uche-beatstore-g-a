/**
 * GET    /api/org/[orgId]/releases/[releaseId] — the release and its tracklist.
 * PATCH  /api/org/[orgId]/releases/[releaseId] — edit its fields (`release.write`).
 * DELETE /api/org/[orgId]/releases/[releaseId] — delete it and its tracklist.
 *
 * LABEL-16. The release's project and artist are fixed (144's trigger
 * agrees). `state` moves only between draft and cancelled here: delivery is
 * LABEL-33, gates LABEL-32, the store LABEL-42. Cancel (and delete) is for a
 * DRAFT only (LABEL-56): a delivered release is withdrawn
 * (POST …/withdraw), one entered as already out is not deleted.
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
import { recordEvent } from '@/lib/labelos/activity';
import { RELEASE_COLUMNS, RELEASE_DETAIL_COLUMNS, releaseEventSubject, toReleaseItemView, toReleaseView, type ReleaseRow } from '@/lib/labelos/releases';
import { cancelRefusal } from '@/lib/labelos/release-withdrawal';
import { checkArtwork, fail, isMissingDetailColumn, itemsOf, releaseRow, schemaAware, writeError } from '../access';

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
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access, { details: true });
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
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgReleasePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const { release } = found;

  if (parsed.data.state && (release.state === 'delivered' || release.state === 'withdrawn')) {
    // Cancel is draft-only (LABEL-56): a delivered release is withdrawn, and a withdrawn one keeps its state.
    return fail(409, cancelRefusal(release, 'cancel') ?? 'A release that went out keeps its state', { field: 'state' }).res;
  }
  // LABEL-42: once a release is delivered or entered as already out, its date is the record of when
  // it came out — the store judges "released" by it, so it is not editable (a street date next month
  // cannot be moved to yesterday to put the release on the store).
  const wentOut = release.state === 'delivered' || release.state === 'withdrawn' || release.imported_released;
  const manages = access.role === 'owner' || access.role === 'admin';
  if (parsed.data.release_date !== undefined && parsed.data.release_date !== release.release_date && wentOut) {
    if (release.release_date !== null) {
      return fail(409, 'The release date of a release that went out is fixed', { field: 'release_date' }).res;
    }
    // A delivery can go out with a target date only; the day it came out is then the owner's or an admin's to
    // state once (a date that has come is what puts a release on the store).
    if (!manages) return fail(403, 'Only an owner or an admin can set the release date of a release that went out', { field: 'release_date' }).res;
  }
  // What the public sees the moment it is saved: while a release is on the store (or was entered as already out)
  // its title, type, label, genre and artwork are the owner's or an admin's to change.
  const PUBLIC_FIELDS = ['title', 'type', 'label_name', 'primary_genre', 'artwork_asset_id'] as const;
  if ((release.store_listed || release.imported_released) && !manages) {
    const touched = PUBLIC_FIELDS.filter((f) => parsed.data[f] !== undefined && parsed.data[f] !== release[f]);
    if (touched.length > 0) {
      return fail(403, 'Only an owner or an admin can change what the public sees of a release that is on the store', { field: touched[0] }).res;
    }
  }
  if (parsed.data.artwork_asset_id) {
    const art = await checkArtwork(access, release, parsed.data.artwork_asset_id);
    if (!art.ok) return art.res;
  }

  try {
    // Guarded in the statement: state and release date are repeated as READ, so a delivery (or a cancel)
    // that landed between the read and this write cannot be overwritten — it matches no row and is a 409.
    const update = (columns: string) => {
      let guarded = access.admin
        .from('releases')
        .update(parsed.data)
        .eq('id', release.id)
        .eq('org_id', access.object.orgId)
        .eq('state', release.state);
      guarded = release.release_date === null ? guarded.is('release_date', null) : guarded.eq('release_date', release.release_date);
      return guarded.select(columns).maybeSingle();
    };
    let { data, error } = await update(RELEASE_DETAIL_COLUMNS);
    // Before 175 a change that does not name the three details still saves (the statement is refused whole, so it is safe to repeat).
    if (error && isMissingDetailColumn(error) && !('distributor' in parsed.data || 'territories' in parsed.data || 'language' in parsed.data)) {
      ({ data, error } = await update(RELEASE_COLUMNS));
    }
    if (error) return writeError(error, 'Could not save the release').res;
    if (!data) return fail(409, 'The release changed while it was being saved; reload and try again', { field: 'state' }).res;
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'release.updated',
      releaseEventSubject(release),
      {
        fields: Object.keys(parsed.data).sort(),
        ...(parsed.data.state && parsed.data.state !== release.state ? { state: { from: release.state, to: parsed.data.state } } : {}),
      },
    );
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
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const { release } = found;
  const refusal = cancelRefusal(release, 'delete');
  if (refusal) return fail(409, refusal).res;
  try {
    const { data, error } = await access.admin
      .from('releases')
      .delete()
      .eq('id', release.id)
      .eq('org_id', access.object.orgId)
      .select('id');
    if (error) return writeError(error, 'Could not delete the release').res;
    if (!(data as unknown[] | null)?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'release.deleted',
      releaseEventSubject(release),
      { title: release.title, type: release.type },
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error('delete failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not delete the release' }, { status: 500 });
  }
}
