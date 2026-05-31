import { NextRequest, NextResponse } from 'next/server';
import { uploadAudio } from '@/lib/storage/upload';
import {
  isSupabaseConfigured,
  requireRowOwnership,
  createServiceClient,
  query,
  update,
  insert,
} from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { autoDeliverStems } from '@/lib/stems/auto-deliver';

const log = createLogger('api.tracks.stems.upload');
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/tracks/[id]/stems/upload
 *
 * Manual stem upload. The producer/engineer flow: a finished song the
 * user wants to send out for mixing. They already have the stems
 * exported from their DAW; this endpoint lets them attach those stems
 * to a track without running the Moises split job.
 *
 * Multipart body:
 *   - file: the audio file (one stem)
 *   - stemType: 'vocals' | 'drums' | 'bass' | 'other'
 *
 * Caller invokes this once per stem (so the UI can show per-file
 * progress and the user can re-upload a single stem if they got one
 * wrong).
 *
 * Behavior:
 *   - Ownership-gated via requireRowOwnership on the parent track
 *   - Uploads the file to R2 alongside the original track audio
 *   - Upserts the stems row for this track, sets the per-stem URL +
 *     status='done', and stamps tracks.stems_status='done'
 *   - Returns { url, stemType } so the client can render the result
 *
 * Limits: 100MB per stem (same as track uploads). Allowed extensions
 * are the standard audio set. Anything else returns 400 with a
 * specific reason so the user knows why their stem was rejected.
 */
const STEM_TYPES = ['vocals', 'drums', 'bass', 'other'] as const;
type StemType = (typeof STEM_TYPES)[number];
const STEM_COLUMNS: Record<StemType, 'vocals_url' | 'drums_url' | 'bass_url' | 'other_url'> = {
  vocals: 'vocals_url',
  drums: 'drums_url',
  bass: 'bass_url',
  other: 'other_url',
};

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXT = ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'];

function detectContentType(ext: string, fallback: string): string {
  switch (ext) {
    case 'mp3':  return 'audio/mpeg';
    case 'wav':  return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'm4a':  return 'audio/mp4';
    case 'ogg':  return 'audio/ogg';
    default:     return fallback || 'application/octet-stream';
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const stemType = (formData.get('stemType') as string | null)?.toLowerCase();

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!stemType || !STEM_TYPES.includes(stemType as StemType)) {
      return NextResponse.json(
        { error: `stemType must be one of: ${STEM_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB) — max 100MB` },
        { status: 400 },
      );
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type ".${ext}". Use one of: ${ALLOWED_EXT.join(', ')}` },
        { status: 400 },
      );
    }

    // Ownership gate — the user must own the parent track. The stems
    // row inherits its security from the track since the table has no
    // user_id column of its own.
    let admin: ReturnType<typeof createServiceClient> | null = null;
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', trackId);
      if (!owner.ok) return owner.res;
      admin = owner.admin;
    }

    // Upload to R2 under a stems/ subfolder so the original track audio
    // and the user's stems don't share a flat namespace.
    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = detectContentType(ext, file.type);
    const safeStem = (stemType as StemType);
    const fileName = `stems/${trackId}-${safeStem}.${ext}`;
    const url = await uploadAudio(buffer, fileName, contentType);

    // Persist. The stems row is a single-per-track record holding all
    // four URLs; we upsert against track_id. status='done' is a
    // user-uploaded marker (vs. 'pending' which Moises sets while the
    // split job is running).
    const column = STEM_COLUMNS[safeStem];

    if (isSupabaseConfigured() && admin) {
      // Look up the existing stems row (if any). One row per track —
      // composite-style insert-or-update.
      const { data: existing } = await admin
        .from('stems')
        .select('id')
        .eq('track_id', trackId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await admin
          .from('stems')
          .update({ [column]: url, status: 'done', job_id: existing.id })
          .eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin
          .from('stems')
          .insert({
            track_id: trackId,
            [column]: url,
            status: 'done',
            // job_id is required NOT NULL on some deployments; stamp
            // a synthetic marker so manual uploads stay distinguishable
            // from real Moises jobs in audit queries.
            job_id: `manual:${Date.now()}`,
          });
        if (error) throw new Error(error.message);
      }

      // Track-level stems_status enum mirrors the stems row's status
      // for the library list view's "Stems" badge.
      await admin.from('tracks').update({ stems_status: 'done' }).eq('id', trackId);

      // Auto-deliver to any buyer awaiting stems for this track. Idempotent
      // (stems_delivery_email_sent guards re-sends), best-effort — never blocks
      // the upload response.
      await autoDeliverStems(admin, trackId);
    } else {
      // Local-store path — same shape, in-memory.
      const existing = query('stems', (s) => (s as { track_id: string }).track_id === trackId)
        .sort((a, b) => String((b as { created_at?: string }).created_at ?? '').localeCompare(String((a as { created_at?: string }).created_at ?? '')))[0] as { id?: string } | undefined;
      if (existing?.id) {
        update('stems', existing.id, { [column]: url, status: 'done' });
      } else {
        insert('stems', {
          track_id: trackId,
          [column]: url,
          status: 'done',
          job_id: `manual:${Date.now()}`,
        });
      }
      update('tracks', trackId, { stems_status: 'done' });
    }

    return NextResponse.json({ url, stemType: safeStem });
  } catch (err) {
    log.error('stem upload failed', { trackId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
