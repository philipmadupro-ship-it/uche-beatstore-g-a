/**
 * POST /api/org/[orgId]/tracks/[id]/stage — move a song to another A&R stage
 * (LABEL-24, 04 W3). Body `{ to, from? }`.
 *
 * Authorised with requireObjectAccess on the TRACK: 404 for a producer track,
 * another org's, one outside the member's artist scope or missing; 403 without
 * `catalog.write`. Then 404 again for a row that is not a song with a stage or
 * that the member may not read (D4), exactly as the song view answers.
 *
 * Which move is legal, and who may make it, is `transition` (lib/labelos/
 * song-stage.ts): the table, plus a roster artist moving only `inbox →
 * in_review`. An illegal move is 409 naming both stages. The write is a
 * compare-and-set on the stage the request read (and on `from`, when the
 * caller sent the stage on its screen), so of two people moving one song at
 * once the loser gets 409 and the stage is never silently overwritten.
 * Records `song.stage_changed` `{ from, to }` (visible to the song's artist, D5).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgSongStageBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { SONG_STAGE_LABEL, allowedTransitions, transition, type SongStage } from '@/lib/labelos/song-stage';
import { memberMayReadSongRow, moveSongStage, readStageSong, songEventSubject } from '@/lib/labelos/song-stage-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.stage');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Song stages need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgSongStageBodySchema);
  if (!parsed.ok) return parsed.res;
  const { to, from: seen } = parsed.data;
  const org = access.object.orgId;

  try {
    const song = await readStageSong(access.admin, org, id);
    if (!song || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) return json(404, { error: 'Not found' });

    const result = transition(song, to, { caps: access.capabilities, role: access.role });
    if (!result.ok) {
      if (result.reason === 'not_a_song') return json(404, { error: 'Not found' });
      if (result.reason === 'forbidden') return json(403, { error: 'Forbidden' });
      return json(409, { error: result.message, from: song.stage, to });
    }
    const current = result.from;
    if (seen && seen !== current) {
      return json(409, {
        error: `This song is now ${SONG_STAGE_LABEL[current]}, not ${SONG_STAGE_LABEL[seen]}: someone else moved it. Nothing was changed.`,
        from: current,
        to,
      });
    }

    if (!(await moveSongStage(access.admin, { orgId: org, trackId: id, from: current, to }))) {
      return json(409, { error: `Someone else moved this song first. It was not moved to ${SONG_STAGE_LABEL[to]}.`, from: current, to });
    }

    // Everyday event, best effort: the move has happened either way.
    await recordEvent(
      access.admin,
      { orgId: org, userId: access.userId },
      'song.stage_changed',
      await songEventSubject(access.admin, org, id),
      { from: current, to },
    );

    return json(200, {
      song: { id, stage: to },
      from: current,
      to,
      allowed: allowedTransitions(to as SongStage, access.capabilities, access.role),
    });
  } catch (err) {
    log.error('stage move failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not move the song' });
  }
}
