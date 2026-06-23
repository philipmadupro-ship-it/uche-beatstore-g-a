import { NextRequest, NextResponse } from 'next/server';
import { completeMultipart, listParts, readAssembledBuffer } from '@/lib/storage/multipart';
import { getSession, markStatus, deleteSession } from '@/lib/storage/upload-sessions';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import type { AudioFeatures } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import { uploadPeaksSidecar, uploadPublicPreview } from '@/lib/storage/upload';
import { isSupabaseConfigured, insert, update, getAll } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { titleFromFilename, nextVersionLabel } from '@/lib/naming';
import { errorMessage } from '@/lib/errors';
import { requireUploadSessionOwner } from '@/lib/storage/upload-session-auth';
import { enqueueUploadProcessingJob } from '@/lib/upload/processing';

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
    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'unknown session' }, { status: 404 });
    }
    if (session.status === 'completed') {
      return NextResponse.json({ error: 'already completed' }, { status: 409 });
    }
    const owner = await requireUploadSessionOwner(session);
    if (!owner.ok) return owner.res;
    let completedParts = session.parts;
    try {
      const remoteParts = await listParts({ uploadId: session.uploadId, key: session.key });
      if (remoteParts.length >= completedParts.length) completedParts = remoteParts;
    } catch (err) {
      console.warn('Could not reconcile multipart state before completion:', err);
    }
    if (completedParts.length !== session.totalParts) {
      return NextResponse.json(
        { error: `Missing parts (${completedParts.length}/${session.totalParts})` },
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
        parts: completedParts,
      });
    } catch (err) {
      console.error('completeMultipart failed:', err);
      return NextResponse.json(
        { error: `Storage finalize failed: ${errorMessage(err)}` },
        { status: 500 }
      );
    }

    await markStatus(sessionId, 'completed');

    if (isSupabaseConfigured()) {
      const merged = mergeFeatures({ client: clientAnalysis, server: null, audd: null });
      const trackData = {
        title: titleFromFilename(session.fileName),
        type: session.type,
        audio_url: audioUrl,
        preview_url: null,
        peaks_url: null,
        ...merged,
        stems_status: 'none' as const,
      };

      let track: Record<string, unknown> | null = null;
      try {
        const supabase = await createServerClient();
        const userId = owner.userId || session.userId;
        if (!userId) {
          return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        if (session.replaceTrackId) {
          const { requireRowOwnership } = await import('@/lib/db');
          const rowOwner = await requireRowOwnership('tracks', session.replaceTrackId);
          if (!rowOwner.ok) return rowOwner.res;

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
              preview_url: existing.preview_url,
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

          const trackId = track && typeof track.id === 'string' ? track.id : null;
          if (!trackId) throw new Error('Upload saved without a track id');
          if (session.projectId) {
            await attachTrackToDestination(supabase, session.projectId, trackId, userId);
          }
        }

        const trackId = track && typeof track.id === 'string' ? track.id : session.replaceTrackId;
        if (!trackId) throw new Error('Upload saved without a track id');
        await enqueueUploadProcessingJob({
          trackId,
          userId,
          audioUrl,
          fileName: session.fileName,
          clientAnalysis,
        });
      } catch (err) {
        console.error('Supabase upload completion failed:', err);
        const message = errorMessage(err) || 'Database save failed';
        if (/destination|attach/i.test(message)) {
          const status = /forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500;
          return NextResponse.json({ error: message }, { status });
        }
        return NextResponse.json({ error: message }, { status: 500 });
      }

      await deleteSession(sessionId);
      return NextResponse.json({ success: true, track, processing: 'queued' });
    }

    // 2. Fetch the assembled buffer ONCE with retry for R2 eventual consistency.
    // Reuse across all three analyses — analysis, AudD, and peaks — so we never
    // fetch a large audio file more than once. Client analysis takes precedence
    // so we skip the fetch entirely when the browser already did the work.
    let audioBuffer: Buffer | null = null;
    const needsBuffer = !clientAnalysis; // peaks always needs it; guard below
    if (needsBuffer) {
      try {
        audioBuffer = await readAssembledBuffer(audioUrl);
      } catch (err) {
        console.warn('Could not fetch assembled audio for analysis:', err);
      }
    }

    let serverAnalysis: AudioFeatures | null = null;
    if (!clientAnalysis) {
      try {
        if (audioBuffer) serverAnalysis = await analyzeAudio(audioBuffer);
      } catch (err) {
        console.warn('Server analysis failed, using nulls:', err);
      }
      if (!serverAnalysis) {
        serverAnalysis = { bpm: null, key: null, scale: null, loudness: null, duration: null };
      }
    }

    let audd = { danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 };
    try {
      // If client analysis was provided we skipped the buffer fetch above;
      // lazy-fetch here so AudD still gets real data without a duplicate round-trip.
      if (!audioBuffer) audioBuffer = await readAssembledBuffer(audioUrl).catch(() => null);
      if (audioBuffer) audd = await getAuddFeatures(audioBuffer, session.fileName);
    } catch (err) {
      console.warn('AudD features failed, using zeros:', err);
    }

    // Peaks extraction — non-fatal; WavePlayer falls back to client decode.
    let peaksUrl: string | null = null;
    try {
      if (!audioBuffer) audioBuffer = await readAssembledBuffer(audioUrl).catch(() => null);
      if (audioBuffer) {
        const peaks = await extractPeaks(audioBuffer);
        if (peaks) peaksUrl = await uploadPeaksSidecar(audioUrl, JSON.stringify(peaks));
      }
    } catch (err) {
      console.warn('Peaks extraction/upload failed, continuing without:', err);
    }

    let previewUrl: string | null = null;
    try {
      if (!audioBuffer) audioBuffer = await readAssembledBuffer(audioUrl).catch(() => null);
      if (audioBuffer) previewUrl = await uploadPublicPreview(audioBuffer);
    } catch (err) {
      console.warn('Preview generation/upload failed, track remains private:', err);
    }

    const merged = mergeFeatures({ client: clientAnalysis, server: serverAnalysis, audd });
    const trackData = {
      title: titleFromFilename(session.fileName),
      type: session.type,
      audio_url: audioUrl,
      preview_url: previewUrl,
      peaks_url: peaksUrl,
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
              preview_url: existing.preview_url,
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
        console.error('Supabase op failed, falling back to local store:', err);
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

    await deleteSession(sessionId);
    return NextResponse.json({ success: true, track });
  } catch (err) {
    console.error('upload/complete error:', err);
    return NextResponse.json({ error: errorMessage(err) || 'complete failed' }, { status: 500 });
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
    return Boolean(userId && row.user_id === userId);
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
