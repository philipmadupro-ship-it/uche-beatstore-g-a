/**
 * POST  /api/org/[orgId]/releases/[releaseId]/items — append a song to the tracklist.
 * PATCH /api/org/[orgId]/releases/[releaseId]/items { order } — reorder it.
 *
 * LABEL-16 (17 R1), `release.write` on the release. An item is a SONG the
 * member can see and the recording released as it: the song itself (no
 * `master_track_id`), or a track the song links to as master, instrumental
 * or version (lib/labelos/releases; 144's trigger holds it again). Positions
 * stay 1..n: an add goes to n + 1, and a reorder names every item once and
 * is applied by one database function, so the tracklist is never seen with
 * a gap or a duplicate. Two edits of one tracklist at the same moment meet
 * on the deferred (release, position) key: the second is a 409.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleaseItemCreateBodySchema, OrgReleaseItemsReorderBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import {
  nextItemPosition,
  planReorder,
  RELEASE_ITEM_COLUMNS,
  RELEASE_MAX_ITEMS,
  toReleaseItemView,
  type ReleaseItemRow,
} from '@/lib/labelos/releases';
import { checkItemTracks, fail, itemsOf, releaseRow, writeError } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases.items');

type Params = { params: Promise<{ orgId: string; releaseId: string }> };

const unconfigured = () => NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return access.res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgReleaseItemCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const masterId = body.master_track_id ?? body.song_track_id;

  const tracks = await checkItemTracks(access, body.song_track_id, masterId);
  if (!tracks.ok) return tracks.res;

  try {
    const items = await itemsOf(access, found.release.id);
    if (items.length >= RELEASE_MAX_ITEMS) return fail(409, `A release holds at most ${RELEASE_MAX_ITEMS} items`).res;
    const { data, error } = await access.admin
      .from('release_items')
      .insert({
        release_id: found.release.id,
        org_id: access.object.orgId,
        position: nextItemPosition(items),
        song_track_id: body.song_track_id,
        master_track_id: masterId,
        version_title: body.version_title ?? null,
        explicit: body.explicit ?? false,
      })
      .select(RELEASE_ITEM_COLUMNS)
      .single();
    if (error || !data) return writeError(error ?? {}, 'Could not add the song').res;
    return NextResponse.json({ item: toReleaseItemView(data as unknown as ReleaseItemRow) }, { status: 201 });
  } catch (err) {
    log.error('add failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not add the song' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, releaseId } = await params;
  if (!isSupabaseConfigured()) return unconfigured();
  const access = await requireObjectAccess({ table: 'releases', id: releaseId, cap: 'release.write', orgId });
  if (!access.ok) return access.res;
  const found = await releaseRow(access);
  if (!found.ok) return found.res;
  const parsed = await readBody(req, OrgReleaseItemsReorderBodySchema);
  if (!parsed.ok) return parsed.res;

  try {
    const items = await itemsOf(access, found.release.id);
    const plan = planReorder(items, parsed.data.order);
    if (!plan.ok) return fail(400, plan.error, { field: 'order' }).res;
    const { error } = await access.admin.rpc('labelos_release_items_reorder', {
      p_org: access.object.orgId,
      p_release: found.release.id,
      p_items: plan.order.map((i) => i.id),
    });
    if (error) {
      // The function re-checks the list; a mismatch now means it changed meanwhile.
      if (error.code === '22023') return fail(409, 'The tracklist changed at the same time; reload and try again').res;
      return writeError(error, 'Could not reorder the tracklist').res;
    }
    const after = await itemsOf(access, found.release.id);
    return NextResponse.json({ items: after.map(toReleaseItemView) });
  } catch (err) {
    log.error('reorder failed', { releaseId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not reorder the tracklist' }, { status: 500 });
  }
}
