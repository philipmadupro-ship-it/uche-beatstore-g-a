import 'server-only';

import path from 'path';
import { createServiceClient } from '@/lib/auth/ownership';
import { analyzeAudio } from '@/lib/audio/analyze.server';
import { getAuddFeatures } from '@/lib/audio/audd';
import { mergeFeatures } from '@/lib/audio/merge';
import { extractPeaks } from '@/lib/audio/peaks';
import {
  parseR2ObjectRef,
  readStoredObject,
  uploadPeaksSidecar,
  uploadPrivateAudio,
  uploadPublicPreview,
} from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { sniffAudioBuffer } from '@/lib/upload/processing';

type LegacyTrack = {
  id: string;
  user_id: string;
  title: string | null;
  audio_url: string | null;
};

function isAllowedLegacySource(source: string): boolean {
  if (parseR2ObjectRef(source)) return false;
  if (source.startsWith('/uploads/') && !source.includes('..')) return true;
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '');
  return Boolean(publicBase && source.startsWith(`${publicBase}/`));
}

function fileNameFor(track: LegacyTrack): string {
  const fromUrl = track.audio_url ? path.basename(new URL(track.audio_url, 'http://local').pathname) : '';
  const ext = path.extname(fromUrl) || '.mp3';
  const safeTitle = (track.title || 'track')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'track';
  return `${safeTitle}-${track.id}${ext}`;
}

function contentTypeFor(fileName: string): string {
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  switch (ext) {
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'm4a': return 'audio/mp4';
    case 'ogg': return 'audio/ogg';
    default: return 'audio/mpeg';
  }
}

export async function migrateLegacyPublicMastersBatch(limit = 2): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  results: Array<{ trackId: string; status: 'migrated' | 'skipped' | 'failed'; error?: string }>;
}> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('tracks')
    .select('id,user_id,title,audio_url')
    .not('audio_url', 'is', null)
    .not('audio_url', 'like', 'r2://%')
    .is('private_audio_migrated_at', null)
    .limit(Math.max(1, Math.min(limit, 5)));
  if (error) throw new Error(`Legacy track lookup failed: ${error.message}`);

  const rows = ((data ?? []) as LegacyTrack[]).filter((track) => track.audio_url);
  const results: Array<{ trackId: string; status: 'migrated' | 'skipped' | 'failed'; error?: string }> = [];

  for (const track of rows) {
    const source = track.audio_url!;
    if (!isAllowedLegacySource(source)) {
      results.push({ trackId: track.id, status: 'skipped', error: 'source not allowed' });
      continue;
    }

    try {
      const audioBuffer = await readStoredObject(source);
      const sniff = sniffAudioBuffer(audioBuffer);
      if (!sniff.ok) throw new Error(`source is not supported audio (${sniff.format})`);

      const fileName = fileNameFor(track);
      const privateUrl = await uploadPrivateAudio(audioBuffer, fileName, contentTypeFor(fileName));

      let serverAnalysis = null;
      try {
        serverAnalysis = await analyzeAudio(audioBuffer);
      } catch (err) {
        console.warn('Legacy migration analysis failed:', err);
      }

      let audd = { danceability: 0, energy: 0, valence: 0, acousticness: 0, tempo: 0 };
      try {
        audd = await getAuddFeatures(audioBuffer, fileName);
      } catch (err) {
        console.warn('Legacy migration AudD failed:', err);
      }

      let peaksUrl: string | null = null;
      try {
        const peaks = await extractPeaks(audioBuffer);
        if (peaks) peaksUrl = await uploadPeaksSidecar(privateUrl, JSON.stringify(peaks));
      } catch (err) {
        console.warn('Legacy migration peaks failed:', err);
      }

      let previewUrl: string | null = null;
      try {
        previewUrl = await uploadPublicPreview(audioBuffer);
      } catch (err) {
        console.warn('Legacy migration preview failed:', err);
      }

      const merged = mergeFeatures({ client: null, server: serverAnalysis, audd });
      const { error: updateError } = await admin
        .from('tracks')
        .update({
          audio_url: privateUrl,
          legacy_audio_url: source,
          private_audio_migrated_at: new Date().toISOString(),
          preview_url: previewUrl,
          peaks_url: peaksUrl,
          ...merged,
        })
        .eq('id', track.id)
        .eq('user_id', track.user_id);
      if (updateError) throw new Error(`Track update failed: ${updateError.message}`);

      results.push({ trackId: track.id, status: 'migrated' });
    } catch (err) {
      results.push({ trackId: track.id, status: 'failed', error: errorMessage(err) });
    }
  }

  return {
    scanned: rows.length,
    migrated: results.filter((r) => r.status === 'migrated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
