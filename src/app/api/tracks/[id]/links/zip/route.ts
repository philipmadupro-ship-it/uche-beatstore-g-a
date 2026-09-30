import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { streamAudioSource } from '@/lib/audio/stream-source';
import { loadLinks } from '@/lib/tracks/links-store';
import { BUNDLE_MAX_TRACKS, bundleFileNames, bundleReadme, bundleZipName, linkLabel } from '@/lib/tracks/links';
import { zipStream } from '@/lib/tracks/zip-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const log = createLogger('api.tracks.links.zip');

interface FileRow { id: string; title: string | null; wav_url: string | null; audio_url: string | null }

/**
 * GET /api/tracks/[id]/links/zip — ONE zip of this track and everything
 * linked to it (its beats, instrumental, loops, toplines, versions, and the
 * tracks that link to it), best file of each (WAV when there is one), plus a
 * README saying what each file is. Streams: files go through the same
 * storage path as a single download (lib/audio/stream-source), never a
 * public URL. Owner only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('tracks', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const { data: track } = await admin.from('tracks').select('id, title, beat_track_id').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const links = (await loadLinks(admin, userId, track as { id: string; beat_track_id: string | null })).slice(0, BUNDLE_MAX_TRACKS - 1);
    const ids = [id, ...links.map((l) => l.track.id)];
    const rows = await selectIn<FileRow>((chunk) => admin.from('tracks').select('id, title, wav_url, audio_url').in('id', chunk).eq('user_id', userId), ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const source = (r: FileRow | undefined) => r?.wav_url || r?.audio_url || null;

    const main = byId.get(id);
    if (!source(main)) return NextResponse.json({ error: 'This track has no file to download.' }, { status: 404 });
    const withFiles = links.filter((l) => source(byId.get(l.track.id)));
    const names = bundleFileNames(
      { title: main!.title, source: source(main)! },
      withFiles.map((l) => ({ label: linkLabel(l.relation, l.direction), title: l.track.title, source: source(byId.get(l.track.id))! })),
    );
    const plain = new NextRequest(req.url);
    const open = (src: string, name: string) => async () => {
      const res = await streamAudioSource(plain, src, name);
      if (!res.ok || !res.body) return null;
      return res.body;
    };

    const skipped: string[] = [];
    const entries = [
      { name: names[0], open: open(source(main)!, names[0]) },
      ...withFiles.map((l, i) => ({ name: names[i + 1], open: open(source(byId.get(l.track.id))!, names[i + 1]) })),
    ];
    const readme = {
      name: 'README.txt',
      open: async () => new TextEncoder().encode(
        bundleReadme(main!.title, [
          { file: names[0], label: 'This track' },
          ...withFiles.map((l, i) => ({ file: names[i + 1], label: linkLabel(l.relation, l.direction) })),
        ]) + (skipped.length ? `\nLeft out (file unavailable): ${skipped.join(', ')}\n` : ''),
      ),
    };

    const body = zipStream([...entries, readme], {
      onSkip: (name, reason) => { skipped.push(name); log.warn('zip entry skipped', { id, name, reason }); },
    });
    const filename = bundleZipName(main!.title);
    return new Response(body, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename.replace(/[\r\n"\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    log.error('zip failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
