/**
 * GET /api/org/[orgId]/audio/[trackId]?variant=preview|full|wav|stem:<name>[&download=1]
 * (LABEL-13) — stream one org recording to a member who may hear THAT
 * recording. The per-object twin of the producer's `/api/audio`, which stays
 * unchanged: that route takes any `src` and trusts the caller because there
 * is one producer; this one takes only a track id.
 *
 *  1. requireObjectAccess reads the track's org from the ROW (service role):
 *     a producer track (org_id IS NULL), another org's track, a missing id
 *     and a non-member all answer 404. Artist scope runs through the track's
 *     projects of its org (inbox artist + project_contacts); a track in no
 *     project is whole-org only. Then `catalog.read`, else 403.
 *  2. D4 is applied HERE, not by requireObjectAccess: the track's one-hop
 *     links (`mergeLinks` over song_beats + track_links) give its recording
 *     kinds (lib/labelos/org-audio), and the member needs every audio
 *     capability those kinds — and a stem variant — call for. Unclassified
 *     material needs a capability nobody has: 403 for everyone.
 *  3. The variant names a column of the row (or a `stems` row). Its stored
 *     reference is streamed through lib/audio/stream-source, which forwards
 *     Range (206 + Content-Range from R2). Nothing is presigned, so no URL —
 *     private or public — ever reaches the client, in JSON or a Location.
 *
 * External project members (LABEL-21) do not exist yet: anyone who is not
 * an org member is 404 here, and the `recording.downloaded` audit for them
 * arrives with that task.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { streamAudioPreviewSource, streamAudioSource } from '@/lib/audio/stream-source';
import { OrgAudioQuerySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import {
  orgAudioAllowed,
  orgAudioFilename,
  orgAudioSource,
  parseOrgAudioVariant,
  requiredAudioCapabilities,
  type OrgAudioStemRow,
} from '@/lib/labelos/org-audio';
import { createLogger } from '@/lib/log';
import { mergeLinks, type LinkTrack } from '@/lib/tracks/links';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const log = createLogger('api.org.audio');

type Params = { params: Promise<{ orgId: string; trackId: string }> };

type TrackRow = {
  id: string;
  title: string | null;
  type: string | null;
  song_stage: string | null;
  audio_url: string | null;
  wav_url: string | null;
  preview_url: string | null;
};

const json = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, trackId } = await params;
  const access = await requireObjectAccess({ table: 'tracks', id: trackId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;

  const query = OrgAudioQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  const variant = query.success ? parseOrgAudioVariant(query.data.variant) : null;
  if (!query.success || !variant) return json(400, 'Unknown audio variant');

  const { admin } = access;
  const org = access.object.orgId;
  try {
    const trackRes = await admin
      .from('tracks')
      .select('id, title, type, song_stage, audio_url, wav_url, preview_url')
      .eq('id', trackId)
      .eq('org_id', org)
      .maybeSingle();
    if (trackRes.error) throw new Error(trackRes.error.message);
    const track = trackRes.data as TrackRow | null;
    if (!track) return json(404, 'Not found');

    // Only links INTO this track classify it (lib/labelos/org-audio).
    const [beatsRes, linksRes] = await Promise.all([
      admin.from('song_beats').select('song_track_id, beat_track_id, position').eq('beat_track_id', trackId),
      admin.from('track_links').select('from_track_id, to_track_id, relation, position').eq('to_track_id', trackId),
    ]);
    if (beatsRes.error) throw new Error(beatsRes.error.message);
    if (linksRes.error) throw new Error(linksRes.error.message);
    const songBeats = (beatsRes.data ?? []) as { song_track_id: string; beat_track_id: string; position: number }[];
    const links = (linksRes.data ?? []) as { from_track_id: string; to_track_id: string; relation: string; position: number }[];

    const otherIds = [...new Set([...songBeats.map((r) => r.song_track_id), ...links.map((r) => r.from_track_id)])];
    const others = new Map<string, LinkTrack>();
    if (otherIds.length > 0) {
      const othersRes = await admin.from('tracks').select('id, title, type').in('id', otherIds).eq('org_id', org);
      if (othersRes.error) throw new Error(othersRes.error.message);
      for (const row of (othersRes.data ?? []) as LinkTrack[]) others.set(row.id, row);
    }
    const linked = mergeLinks(trackId, { songBeats, links }, others);

    const required = requiredAudioCapabilities(track, linked, variant);
    if (!orgAudioAllowed(access.capabilities, required)) return json(403, 'Forbidden');

    let stems: OrgAudioStemRow[] = [];
    if (variant.kind === 'stem') {
      const stemsRes = await admin.from('stems').select('vocals_url, drums_url, bass_url, other_url').eq('track_id', trackId);
      if (stemsRes.error) throw new Error(stemsRes.error.message);
      stems = (stemsRes.data ?? []) as OrgAudioStemRow[];
    }
    const source = orgAudioSource(track, variant, stems);
    if (!source) return json(404, 'No audio for this variant');

    const upstream =
      query.data.download === '1'
        ? await streamAudioSource(req, source, orgAudioFilename(track.title, variant, source))
        : await streamAudioPreviewSource(req, source);

    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'private, no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('org audio failed', { orgId: org, trackId, error: errorMessage(err) });
    return json(500, 'Could not load the audio');
  }
}

export async function HEAD(req: NextRequest, ctx: Params) {
  return GET(req, ctx);
}
