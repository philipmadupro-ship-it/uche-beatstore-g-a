/**
 * GET /api/org/[orgId]/audio/[trackId]?variant=preview|peaks|full|wav|stem:<name>[&download=1]
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
 *     inbound links (song_beats, track_links, a song's beat_track_id — the
 *     rows mergeLinks reads, but undeduplicated) give its recording kinds
 *     (lib/labelos/org-audio), and the member needs every audio
 *     capability those kinds — and a stem variant — call for. Unclassified
 *     material needs a capability nobody has: 403 for everyone.
 *     A song that is an item of a release (not cancelled) is its own
 *     FINISHED mix (06 §2.3, LABEL-16); before migration 144 there are no
 *     releases, so the lookup failing on a missing table reads as "not on one".
 *     `peaks` (the waveform sidecar, LABEL-14) needs what the audio needs.
 *  3. The variant names a column of the row (or a `stems` row). Its stored
 *     reference is streamed through lib/audio/stream-source, which forwards
 *     Range (206 + Content-Range from R2), and only from the PRIVATE bucket
 *     (orgAudioSourceAllowed, D8). Nothing is presigned, so no URL —
 *     private or public — ever reaches the client, in JSON or a Location.
 *
 * External project members (LABEL-21, 06 §2.6): a person admitted to a
 * project through `project_members` may hear, and per role download, THE
 * RECORDINGS OF THAT PROJECT — a track that sits in a project they are a live
 * member of, in the route's org; anything else is the same 404 a stranger
 * gets. They are not org members, so D4's audio classes do not apply to
 * them; `externalCan` decides, per request, read live:
 *   - stream (preview, peaks, the master in the player)  → `listen`
 *   - `download=1`, the WAV, a stem                       → `download_masters`
 *     (viewer / commenter only when the membership allows downloads)
 * Handing the file over is AUDITED: `recording.downloaded` is recorded BEFORE
 * the first byte (audit-class — if the event cannot be written the file is
 * not served, 500). Only GET records; HEAD streams nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTrackActor } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { streamAudioPreviewSource, streamAudioSource } from '@/lib/audio/stream-source';
import { OrgAudioQuerySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import {
  inboundLinks,
  orgAudioAllowed,
  orgAudioFilename,
  orgAudioSource,
  orgAudioSourceAllowed,
  parseOrgAudioVariant,
  requiredAudioCapabilities,
  type OrgAudioStemRow,
} from '@/lib/labelos/org-audio';
import { AuditEventError, recordEvent } from '@/lib/labelos/activity';
import { externalAudioAction, externalAudioIsAudited, externalMayAny, membershipsGranting } from '@/lib/labelos/project-members';
import { countsAsOnRelease } from '@/lib/labelos/releases';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { isR2Configured } from '@/lib/local-store';
import { createLogger } from '@/lib/log';

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
  peaks_url: string | null;
};

const json = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, ctx: Params) {
  return serve(req, ctx, { head: false });
}

async function serve(req: NextRequest, { params }: Params, opts: { head: boolean }) {
  const { orgId, trackId } = await params;
  const actor = await requireTrackActor({ trackId, orgId, cap: 'catalog.read' });
  if (!actor.ok) return actor.res;

  const query = OrgAudioQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return json(400, query.error.issues[0]?.message ?? 'Invalid query');
  const variant = parseOrgAudioVariant(query.data.variant);
  if (!variant) return json(400, 'Unknown audio variant');

  const { admin } = actor.access;
  const org = actor.kind === 'org' ? actor.access.object.orgId : actor.access.orgId;
  try {
    // Independent reads in one round trip. Only links INTO this track
    // classify it (lib/labelos/org-audio); the stems row only for a stem. An
    // external member's access is the §2.6 table, not D4's classes, so the
    // link reads that only classification needs are skipped for them — a
    // player asks for the same recording in many Range requests.
    const noRows = Promise.resolve({ data: [] as unknown[], error: null });
    const [trackRes, beatsRes, linksRes, mainBeatRes, stemsRes] = await Promise.all([
      admin
        .from('tracks')
        .select('id, title, type, song_stage, audio_url, wav_url, preview_url, peaks_url')
        .eq('id', trackId)
        .eq('org_id', org)
        .maybeSingle(),
      actor.kind === 'external' ? noRows : admin.from('song_beats').select('song_track_id').eq('beat_track_id', trackId),
      actor.kind === 'external' ? noRows : admin.from('track_links').select('from_track_id, relation').eq('to_track_id', trackId),
      actor.kind === 'external' ? noRows : admin.from('tracks').select('id').eq('beat_track_id', trackId).eq('org_id', org),
      variant.kind === 'stem'
        ? admin.from('stems').select('vocals_url, drums_url, bass_url, other_url').eq('track_id', trackId).eq('status', 'done')
        : Promise.resolve({ data: [] as OrgAudioStemRow[], error: null }),
    ]);
    for (const r of [trackRes, beatsRes, linksRes, mainBeatRes, stemsRes]) if (r.error) throw new Error(r.error.message);
    const row = trackRes.data as TrackRow | null;
    if (!row) return json(404, 'Not found');
    // Only an org member's access depends on D4's classes, which need the
    // release lookup; an external member's is the §2.6 table.
    const track = {
      ...row,
      on_release: actor.kind === 'org' && row.type === 'song' ? await songIsOnRelease(admin, org, trackId) : false,
    };

    const raw = {
      songBeats: (beatsRes.data ?? []) as { song_track_id: string }[],
      links: (linksRes.data ?? []) as { from_track_id: string; relation: string }[],
      mainBeatOf: ((mainBeatRes.data ?? []) as { id: string }[]).map((r) => r.id),
    };
    const fromIds = [...new Set([...raw.songBeats.map((r) => r.song_track_id), ...raw.mainBeatOf, ...raw.links.map((r) => r.from_track_id)])];
    const types = new Map<string, string | null>();
    if (fromIds.length > 0) {
      const fromRes = await admin.from('tracks').select('id, type').in('id', fromIds).eq('org_id', org);
      if (fromRes.error) throw new Error(fromRes.error.message);
      for (const row of (fromRes.data ?? []) as { id: string; type: string | null }[]) types.set(row.id, row.type);
    }

    const download = query.data.download === '1';
    let audited: { projectId: string; role: string } | null = null;
    if (actor.kind === 'external') {
      const action = externalAudioAction(variant, download);
      if (!externalMayAny(actor.access.memberships, action)) return json(403, 'Forbidden');
      if (externalAudioIsAudited(action)) {
        const granting = membershipsGranting(actor.access.memberships, action)[0];
        audited = { projectId: granting.projectId, role: granting.role };
      }
    } else {
      const required = requiredAudioCapabilities(track, inboundLinks(raw, types), variant);
      if (!orgAudioAllowed(actor.access.capabilities, required)) return json(403, 'Forbidden');
    }

    const stems = (stemsRes.data ?? []) as OrgAudioStemRow[];
    const source = orgAudioSource(track, variant, stems);
    if (!source) return json(404, 'No audio for this variant');
    // Private until released (D8): never stream an org file from the public bucket.
    // "No private bucket" means what storage means by it: R2 not configured.
    if (!orgAudioSourceAllowed(source, isR2Configured() ? process.env.R2_PRIVATE_BUCKET_NAME : null)) {
      log.warn('org audio source outside the private bucket', { orgId: org, trackId, variant: variant.kind });
      return json(403, 'Source not allowed');
    }

    // 06 §6: an external member's download is an audit event, written first —
    // a download nobody can account for does not happen.
    if (audited && !opts.head) {
      await recordEvent(
        admin,
        { orgId: org, userId: actor.access.userId },
        'recording.downloaded',
        { type: 'track', id: trackId, projectId: audited.projectId },
        { variant: variant.kind === 'stem' ? `stem:${variant.stem}` : variant.kind, role: audited.role, by: 'project_member' },
      );
    }

    const upstream = download
      ? await streamAudioSource(req, source, orgAudioFilename(track.title, variant, source))
      : await streamAudioPreviewSource(req, source);

    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'private, no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error('org audio failed', { orgId: org, trackId, error: errorMessage(err), audit: err instanceof AuditEventError });
    return json(500, 'Could not load the audio');
  }
}

/**
 * Is this song an item of a release that is not cancelled (LABEL-16)? Only
 * a song's own audio depends on it, so only songs ask. Before migration 144
 * there is no release table, which means no release.
 */
async function songIsOnRelease(admin: AdminClient, org: string, trackId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('release_items')
    .select('release_id, releases!inner(state)')
    .eq('song_track_id', trackId)
    .eq('org_id', org);
  if (error) {
    if (isMissingSchema(error)) return false;
    throw new Error(error.message);
  }
  return countsAsOnRelease((data ?? []) as unknown as { releases: { state: string } | null }[]);
}

/** Headers only: the storage stream GET opened is cancelled, never read. */
export async function HEAD(req: NextRequest, ctx: Params) {
  const res = await serve(req, ctx, { head: true });
  await res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: res.headers });
}
