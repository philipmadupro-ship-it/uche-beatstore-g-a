/**
 * GET /api/org/[orgId]/songs/[trackId]/metadata (LABEL-53) — the fields the
 * metadata editor shows for one org song OR recording, the compare-and-set
 * token to send back, and what THIS member may write.
 *
 * requireObjectAccess on the track (`catalog.read`; 404 for a producer track,
 * another org's, out of artist scope or missing), then the D4 row rule:
 * a row the member may not see (working material for marketing) is 404, as
 * the song view answers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { orgTrackFacts } from '@/lib/labelos/org-workspace-store';
import { memberSeesTrackRow } from '@/lib/labelos/org-workspace';
import { readMetadata } from '@/lib/labelos/track-metadata-store';
import { METADATA_FIELDS, PRIVATE_FIELDS, canSeePrivateFields, capabilityFor, withoutPrivate } from '@/lib/labelos/track-metadata';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.songs.metadata');

type Params = { params: Promise<{ orgId: string; trackId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, trackId } = await params;
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;
  try {
    const facts = (await orgTrackFacts(access.admin, org, [trackId])).get(trackId);
    if (!facts || !memberSeesTrackRow(access.capabilities, facts)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const row = await readMetadata(access.admin, org, trackId);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { metadata_updated_at: updatedAt, ...all } = row;
    const see = canSeePrivateFields(access.capabilities, access.role);
    const values = withoutPrivate(all, see);
    return NextResponse.json(
      {
        trackId,
        kind: facts.type === 'song' && facts.song_stage !== null ? 'song' : 'recording',
        values,
        updatedAt,
        // Field by field: what this member's capabilities let them change.
        writable: METADATA_FIELDS.filter((f) => access.capabilities.has(capabilityFor(f)) && (see || !(PRIVATE_FIELDS as readonly string[]).includes(f))),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('metadata load failed', { orgId: org, trackId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the details' }, { status: 500 });
  }
}
