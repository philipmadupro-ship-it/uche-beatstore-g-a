import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { canDeriveMp3 } from '@/lib/audio/mp3-deliverable';
import { ensureTrackMp3, getTrackMp3Status } from '@/lib/audio/mp3-deliverable.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Same ceiling as /api/store/download-file: it runs the same transcode.
export const maxDuration = 120;

const log = createLogger('api.tracks.mp3');

type TrackRow = { id: string; audio_url: string | null };

type Owned = Extract<Awaited<ReturnType<typeof requireRowOwnership>>, { ok: true }>;

async function loadTrack(auth: Owned, id: string) {
  const { data, error } = await auth.admin
    .from('tracks')
    .select('id, audio_url')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (error) throw error;
  return (data as TrackRow | null) ?? null;
}

/**
 * GET  /api/tracks/[id]/mp3 — is the MP3 a lease on this track delivers ready?
 *      { state: 'master' | 'ready' | 'pending' | 'unsupported' | 'no-audio', label, detail, canMake }
 * POST /api/tracks/[id]/mp3 — make it now (otherwise it is made on the first
 *      buyer download). Returns the new status, or 503 if it cannot be made.
 *
 * Producer-only: owner-gated, and the row is re-read with the owner filter
 * because the service client bypasses RLS.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  try {
    const track = await loadTrack(auth, id);
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(await getTrackMp3Status(track));
  } catch (err) {
    log.error('mp3 status failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not check the MP3.' }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  try {
    const track = await loadTrack(auth, id);
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canDeriveMp3(track.audio_url)) {
      return NextResponse.json({ error: 'There is no MP3 to make for this file.' }, { status: 409 });
    }
    const made = await ensureTrackMp3(track);
    if (!made) {
      return NextResponse.json(
        { error: 'The MP3 could not be made. Check that ffmpeg is available (see Audio diagnostics) and that the master is readable.' },
        { status: 503 },
      );
    }
    // Made but not kept (storage down): do not claim it is ready.
    if (made.kind === 'buffer') {
      return NextResponse.json({ error: 'The MP3 was made but could not be stored. Try again.' }, { status: 503 });
    }
    return NextResponse.json(await getTrackMp3Status(track));
  } catch (err) {
    log.error('mp3 make failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not make the MP3.' }, { status: 500 });
  }
}
