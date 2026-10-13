/**
 * /api/org/[orgId]/tracks/[id]/samples — does this song use samples, and how
 * were they cleared (LABEL-29, 09 §3.1 L8; migration 156).
 *
 *   GET  `catalog.read`: the declaration (`none` | `yes` | `unknown`) and
 *        whether it is cleared. The clearance NOTE is read by `rights.read` and
 *        by `catalog.write` (who maintains it); the clearance file is never
 *        sent, only whether one is attached.
 *   PUT  `catalog.write` (L8's fix capability): `{ samples, note?, asset_id? }`.
 *        Declaring `none` / `unknown` drops the note and the file. A clearance
 *        file must be a restricted file of the org in a project that holds the
 *        song. Records `song.samples_declared` { samples, cleared } — never the
 *        note — visible to the business side.
 *
 * Authorised with requireObjectAccess on the TRACK: 404 for a producer track,
 * another org's, one outside the member's artist scope, a track that is not a
 * song, or a song whose row the member may not read (D4). External project
 * members never reach it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgSamplesBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { isCleared, planSamples, samplesChanged, SAMPLES_LABEL, type SamplesState } from '@/lib/labelos/samples';
import { checkClearanceAsset, readSamplesSong, SAMPLES_NOT_READY, SamplesNotReadyError, writeSamples } from '@/lib/labelos/samples-store';
import { memberMayReadSongRow, songEventSubject } from '@/lib/labelos/song-stage-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.samples');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/** Field by field: the file's id is never sent, the note only to those who maintain or read rights. */
function view(state: SamplesState, caps: ReadonlySet<string>): Record<string, unknown> {
  const mayReadNote = caps.has('rights.read') || caps.has('catalog.write');
  return {
    value: state.samples,
    label: SAMPLES_LABEL[state.samples],
    cleared: state.samples === 'yes' && isCleared(state),
    hasFile: state.samples === 'yes' && !!state.assetId,
    ...(mayReadNote ? { note: state.note } : {}),
    canWrite: caps.has('catalog.write'),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Sample declarations need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;
  try {
    const song = await readSamplesSong(access.admin, org, id);
    if (!song || song.type !== 'song' || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) {
      return json(404, { error: 'Not found' });
    }
    return json(200, { schemaReady: true, samples: view(song.state, access.capabilities) });
  } catch (err) {
    if (err instanceof SamplesNotReadyError) return json(200, { schemaReady: false });
    log.error('samples read failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not load the sample declaration' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Sample declarations need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;

  const parsed = await readBody(req, OrgSamplesBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const song = await readSamplesSong(access.admin, org, id);
    if (!song || song.type !== 'song' || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) {
      return json(404, { error: 'Not found' });
    }
    const next = planSamples(song.state, body);
    if (next.assetId && next.assetId !== song.state.assetId) {
      const verdict = await checkClearanceAsset(access.admin, org, id, next.assetId);
      if (verdict === 'not_found') return json(404, { error: 'Clearance file not found' });
      if (verdict === 'not_restricted') return json(400, { error: 'A clearance file must be a restricted file' });
      if (verdict === 'not_in_song_project') return json(400, { error: 'The clearance file must be in a project that holds this song' });
    }
    if (samplesChanged(song.state, next)) {
      await writeSamples(access.admin, org, id, next);
      // Everyday event, best effort: the declaration is saved either way. The declaration and whether it is cleared; never the note.
      await recordEvent(
        access.admin,
        { orgId: org, userId: access.userId },
        'song.samples_declared',
        await songEventSubject(access.admin, org, id),
        { samples: next.samples, cleared: next.samples === 'yes' && isCleared(next) },
      );
    }
    return json(200, { schemaReady: true, samples: view(next, access.capabilities) });
  } catch (err) {
    if (err instanceof SamplesNotReadyError) return json(503, { error: SAMPLES_NOT_READY });
    log.error('samples write failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not save the sample declaration' });
  }
}
