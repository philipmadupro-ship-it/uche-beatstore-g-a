import { NextRequest, NextResponse } from 'next/server';
import { uploadAudio, uploadPeaksSidecar } from '@/lib/storage/upload';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import type { AudioFeatures } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import { isSupabaseConfigured, insert, update, getAll } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { titleFromFilename, nextVersionLabel } from '@/lib/naming';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.upload');

export const runtime = 'nodejs';
export const maxDuration = 60;

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

/** Magic-byte check: confirms bytes look like a valid audio format. */
function sniffAudio(buf: Buffer): { ok: boolean; format: string } {
  if (buf.length < 12) return { ok: false, format: 'too-small' };
  const h = buf.subarray(0, 12);
  const s4 = (start: number) => h.subarray(start, start + 4).toString('latin1');
  const s3 = (start: number) => h.subarray(start, start + 3).toString('latin1');

  if (s4(0) === 'RIFF' && s4(8) === 'WAVE') return { ok: true, format: 'wav' };
  if (s3(0) === 'ID3') return { ok: true, format: 'mp3' };
  // MPEG frame sync (MP3 without ID3)
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return { ok: true, format: 'mp3' };
  if (s4(0) === 'fLaC') return { ok: true, format: 'flac' };
  if (s4(0) === 'FORM' && s4(8) === 'AIFF') return { ok: true, format: 'aiff' };
  if (s4(0) === 'OggS') return { ok: true, format: 'ogg' };
  // M4A: ftyp... at offset 4
  if (s4(4) === 'ftyp') return { ok: true, format: 'm4a' };
  return { ok: false, format: 'unknown' };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const type = (formData.get('type') as string) || 'instrumental';
    const projectId = (formData.get('projectId') as string | null) || (formData.get('playlistId') as string | null);
    const clientAnalysisRaw = formData.get('analysis') as string | null;
    const replaceTrackId = formData.get('trackId') as string | null;

    // 1. Basic validation
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB, max ${MAX_BYTES / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported extension ".${ext}". Supported: ${ALLOWED_EXT.join(', ')}` },
        { status: 415 }
      );
    }

    // 2. Read into buffer and sniff magic bytes
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sniff = sniffAudio(buffer);
    if (!sniff.ok) {
      return NextResponse.json(
        { error: `File does not look like a valid audio file (detected: ${sniff.format})` },
        { status: 415 }
      );
    }

    const safeContentType = detectContentType(ext, file.type);

    // 3. Parse optional client analysis
    let clientAnalysis: Partial<AudioFeatures> | null = null;
    if (clientAnalysisRaw) {
      try { clientAnalysis = JSON.parse(clientAnalysisRaw) as Partial<AudioFeatures>; } catch {}
    }

    // 4. Upload to storage
    let audioUrl = '';
    try {
      audioUrl = await uploadAudio(buffer, file.name, safeContentType);
    } catch (err) {
      log.error('Storage upload failed:', { error: errorMessage(err) });
      return NextResponse.json(
        { error: `Storage error: ${errorMessage(err) || 'could not save file'}` },
        { status: 500 }
      );
    }

    // 5. Analysis (client > server fallback)
    let serverAnalysis: AudioFeatures | null = null;
    if (!clientAnalysis) {
      try {
        serverAnalysis = await analyzeAudio(buffer);
      } catch (err) {
        log.warn('Server analysis failed, using nulls:', { error: errorMessage(err) });
        serverAnalysis = { bpm: null, key: null, scale: null, loudness: null, duration: null };
      }
    }

    let audd = { danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 };
    try {
      audd = await getAuddFeatures(buffer, file.name);
    } catch (err) {
      log.warn('AudD features failed, using zeros:', { error: errorMessage(err) });
    }

    const titleFromName = titleFromFilename(file.name);

    // Waveform peaks (best-effort sidecar). Failures don't block upload.
    let peaksUrl: string | null = null;
    try {
      const peaks = await extractPeaks(buffer);
      if (peaks) {
        peaksUrl = await uploadPeaksSidecar(audioUrl, JSON.stringify(peaks));
      }
    } catch (err) {
      log.warn('Peaks extraction/upload failed, continuing without:', { error: errorMessage(err) });
    }

    const merged = mergeFeatures({ client: clientAnalysis, server: serverAnalysis, audd });
    const trackData = {
      title: titleFromName,
      type,
      audio_url: audioUrl,
      peaks_url: peaksUrl,
      ...merged,
      stems_status: 'none' as const,
    };

    // 6. Persist: replace-with-versioning OR insert new
    let track: Record<string, unknown> | null = null;

    if (isSupabaseConfigured()) {
      try {
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id || null;

        if (replaceTrackId) {
          // Ownership gate before ANY mutation against the target track.
          // Pre-fix this branch only used the cookie client, which leaves
          // the actual write subject to whatever RLS happens to be —
          // and after migration 010, RLS allows owner OR null-owner.
          // Net effect: any authenticated user could overwrite any
          // null-owner track by submitting `trackId=<their-uuid>` in
          // the upload form. requireRowOwnership rejects mismatches
          // explicitly with a 403 before we touch storage or DB.
          const { requireRowOwnership } = await import('@/lib/db');
          const owner = await requireRowOwnership('tracks', replaceTrackId);
          if (!owner.ok) return owner.res;

          // Snapshot current state into track_versions BEFORE overwriting
          const { data: existing } = await supabase
            .from('tracks')
            .select('*')
            .eq('id', replaceTrackId)
            .single();

          if (existing) {
            const { data: vs } = await supabase
              .from('track_versions')
              .select('version_number')
              .eq('track_id', replaceTrackId);
            const { number, label } = nextVersionLabel(vs ?? []);

            await supabase.from('track_versions').insert({
              track_id: replaceTrackId,
              version_number: number,
              version_label: label,
              audio_url: existing.audio_url,
              duration_seconds: existing.duration_seconds,
              bpm: existing.bpm,
              key: existing.key,
              scale: existing.scale,
              loudness: existing.loudness,
              energy: existing.energy,
              danceability: existing.danceability,
              valence: existing.valence,
              acousticness: existing.acousticness,
              notes: existing.notes,
              created_by: userId,
            });
          }

          const { data, error } = await supabase
            .from('tracks')
            .update({ ...trackData, stems_status: 'none' })
            .eq('id', replaceTrackId)
            .select()
            .single();
          if (error) throw new Error(error.message);
          track = data;
        } else {
          const { data, error: trackError } = await supabase
            .from('tracks')
            .insert({ user_id: userId, ...trackData })
            .select()
            .single();
          if (trackError) throw new Error(`DB Insert Error: ${trackError.message}`);
          track = data;

          if (projectId) {
            const savedTrack = track;
            const trackId = savedTrack && typeof savedTrack.id === 'string' ? savedTrack.id : null;
            if (!trackId) throw new Error('Upload saved without a track id');
            await attachTrackToDestination(supabase, projectId, trackId, userId);
          }
        }
      } catch (err) {
        log.error('Supabase op failed, falling back to local store:', { error: errorMessage(err) });
        const message = errorMessage(err) || 'Database save failed';
        if (/destination|attach/i.test(message)) {
          const status = /forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500;
          return NextResponse.json({ error: message }, { status });
        }
        track = writeLocal(trackData, replaceTrackId, projectId);
      }
    } else {
      track = writeLocal(trackData, replaceTrackId, projectId);
    }

    return NextResponse.json({ success: true, track }, { status: 200 });
  } catch (error) {
    log.error('Upload Error:', { error: errorMessage(error) });
    return NextResponse.json(
      { error: errorMessage(error) || 'Unknown upload error' },
      { status: 500 }
    );
  }
}

async function attachTrackToDestination(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  destinationId: string,
  trackId: string,
  userId: string | null,
) {
  const ownsDestination = (row: { user_id?: string | null } | null) => {
    if (!row) return false;
    return !row.user_id || Boolean(userId && row.user_id === userId);
  };

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', destinationId)
    .maybeSingle();
  if (projectError) throw new Error(`Project lookup failed: ${projectError.message}`);
  if (project) {
    if (!ownsDestination(project)) throw new Error('Forbidden project destination');
    const { error } = await supabase.from('project_tracks').insert({
      project_id: destinationId,
      track_id: trackId,
      role: 'main',
      position: 0,
    });
    if (error) throw new Error(`Project attach failed: ${error.message}`);
    return;
  }

  const { data: playlist, error: playlistError } = await supabase
    .from('playlists')
    .select('id,user_id')
    .eq('id', destinationId)
    .maybeSingle();
  if (playlistError) throw new Error(`Playlist lookup failed: ${playlistError.message}`);
  if (playlist) {
    if (!ownsDestination(playlist)) throw new Error('Forbidden playlist destination');
    const { error } = await supabase.from('playlist_tracks').insert({
      playlist_id: destinationId,
      track_id: trackId,
      position: 0,
    });
    if (error) throw new Error(`Playlist attach failed: ${error.message}`);
    return;
  }

  throw new Error('Upload destination not found');
}

function writeLocal(
  trackData: Record<string, unknown>,
  replaceTrackId: string | null,
  projectId: string | null,
): Record<string, unknown> | null {
  if (replaceTrackId) {
    const existingTracks = getAll('tracks') as Record<string, unknown>[];
    const existing = existingTracks.find((t) => t.id === replaceTrackId);
    if (existing) {
      const vs = (getAll('track_versions') as Record<string, unknown>[])
        .filter((v) => v.track_id === replaceTrackId)
        .map((v) => ({ version_number: Number(v.version_number) || 0 }));
      const { number, label } = nextVersionLabel(vs);
      insert('track_versions', {
        track_id: replaceTrackId,
        version_number: number,
        version_label: label,
        audio_url: existing.audio_url,
        duration_seconds: existing.duration_seconds,
        bpm: existing.bpm,
        key: existing.key,
        scale: existing.scale,
        loudness: existing.loudness,
        energy: existing.energy,
        danceability: existing.danceability,
        valence: existing.valence,
        acousticness: existing.acousticness,
        notes: existing.notes,
        created_by: null,
      });
    }
    return update('tracks', replaceTrackId, { ...trackData, stems_status: 'none' });
  }

  const t = insert('tracks', {
    user_id: 'local-user',
    ...trackData,
    rating: null,
    cover_url: null,
    notes: '',
  }) as Record<string, unknown>;
  if (projectId) {
    // Try project_tracks first, fall back to playlist_tracks
    const projects = getAll('projects') as Record<string, unknown>[];
    const isProject = projects.some((p) => p.id === projectId);
    if (isProject) {
      insert('project_tracks', {
        project_id: projectId,
        track_id: t.id,
        role: 'main',
        position: 0,
        added_at: new Date().toISOString(),
      });
    } else {
      insert('playlist_tracks', {
        playlist_id: projectId,
        track_id: t.id,
        position: 0,
      });
    }
  }
  return t;
}
