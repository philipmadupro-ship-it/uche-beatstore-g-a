import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { TrackLinkBodySchema, TrackUnlinkBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { addLink, loadLinks, removeLink, TrackLinksNotReadyError } from '@/lib/tracks/links-store';
import { SongBeatsNotReadyError } from '@/lib/tracks/song-beats-store';
import { linkLabel } from '@/lib/tracks/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.tracks.links');

type Admin = Parameters<typeof loadLinks>[0];

async function respond(admin: Admin, userId: string, id: string) {
  const { data: track, error } = await admin.from('tracks').select('id, beat_track_id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const links = await loadLinks(admin, userId, track as { id: string; beat_track_id: string | null });
  return NextResponse.json({ links: links.map((l) => ({ ...l, label: linkLabel(l.relation, l.direction) })) });
}

function failure(err: unknown, id: string) {
  if (err instanceof TrackLinksNotReadyError) return NextResponse.json({ error: err.message, migration: '133' }, { status: 503 });
  if (err instanceof SongBeatsNotReadyError) return NextResponse.json({ error: err.message, migration: '132' }, { status: 503 });
  log.error('links failed', { id, error: errorMessage(err) });
  return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
}

/**
 * GET    /api/tracks/[id]/links — everything linked to this track, one hop:
 *        its beats (song_beats), instrumental, loops, toplines, versions, and
 *        the tracks that link to it, each labelled from this track's side.
 * POST   { track_id, relation, direction? } — link another of your tracks.
 * DELETE { track_id, relation, direction? } — unlink it (master / demo too, so
 *        any link the drawer shows can be removed; POST cannot create them).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ links: [] });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  try {
    return await respond(auth.admin, auth.userId, id);
  } catch (err) {
    return failure(err, id);
  }
}

async function mutate(req: NextRequest, id: string, op: 'add' | 'remove') {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Linking needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  const parsed = op === 'add' ? await readBody(req, TrackLinkBodySchema) : await readBody(req, TrackUnlinkBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_id, relation, direction } = parsed.data;
  if (track_id === id) return NextResponse.json({ error: 'A track cannot be linked to itself.' }, { status: 400 });
  const { admin, userId } = auth;
  try {
    const { data: other } = await admin.from('tracks').select('id').eq('id', track_id).eq('user_id', userId).maybeSingle();
    if (!other) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (op === 'add') await addLink(admin, userId, id, track_id, relation, direction);
    else await removeLink(admin, userId, id, track_id, relation, direction);
    return await respond(admin, userId, id);
  } catch (err) {
    return failure(err, id);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(req, (await params).id, 'add');
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(req, (await params).id, 'remove');
}
