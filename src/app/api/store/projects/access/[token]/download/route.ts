import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { streamAudioSource } from '@/lib/audio/stream-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const trackId = req.nextUrl.searchParams.get('track_id');
  const format = req.nextUrl.searchParams.get('format') === 'wav' ? 'wav' : 'mp3';

  if (!trackId) {
    return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const admin = createServiceClient();
    const { data: access, error: aErr } = await admin
      .from('project_access_links')
      .select('project_id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: belongs } = await admin
      .from('project_tracks')
      .select('track_id')
      .eq('project_id', access.project_id)
      .eq('track_id', trackId)
      .maybeSingle();
    if (!belongs) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: track, error: tErr } = await admin
      .from('tracks')
      .select('audio_url, wav_url, title')
      .eq('id', trackId)
      .maybeSingle();
    if (tErr) throw tErr;

    const source = format === 'wav' ? track?.wav_url : track?.audio_url;
    if (!source) {
      return NextResponse.json({ error: `${format.toUpperCase()} unavailable` }, { status: 404 });
    }

    const extMatch = source.match(/\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i);
    const ext = (format === 'wav' ? 'wav' : extMatch?.[1] ?? 'mp3').toLowerCase();
    const filename = `${track?.title || 'track'}.${ext}`;
    return streamAudioSource(req, source, filename);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
