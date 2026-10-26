/**
 * POST /api/org/[orgId]/upload/complete (LABEL-14, LABEL-21) — finish an org upload
 * and create what it is: `{ sessionId, analysis?, as }`.
 *
 *  1. The intent is authorised again (../access): `catalog.write` on the
 *     artist or song, in scope. Then the session: this org's key, this caller.
 *  2. The multipart upload is finalised and the bytes are sniffed, exactly as
 *     the producer's `/api/upload/complete` does (same lib helpers).
 *  3. The track row is written by the service role (migration 141 refuses an
 *     org row to any API role): `org_id`, `created_by` = the uploader and NO
 *     `user_id` (142: an org row has no owner, so no producer route reaches
 *     it), the type and stage from the intent (lib/labelos/org-upload).
 *  4. It is placed, in the same request:
 *       - a new song → its artist's Inbox project (ensureInboxProject, Q1);
 *       - material → a `track_links` row from the song (links-store
 *         `addOrgLink`) — the link is what classifies it for D4 — and the
 *         song's projects of this org, so a member scoped to the song's
 *         artist reaches it too (LABEL-12 carry).
 *     Anything failing here deletes the new row (its links and project rows
 *     go by cascade) and the stored object, so no half-made, unplayable
 *     recording is left behind.
 *  5. The processing job is queued and run in after(), as for producer
 *     uploads; it writes the preview and peaks to the PRIVATE bucket because
 *     the row is an org row (lib/upload/processing).
 *
 * The response carries the track as `orgUploadTrackView` — no stored
 * reference, playable through the LABEL-13 route.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { mergeFeatures } from '@/lib/audio/merge';
import { OrgUploadCompleteSchema } from '@/lib/contracts';
import { parseClientAnalysis } from '@/lib/contracts/client-analysis';
import { errorMessage } from '@/lib/errors';
import { addTrackToOrgProjects, ensureInboxProject, orgProjectsOfTrack } from '@/lib/labelos/inbox-project-store';
import { orgUploadTrackFields, orgUploadTrackView, type OrgUploadTrackRow } from '@/lib/labelos/org-upload';
import { createLogger } from '@/lib/log';
import { completeMultipart, listParts } from '@/lib/storage/multipart';
import { deleteStoredObject } from '@/lib/storage/upload';
import { recordEvent } from '@/lib/labelos/activity';
import { deleteSession, getSession, markStatus } from '@/lib/storage/upload-sessions';
import { addOrgLink } from '@/lib/tracks/links-store';
import { enqueueUploadProcessingJob, processUploadProcessingJobById } from '@/lib/upload/processing';
import { parseTitleMetadata } from '@/lib/upload/title-metadata';
import { verifyStoredAudio } from '@/lib/upload/verify-stored-audio';
import { authorizeOrgUploadIntent, orgSessionAuthorizer } from '../access';

export const runtime = 'nodejs';
// Processing runs in after() and shares this budget, as on the producer route.
export const maxDuration = 300;

const log = createLogger('api.org.upload.complete');

type Params = { params: Promise<{ orgId: string }> };

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const parsed = OrgUploadCompleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const member = await requireOrgMember(orgId);
    if (!member.ok) return member.res;
    return json(400, parsed.error.issues[0]?.message ?? 'Invalid body');
  }
  const body = parsed.data;

  const intent = await authorizeOrgUploadIntent(orgId, body.as);
  if (!intent.ok) return intent.res;
  const { access, external } = intent;
  const { admin } = access;
  const org = access.orgId;

  const analysis = parseClientAnalysis(body.analysis);
  if (analysis.rejected.length) log.warn('dropped invalid client analysis fields', { fields: analysis.rejected });
  const clientAnalysis = analysis.analysis;

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(body.sessionId);
  } catch (err) {
    log.error('session lookup failed', { orgId: org, error: errorMessage(err) });
    return json(500, 'Could not finish the upload');
  }
  if (!session) return json(404, 'unknown session');
  const gate = await orgSessionAuthorizer(access)(session);
  if (!gate.ok) return gate.res;
  if (session.status === 'completed') return json(409, 'already completed');
  const fields = orgUploadTrackFields(body.as);
  // The type was fixed at init from the intent; a different intent now is a different upload.
  if (session.type !== fields.type) return json(409, 'This upload was started as something else');

  let completedParts = session.parts;
  try {
    const remote = await listParts({ uploadId: session.uploadId, key: session.key });
    if (remote.length >= completedParts.length) completedParts = remote;
  } catch (err) {
    log.warn('could not reconcile multipart state', { error: errorMessage(err) });
  }
  if (completedParts.length !== session.totalParts) {
    return json(409, `Missing parts (${completedParts.length}/${session.totalParts})`);
  }

  let audioUrl: string;
  try {
    audioUrl = await completeMultipart({ uploadId: session.uploadId, key: session.key, fileName: session.fileName, parts: completedParts });
  } catch (err) {
    log.error('completeMultipart failed', { orgId: org, error: errorMessage(err) });
    return json(500, 'Storage finalize failed');
  }
  const verified = await verifyStoredAudio(audioUrl);
  if (!verified.ok) {
    await markStatus(session.sessionId, 'aborted').catch(() => undefined);
    return json(415, `File does not look like a valid audio file (detected: ${verified.format})`);
  }
  await markStatus(session.sessionId, 'completed');

  const titleMeta = parseTitleMetadata(session.fileName);
  const merged = mergeFeatures({ title: titleMeta, client: clientAnalysis, server: null, audd: null });

  let trackId: string | null = null;
  const rollback = async () => {
    try {
      if (trackId) {
        const { error } = await admin.from('tracks').delete().eq('id', trackId).eq('org_id', org);
        // A row that could not be removed still references the object: keep it.
        if (error) {
          log.error('rollback: track delete failed', { trackId, error: error.message });
          return;
        }
      }
      await deleteStoredObject(audioUrl);
      await markStatus(session.sessionId, 'aborted');
    } catch (err) {
      log.error('rollback failed', { error: errorMessage(err) });
    }
  };

  let row: OrgUploadTrackRow;
  let projectIds: string[];
  try {
    const { data, error } = await admin
      .from('tracks')
      .insert({
        user_id: null,
        org_id: org,
        created_by: access.userId,
        title: titleMeta.title,
        type: fields.type,
        song_stage: fields.song_stage,
        audio_url: audioUrl,
        preview_url: null,
        peaks_url: null,
        ...merged,
        stems_status: 'none',
      })
      .select('id, org_id, title, type, song_stage, bpm, key, scale, duration_seconds')
      .single();
    if (error || !data) throw new Error(`Track insert failed: ${error?.message ?? 'no row'}`);
    row = data as OrgUploadTrackRow;
    trackId = row.id;

    if (body.as.kind === 'song') {
      const inbox = await ensureInboxProject(admin, { orgId: org, contactId: body.as.contactId });
      projectIds = [inbox.projectId];
    } else {
      await addOrgLink(admin, { orgId: org, fromId: body.as.songId, toId: row.id, relation: body.as.relation });
      // An external member's version goes into THEIR project(s) only (LABEL-21,
      // planExternalUpload); an org member's into every project of the song.
      projectIds = external ? external.projectIds : await orgProjectsOfTrack(admin, org, body.as.songId);
    }
    await addTrackToOrgProjects(admin, { orgId: org, trackId: row.id, projectIds });
  } catch (err) {
    log.error('org upload placement failed', { orgId: org, error: errorMessage(err) });
    await rollback();
    return json(500, 'Could not save the upload');
  }

  // Everyday events, best effort (the upload is done either way). A new song
  // is `song.created` (its audio is the song's mix, not a second event); material
  // linked to an existing song is `recording.uploaded`. Both are creative-side
  // work: the default visibility (D5) shows them to the song's artist.
  const who = { orgId: org, userId: access.userId };
  if (body.as.kind === 'song') {
    await recordEvent(
      admin,
      who,
      'song.created',
      { type: 'track', id: row.id, artistId: body.as.contactId, projectId: projectIds[0] ?? null, songId: row.id },
      { title: row.title, song_stage: row.song_stage },
    );
  } else {
    await recordEvent(
      admin,
      who,
      'recording.uploaded',
      { type: 'track', id: row.id, projectId: projectIds[0] ?? null, songId: body.as.songId },
      { relation: body.as.relation, type: row.type, ...(external ? { by: 'project_member' } : {}) },
    );
  }

  try {
    const jobId = await enqueueUploadProcessingJob({
      trackId: row.id,
      userId: access.userId,
      audioUrl,
      fileName: session.fileName,
      clientAnalysis,
    });
    if (jobId) {
      after(async () => {
        try {
          await processUploadProcessingJobById(jobId);
        } catch (err) {
          log.warn('immediate processing failed; the cron will retry', { error: errorMessage(err) });
        }
      });
    }
  } catch (err) {
    // The track exists and plays in full; the preview / peaks wait for a retry.
    log.error('processing enqueue failed', { trackId: row.id, error: errorMessage(err) });
  }
  await deleteSession(session.sessionId).catch(() => undefined);

  const linkedTo = body.as.kind === 'link' ? { songId: body.as.songId, relation: body.as.relation } : null;
  return NextResponse.json({ success: true, track: orgUploadTrackView(row, { projectIds, linkedTo }), processing: 'queued' });
}
