import { NextRequest, NextResponse, after } from 'next/server';
import { completeMultipart, readAssembledBuffer } from '@/lib/storage/multipart';
import { getSession, markStatus, deleteSession } from '@/lib/storage/upload-sessions';
import { createServiceClient } from '@/lib/auth/ownership';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import type { AudioFeatures } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import { makeTruncatedPreview } from '@/lib/audio/preview';
import { uploadPeaksSidecar, uploadPreviewAsset } from '@/lib/storage/upload';
import { isSupabaseConfigured, insert, update, getAll } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { titleFromFilename, nextVersionLabel } from '@/lib/naming';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.upload.complete');

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId: string = body.sessionId;
    const clientAnalysis = body.analysis ?? null;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }
    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    }
    if (session.status === 'completed') {
      return NextResponse.json({ error: 'already completed' }, { status: 409 });
    }
    if (session.parts.length !== session.totalParts) {
      return NextResponse.json(
        { error: `Missing parts (${session.parts.length}/${session.totalParts})` },
        { status: 409 }
      );
    }

    // 1. Finalize the multipart upload
    let audioUrl = '';
    try {
      audioUrl = await completeMultipart({
        uploadId: session.uploadId,
        key: session.key,
        fileName: session.fileName,
        parts: session.parts,
      });
    } catch (err) {
      log.error('completeMultipart failed:', { error: errorMessage(err) });
      return NextResponse.json(
        { error: `Storage finalize failed: ${errorMessage(err)}` },
        { status: 500 }
      );
    }

    markStatus(sessionId, 'completed');

    // Analysis is DEFERRED (scheduled via `after()` once the row exists), so
    // this request returns the moment the upload is finalized + written.
    // Blocking here on AudD (an external API) + peaks decode is what made a
    // 17-file batch crawl. The initial row carries whatever the client already
    // computed (BPM/key from analyze.client); the "vibe" fields + peaks fill in
    // a moment later via the background patch below.
    const merged = mergeFeatures({ client: clientAnalysis, server: null, audd: null });
    const trackData = {
      title: titleFromFilename(session.fileName),
      type: session.type,
      audio_url: audioUrl,
      peaks_url: null as string | null,
      ...merged,
      stems_status: 'none' as const,
    };

    // 3. Persist track row (replace-with-versioning OR insert new)
    let track: Record<string, unknown> | null = null;

    if (isSupabaseConfigured()) {
      try {
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id || session.userId || null;
        // Never persist an owner-less track from an upload (init now requires
        // auth, so this only fires if the session lost its owner). Bail before
        // creating an orphan null-owner row the catalogue would treat as demo.
        if (!userId) {
          return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        if (session.replaceTrackId) {
          // Same auth gate as /api/upload/route.ts — verify the caller
          // owns the target before overwriting. Without this, a
          // legitimate multipart session id paired with a forged
          // `replaceTrackId` from a different user lets an attacker
          // replace audio they don't own.
          const { requireRowOwnership } = await import('@/lib/db');
          const owner = await requireRowOwnership('tracks', session.replaceTrackId);
          if (!owner.ok) return owner.res;

          const { data: existing } = await supabase
            .from('tracks')
            .select('*')
            .eq('id', session.replaceTrackId)
            .single();
          if (existing) {
            const { data: vs } = await supabase
              .from('track_versions')
              .select('version_number')
              .eq('track_id', session.replaceTrackId);
            const { number, label } = nextVersionLabel(vs ?? []);
            await supabase.from('track_versions').insert({
              track_id: session.replaceTrackId,
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
            .eq('id', session.replaceTrackId)
            .select()
            .single();
          if (error) throw new Error(error.message);
          track = data;
        } else {
          const { data, error } = await supabase
            .from('tracks')
            .insert({ user_id: userId, ...trackData })
            .select()
            .single();
          if (error) throw new Error(`DB Insert Error: ${error.message}`);
          track = data;

          if (session.projectId) {
            const savedTrack = track;
            const trackId = savedTrack && typeof savedTrack.id === 'string' ? savedTrack.id : null;
            if (!trackId) throw new Error('Upload saved without a track id');
            await attachTrackToDestination(supabase, session.projectId, trackId, userId);
          }
        }
      } catch (err) {
        log.error('Supabase op failed, falling back to local store:', { error: errorMessage(err) });
        const message = errorMessage(err) || 'Database save failed';
        if (/destination|attach/i.test(message)) {
          const status = /forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500;
          return NextResponse.json({ error: message }, { status });
        }
        track = writeLocal(trackData, session.replaceTrackId, session.projectId);
      }
    } else {
      track = writeLocal(trackData, session.replaceTrackId, session.projectId);
    }

    deleteSession(sessionId);

    // Heavy analysis runs AFTER the response is sent (Next 16 `after`): server
    // analysis (only when the client didn't), AudD, and peaks, then a patch of
    // the freshly-written row. Non-fatal — the track keeps its client-side
    // features and the producer can re-analyze if this fails.
    const analyzedTrackId =
      (track && typeof track.id === 'string' && track.id) || session.replaceTrackId || null;
    if (analyzedTrackId) {
      try {
        after(() =>
          runDeferredAnalysis({
            trackId: analyzedTrackId,
            audioUrl,
            fileName: session.fileName,
            clientAnalysis,
          }),
        );
      } catch {
        // `after` requires a request scope; outside one (tests/edge) just skip
        // the background pass — the row already has the client-side features.
      }
    }

    return NextResponse.json({ success: true, track });
  } catch (err) {
    log.error('upload/complete error:', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'complete failed' }, { status: 500 });
  }
}

/**
 * Background analysis, run via `after()` once the row exists and the response
 * is sent. Recomputes the heavy features (server analysis fallback, AudD vibe
 * fields, waveform peaks) and patches the track. Every step is best-effort:
 * the row already has the client-side BPM/key, so a failure here just leaves
 * the vibe fields/peaks unfilled rather than blocking the upload.
 */
async function runDeferredAnalysis(params: {
  trackId: string;
  audioUrl: string;
  fileName: string;
  clientAnalysis: Partial<AudioFeatures> | null;
}) {
  const { trackId, audioUrl, fileName, clientAnalysis } = params;
  try {
    const buffer = await readAssembledBuffer(audioUrl).catch(() => null);
    if (!buffer) return;

    let serverAnalysis: AudioFeatures | null = null;
    if (!clientAnalysis) {
      try { serverAnalysis = await analyzeAudio(buffer); } catch { /* keep nulls */ }
    }

    let audd = { danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 };
    try { audd = await getAuddFeatures(buffer, fileName); } catch { /* keep zeros */ }

    let peaksUrl: string | null = null;
    try {
      const peaks = await extractPeaks(buffer);
      if (peaks) peaksUrl = await uploadPeaksSidecar(audioUrl, JSON.stringify(peaks));
    } catch { /* waveform falls back to client decode */ }

    const merged = mergeFeatures({ client: clientAnalysis, server: serverAnalysis, audd });
    const patch: Record<string, unknown> = { ...merged };
    if (peaksUrl) patch.peaks_url = peaksUrl;

    // Generate the protected preview clip (beat protection): serve a truncated
    // copy publicly so the clean master is never exposed on the storefront.
    // mp3 (byte-slice) + wav (header-aware) masters are supported; other formats
    // keep preview_status='none' and the store falls back to the master.
    if (/\.(mp3|wav)(?:\?|$)/i.test(audioUrl)) {
      try {
        const { buffer: previewBuf, ext, contentType } = makeTruncatedPreview(buffer, merged.duration_seconds);
        const previewUrl = await uploadPreviewAsset(audioUrl, previewBuf, ext, contentType);
        if (previewUrl) {
          patch.preview_url = previewUrl;
          patch.preview_status = 'ready';
        }
      } catch { /* leave preview_status default; store falls back to master */ }
    }

    if (isSupabaseConfigured()) {
      // Ownership was already verified at insert; patch by id with service role.
      await createServiceClient().from('tracks').update(patch).eq('id', trackId);
    } else {
      update('tracks', trackId, patch);
    }
  } catch (err) {
    log.warn('deferred analysis failed:', { error: errorMessage(errorMessage(err)) });
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
