import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership, isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.projects.export');
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/projects/[id]/export
 *
 * Returns a JSON manifest of all downloadable files (WAV + stems) for the
 * project's tracks, signed for immediate download. The client drives the
 * parallel downloads and the ZIP is assembled in the browser via a Web Worker
 * (no server-side memory spike for large projects). Ownership-gated.
 *
 * Response: { project_name, files: [{ name, url, type }] }
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const owner = await requireRowOwnership('projects', id);
    if (!owner.ok) return owner.res;
    const { admin } = owner;

    // Fetch the project name.
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('name')
      .eq('id', id)
      .maybeSingle();
    if (projErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // Get the ordered track list.
    const { data: ptRows, error: ptErr } = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', id)
      .order('position', { ascending: true });
    if (ptErr) throw ptErr;
    const trackIds = (ptRows ?? []).map((r: any) => r.track_id);
    if (!trackIds.length) return NextResponse.json({ project_name: project.name, files: [] });

    // Fetch track audio + stems.
    const { data: tracks, error: tErr } = await admin
      .from('tracks')
      .select('id, title, audio_url, wav_url')
      .in('id', trackIds);
    if (tErr) throw tErr;

    const { data: stems, error: sErr } = await admin
      .from('stems')
      .select('track_id, vocals_url, drums_url, bass_url, other_url')
      .in('track_id', trackIds);
    if (sErr) throw sErr;

    const stemsByTrack = new Map((stems ?? []).map((s: any) => [s.track_id, s]));
    const order = new Map(trackIds.map((tid: string, i: number) => [tid, i]));

    const sorted = [...(tracks ?? [])].sort((a: any, b: any) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );

    const files: { name: string; url: string; type: string }[] = [];
    const ext = (url: string) => url.match(/\.(wav|mp3|flac|aiff|ogg|m4a|webm)[^.]*$/i)?.[1]?.toLowerCase() ?? 'mp3';

    for (const t of sorted as any[]) {
      const title = (t.title || 'track').replace(/[^\w\s-]/g, '').trim();
      const primary = t.wav_url || t.audio_url;
      if (primary) {
        // Return a same-origin proxy URL so the browser can download
        // cross-origin R2 assets as a file (Content-Disposition: attachment).
        const proxyUrl = `/api/audio?src=${encodeURIComponent(primary)}&download=1&filename=${encodeURIComponent(title + '.' + ext(primary))}`;
        files.push({ name: `${title}.${ext(primary)}`, url: proxyUrl, type: 'master' });
      }
      const st = stemsByTrack.get(t.id);
      if (st) {
        for (const [key, label] of [['vocals_url', 'vocals'], ['drums_url', 'drums'], ['bass_url', 'bass'], ['other_url', 'other']] as [string, string][]) {
          const u = (st as any)[key];
          if (u) {
            const proxyUrl = `/api/audio?src=${encodeURIComponent(u)}&download=1&filename=${encodeURIComponent(`${title}_${label}.${ext(u)}`)}`;
            files.push({ name: `${title}_${label}.${ext(u)}`, url: proxyUrl, type: 'stem' });
          }
        }
      }
    }

    return NextResponse.json({ project_name: project.name, files });
  } catch (err) {
    log.error('project export failed', { projectId: id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
