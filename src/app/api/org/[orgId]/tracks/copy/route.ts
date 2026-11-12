/**
 * POST /api/org/[orgId]/tracks/copy (LABEL-41, D6) — "Use in a label song":
 * copy a recording into THIS label org, with its provenance.
 *
 *   { source: { kind: 'connection', track_id } | { kind: 'producer', track_id }, project_id? }
 *
 *  - `connection`: a recording in a project a CONNECTED artist org shared with
 *    this label, and only if the artist allowed copies (`allow_copies`, the
 *    artist side's switch). The caller reaches it exactly as the audio route
 *    lets them hear it (requireConnectedTrack: active connection, shared
 *    project, their own artist scope, `catalog.read`) and D4 applies with their
 *    own capabilities — they must be allowed to hear it in full.
 *  - `producer`: the caller's OWN producer-app recording (tracks.user_id =
 *    the caller, no org). The producer decides what leaves their library.
 *  Either way the caller needs `catalog.write` in the label org, which must be
 *  a LABEL. Beats, instrumentals, loops and toplines copy; a song (a demo) does
 *  not — a song is made in the label, built on a copied beat.
 *
 * The copy is a NEW track row of the label org (`org_id`, `created_by` = the
 * caller, no `user_id`), its master copied to the label's own private prefix,
 * with `provenance { source_org_id, source_track_id, copied_at, copied_by }`.
 * No live cross-org reference: the source is read, never written, and nothing
 * on the copy follows it afterwards. The source is unchanged (its row, its
 * files, its links). `recording.copied` is an audit event, recorded BEFORE the
 * response in the label org and, for a connection source, in the ARTIST org's
 * feed too (the artist must see their master was copied); if it cannot be
 * written the copy is removed again. 30 copies an hour per person.
 * The copy's preview and peaks are made by the normal private processing job.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { myOrganizations, requireConnectedTrack, requireObjectAccess, requireOrgCapability } from '@/lib/auth/org-access';
import { OrgTrackCopyBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { AuditEventError, recordEvent } from '@/lib/labelos/activity';
import { buildProvenance, isCopyableType } from '@/lib/labelos/connections';
import { orgAudioAllowed } from '@/lib/labelos/org-audio';
import { addTrackToOrgProjects } from '@/lib/labelos/inbox-project-store';
import { orgTrackFacts } from '@/lib/labelos/org-workspace-store';
import { createLogger } from '@/lib/log';
import { CopySourceError, copyMasterToOrg, discardCopy, type CopyOwner } from '@/lib/storage/org-copy';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const log = createLogger('api.org.tracks.copy');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

type SourceRow = {
  id: string;
  title: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  loudness: number | null;
  audio_url: string | null;
  wav_url: string | null;
};
const SOURCE_COLUMNS = 'id, title, type, bpm, key, scale, duration_seconds, loudness, audio_url, wav_url';

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.write');
  if (!access.ok) return access.res;
  if (access.orgKind !== 'label') return json(403, { error: 'Recordings are copied into a label' });
  const parsed = await readBody(req, OrgTrackCopyBodySchema);
  if (!parsed.ok) return parsed.res;
  const { source, project_id: projectId } = parsed.data;
  const { admin } = access;
  // A copy moves a whole master: a small durable budget per person.
  if (!(await rateLimitDurable(`org-copy:${access.userId}`, 30, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many copies. Try again later.' });
  }

  let sourceOrgId: string | null = null;
  let row: SourceRow | null = null;
  try {
    if (projectId) {
      // The destination is a project of THIS org the member may write.
      const dest = await requireObjectAccess({ table: 'projects', id: projectId, cap: 'catalog.write', orgId: access.orgId });
      if (!dest.ok) return dest.res;
    }

    if (source.kind === 'connection') {
      const via = await requireConnectedTrack({ trackId: source.track_id, orgId: access.orgId, cap: 'catalog.read' });
      if (!via.ok) return via.res;
      if (!via.connection.allow_copies) return json(403, { error: 'The artist has not allowed copies' });
      sourceOrgId = via.sourceOrgId;
      const found = await admin.from('tracks').select(SOURCE_COLUMNS).eq('id', source.track_id).eq('org_id', sourceOrgId).maybeSingle();
      if (found.error) throw new Error(found.error.message);
      row = found.data as SourceRow | null;
      if (!row) return json(404, { error: 'Not found' });
      // D4 with the member's own capabilities: they must be allowed to hear it in full.
      const facts = await orgTrackFacts(admin, sourceOrgId, [row.id]);
      if (!orgAudioAllowed(access.capabilities, facts.get(row.id)?.requiredAudio ?? null)) return json(404, { error: 'Not found' });
    } else {
      const found = await admin.from('tracks').select(`${SOURCE_COLUMNS}, user_id, org_id`).eq('id', source.track_id).maybeSingle();
      if (found.error) throw new Error(found.error.message);
      const own = found.data as (SourceRow & { user_id: string | null; org_id: string | null }) | null;
      // Only the producer's own recording: a row of someone else's, or an org row, is the same 404.
      if (!own || own.org_id !== null || own.user_id !== access.userId) return json(404, { error: 'Not found' });
      row = own;
      // The producer's own org, if they have one: the caller's memberships are identity, read through org-access.
      const mine = await myOrganizations();
      if (!mine.ok) return mine.res;
      sourceOrgId = mine.orgs.find((o) => o.kind === 'producer' && o.role === 'owner')?.id ?? null;
    }
  } catch (err) {
    log.error('copy source read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not copy the recording' });
  }

  if (!isCopyableType(row.type)) {
    return json(400, { error: 'Only beats, instrumentals, loops and toplines can be copied. Build the song in the label on a copied beat.' });
  }
  if (!row.audio_url) return json(409, { error: 'That recording has no audio to copy' });

  // Whose files these are: the connected artist org's own prefix, or the producer's own area.
  const owner: CopyOwner = source.kind === 'connection' && sourceOrgId ? { kind: 'org', orgId: sourceOrgId } : { kind: 'producer' };
  const copied: string[] = [];
  let trackId: string | null = null;
  const rollback = async () => {
    if (trackId) {
      const { error } = await admin.from('tracks').delete().eq('id', trackId).eq('org_id', access.orgId);
      if (error) {
        // The row still references the objects: keep them.
        log.error('copy rollback: track delete failed', { trackId, error: error.message });
        return;
      }
    }
    await Promise.all(copied.map((ref) => discardCopy(ref)));
  };

  try {
    const audioUrl = await copyMasterToOrg(row.audio_url, access.orgId, owner);
    copied.push(audioUrl);
    let wavUrl: string | null = null;
    if (row.wav_url) {
      wavUrl = await copyMasterToOrg(row.wav_url, access.orgId, owner).catch((err) => {
        // A WAV that cannot be copied (public URL, missing) is left out: the copy plays from its master.
        if (err instanceof CopySourceError) return null;
        throw err;
      });
      if (wavUrl) copied.push(wavUrl);
    }
    const provenance = buildProvenance({ sourceOrgId, sourceTrackId: row.id, copiedBy: access.userId });
    const inserted = await admin
      .from('tracks')
      .insert({
        user_id: null,
        org_id: access.orgId,
        created_by: access.userId,
        title: row.title ?? 'Untitled',
        type: row.type,
        audio_url: audioUrl,
        wav_url: wavUrl,
        preview_url: null,
        peaks_url: null,
        bpm: row.bpm,
        key: row.key,
        scale: row.scale,
        duration_seconds: row.duration_seconds,
        loudness: row.loudness,
        stems_status: 'none',
        provenance,
      })
      .select('id, title, type')
      .single();
    if (inserted.error || !inserted.data) throw new Error(`Track insert failed: ${inserted.error?.message ?? 'no row'}`);
    trackId = (inserted.data as { id: string }).id;
    if (projectId) await addTrackToOrgProjects(admin, { orgId: access.orgId, trackId, projectIds: [projectId] });

    // Audit-class: the copy does not stand without its event.
    await recordEvent(
      admin,
      { orgId: access.orgId, userId: access.userId },
      'recording.copied',
      { type: 'track', id: trackId, projectId: projectId ?? null },
      { source: source.kind, source_org_id: sourceOrgId, source_track_id: row.id, type: row.type },
    );
    // The artist is the one who must see that their master was copied: the same audit event in THEIR feed
    // (internal: owners / admins). Audit-class like the first; if it cannot be written the copy is removed.
    if (source.kind === 'connection' && sourceOrgId) {
      await recordEvent(
        admin,
        { orgId: sourceOrgId, userId: access.userId },
        'recording.copied',
        { type: 'track', id: row.id },
        { source: 'connection', copied_by_org: access.orgId, type: row.type },
        { visibility: 'internal' },
      );
    }
  } catch (err) {
    await rollback();
    if (err instanceof CopySourceError) return json(422, { error: err.message });
    log.error('recording copy failed', { orgId: access.orgId, error: errorMessage(err), audit: err instanceof AuditEventError });
    return json(500, { error: 'Could not copy the recording' });
  }

  // The label's own private preview and peaks, best effort (the copy plays in full either way).
  try {
    // Loaded here, not at the top: processing is server-only machinery the route does not need until a copy exists.
    const { enqueueUploadProcessingJob, processUploadProcessingJobById } = await import('@/lib/upload/processing');
    const jobId = await enqueueUploadProcessingJob({
      trackId: trackId!,
      userId: access.userId,
      audioUrl: copied[0],
      fileName: `${row.title ?? 'recording'}.${copied[0].split('.').pop() ?? 'mp3'}`,
      clientAnalysis: null,
    });
    if (jobId) {
      after(async () => {
        try {
          await processUploadProcessingJobById(jobId);
        } catch (err) {
          log.warn('copy processing failed; the cron will retry', { error: errorMessage(err) });
        }
      });
    }
  } catch (err) {
    log.error('copy processing enqueue failed', { trackId, error: errorMessage(err) });
  }

  return json(201, {
    track: { id: trackId, title: row.title ?? 'Untitled', type: row.type, provenance: { sourceKind: source.kind, copiedAt: new Date().toISOString() } },
  });
}
