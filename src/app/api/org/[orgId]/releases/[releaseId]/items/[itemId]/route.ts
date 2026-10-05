/**
 * PATCH  /api/org/[orgId]/releases/[releaseId]/items/[itemId] — its master, version title, explicit flag.
 * DELETE /api/org/[orgId]/releases/[releaseId]/items/[itemId] — remove it and close the gap.
 *
 * LABEL-16, `release.write` on the release. The song of an item is fixed
 * (remove and add to change it). A new master is checked like an added one.
 * Removing runs one database function that deletes the item and moves every
 * later item up one, so positions stay 1..n.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isUUID, readBody } from '@/lib/validate';
import { OrgReleaseItemPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { RELEASE_ITEM_COLUMNS, releaseEventSubject, toReleaseItemView, type ReleaseItemRow } from '@/lib/labelos/releases';
import { checkItemTracks, itemsOf, releaseRow, schemaAware, tracklistLocked, writeError, type ObjectAccessOk } from '../../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.items.item');

type Params = { params: Promise<{ orgId: string; releaseId: string; itemId: string }> };

const unconfigured = () => NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

async function itemRow(access: ObjectAccessOk, releaseId: string, itemId: string): Promise<ReleaseItemRow | null> {
  const { data, error } = await access.admin
    .from('release_items')
    .select(RELEASE_ITEM_COLUMNS)
    .eq('id', itemId)
    .eq('release_id', releaseId)
    .eq('org_id', access.object.orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ReleaseItemRow | null) ?? null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId, itemId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  if (!isUUID(itemId)) return notFound();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const locked = tracklistLocked(found.release);
  if (locked) return locked.res;
  const parsed = await readBody(req, OrgReleaseItemPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const item = await itemRow(access, found.release.id, itemId);
    if (!item) return notFound();
    if (parsed.data.master_track_id) {
      const tracks = await checkItemTracks(access, item.song_track_id, parsed.data.master_track_id);
      if (!tracks.ok) return tracks.res;
    }
    const { data, error } = await access.admin
      .from('release_items')
      .update(parsed.data)
      .eq('id', item.id)
      .eq('release_id', found.release.id)
      .eq('org_id', access.object.orgId)
      .select(RELEASE_ITEM_COLUMNS)
      .single();
    if (error || !data) return writeError(error ?? {}, 'Could not save the item').res;
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'release.updated',
      releaseEventSubject(found.release),
      { items: 'edited', item_id: item.id, fields: Object.keys(parsed.data).sort() },
    );
    return NextResponse.json({ item: toReleaseItemView(data as unknown as ReleaseItemRow) });
  } catch (err) {
    log.error('patch failed', { releaseId, itemId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not save the item' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, releaseId, itemId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  if (!isUUID(itemId)) return notFound();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return (await schemaAware(access)).res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const locked = tracklistLocked(found.release);
  if (locked) return locked.res;

  try {
    const { data, error } = await access.admin.rpc('labelos_release_item_remove', {
      p_org: access.object.orgId,
      p_release: found.release.id,
      p_item: itemId,
    });
    if (error) return writeError(error, 'Could not remove the item').res;
    if (data !== true) return notFound();
    await recordEvent(
      access.admin,
      { orgId: access.object.orgId, userId: access.userId },
      'release.updated',
      releaseEventSubject(found.release),
      { items: 'removed', item_id: itemId },
    );
    const items = await itemsOf(access, found.release.id);
    return NextResponse.json({ items: items.map(toReleaseItemView) });
  } catch (err) {
    log.error('remove failed', { releaseId, itemId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not remove the item' }, { status: 500 });
  }
}
