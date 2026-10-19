/**
 * PATCH /api/org/[orgId]/songs/[trackId] (LABEL-53) — the metadata editor's
 * write, for an org song OR one of its recordings (the ISRC lives on the
 * recording that goes out). Body `OrgTrackMetadataBodySchema`: any of title,
 * version_label, isrc, iswc, bpm, key, language, explicit, genre,
 * recorded_on, p_line, master_owner, notes, plus `expected`, the token the
 * editor loaded with. The ISRC needs `release.write`, every other field
 * `catalog.write` (`planMetadataPatch`). Authorised like the GET: the row's
 * org, the member's artist scope and the D4 row rule (404 otherwise), then
 * 403 per field, 400 naming the field, 409 with the current values when the
 * row changed since `expected` (nothing is overwritten). Records
 * `recording.metadata_updated` with the changed FIELD NAMES only.
 *
 * GET /api/org/[orgId]/songs/[trackId] (LABEL-17) — one org song: its stage,
 * artists, projects, releases and the recordings the member may hear
 * (07 §2.3, 17 R1). Recordings play through `/api/org/[orgId]/audio/[id]`.
 *
 * requireObjectAccess on the TRACK (row org, artist scope through its
 * projects, `catalog.read`): 404 for a producer track, another org's, one
 * out of scope or missing. Then 404 when it is not a song with a stage (a
 * master, a beat) or a row the member may not see (D4: an in-development
 * song for marketing), as PostgREST would show nothing. A recording the
 * member may not hear is left out and counted — the page says "restricted".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { errorMessage } from '@/lib/errors';
import { loadOrgSong, orgTrackFacts } from '@/lib/labelos/org-workspace-store';
import { memberSeesTrackRow } from '@/lib/labelos/org-workspace';
import { recordEvent } from '@/lib/labelos/activity';
import { songEventSubject } from '@/lib/labelos/song-stage-store';
import { planMetadataPatch, type MetadataField, type MetadataInput } from '@/lib/labelos/track-metadata';
import { readMetadata, writeMetadata } from '@/lib/labelos/track-metadata-store';
import { OrgTrackMetadataBodySchema } from '@/lib/contracts';
import { readBody } from '@/lib/validate';
import { isSupabaseConfigured } from '@/lib/db';
import { createLogger } from '@/lib/log';

export const dynamic = 'force-dynamic';

const log = createLogger('api.org.songs.id');

type Params = { params: Promise<{ orgId: string; trackId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, trackId } = await params;
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const detail = await loadOrgSong(access);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('song load failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the song' }, { status: 500 });
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, trackId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Editing details needs Supabase.' });
  // `catalog.read` first so a member who cannot see the row learns nothing; each field then asks for its own capability.
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgTrackMetadataBodySchema);
  if (!parsed.ok) return parsed.res;
  const { expected, ...input } = parsed.data;
  const org = access.object.orgId;
  try {
    const facts = (await orgTrackFacts(access.admin, org, [trackId])).get(trackId);
    if (!facts || !memberSeesTrackRow(access.capabilities, facts)) return json(404, { error: 'Not found' });
    const current = await readMetadata(access.admin, org, trackId);
    if (!current) return json(404, { error: 'Not found' });

    const { metadata_updated_at: token, ...values } = current;
    const plan = planMetadataPatch(input as MetadataInput, values, access.capabilities);
    if (!plan.ok) return json(plan.status, { error: plan.error, ...(plan.field ? { field: plan.field } : {}) });
    if (plan.changed.length === 0) return json(200, { changed: [], values, updatedAt: token });

    const conflict = () => json(409, {
      error: 'Someone else changed these details while you were editing. Nothing was saved; the current values are shown.',
      values,
      updatedAt: token,
    });
    if ((expected ?? null) !== (token ?? null)) return conflict();

    const now = new Date().toISOString();
    if (!(await writeMetadata(access.admin, { org, trackId, expected: token, set: plan.set, now }))) {
      // Lost the race between the read and the write: show what is there now.
      const fresh = await readMetadata(access.admin, org, trackId);
      if (!fresh) return json(404, { error: 'Not found' });
      const { metadata_updated_at: freshToken, ...freshValues } = fresh;
      return json(409, {
        error: 'Someone else changed these details while you were editing. Nothing was saved; the current values are shown.',
        values: freshValues,
        updatedAt: freshToken,
      });
    }

    // Everyday event, best effort: the edit is saved either way. Field names only — never a value, never a note.
    await recordEvent(
      access.admin,
      { orgId: org, userId: access.userId },
      'recording.metadata_updated',
      await songEventSubject(access.admin, org, trackId),
      { fields: plan.changed as MetadataField[] },
    );
    return json(200, { changed: plan.changed, values: { ...values, ...plan.set }, updatedAt: now });
  } catch (err) {
    log.error('metadata save failed', { orgId: org, trackId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the details' });
  }
}
