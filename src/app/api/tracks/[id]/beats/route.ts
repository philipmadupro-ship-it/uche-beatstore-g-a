import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { SongBeatsBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { selectIn } from '@/lib/db/chunked-in';
import { SongBeatsNotReadyError, writeSongBeats } from '@/lib/tracks/song-beats-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.tracks.beats');

/**
 * PUT /api/tracks/[id]/beats — { beat_ids } the beats a song is built on,
 * main beat first (mig 132). An empty list clears "Built on". Every beat
 * must belong to the caller; the song never lists itself.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Built on needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;
  const parsed = await readBody(req, SongBeatsBodySchema);
  if (!parsed.ok) return parsed.res;
  const beatIds = parsed.data.beat_ids.filter((b) => b !== id);

  try {
    if (beatIds.length) {
      const owned = await selectIn<{ id: string }>((ids) => admin.from('tracks').select('id').in('id', ids).eq('user_id', userId), beatIds);
      if (owned.length !== beatIds.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const list = await writeSongBeats(admin, userId, id, beatIds);
    const titles = list.length
      ? await selectIn<{ id: string; title: string | null }>((ids) => admin.from('tracks').select('id, title').in('id', ids).eq('user_id', userId), list)
      : [];
    const title = new Map(titles.map((t) => [t.id, t.title ?? 'Untitled']));
    return NextResponse.json({ beats: list.map((b) => ({ id: b, title: title.get(b) ?? 'Untitled' })) });
  } catch (err) {
    if (err instanceof SongBeatsNotReadyError) return NextResponse.json({ error: err.message, migration: '132' }, { status: 503 });
    log.error('song beats write failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
