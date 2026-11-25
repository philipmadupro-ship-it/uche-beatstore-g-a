import { assetContentKey } from './content-key';
import { locationOf } from './location';
import type { Asset } from './types';

export const STEM_KEYS = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemKey = (typeof STEM_KEYS)[number];

/** The slice of a track row the model reads. Producer rows only. */
export interface TrackAssetInput {
  id: string;
  title?: string | null;
  audio_url?: string | null;
  wav_url?: string | null;
}

/** Stem references as the `stems` job row holds them (or the stems API returns them). */
export type StemRefs = Partial<Record<StemKey, string | null | undefined>>;

/** The owner-gated audio proxy — how every track file reaches the dashboard. */
export function trackAudioOpenUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  // Already a same-origin route (the stems API returns /api/audio?... already).
  if (ref.startsWith('/')) return ref;
  return `/api/audio?src=${encodeURIComponent(ref)}`;
}

function base(trackId: string): Pick<Asset, 'ownerType' | 'ownerId' | 'offline'> {
  return { ownerType: 'track', ownerId: trackId, offline: 'none' };
}

/**
 * Every file a track has: master, separate WAV, stems. Built field by field;
 * a reference is read for its storage class and fingerprint and never copied.
 */
export function assetsOfTrack(track: TrackAssetInput, stems?: StemRefs | null, publicBucket?: string | null): Asset[] {
  const out: Asset[] = [];
  const title = track.title?.trim() || 'Untitled';

  if (track.audio_url) {
    out.push({
      ...base(track.id),
      id: `track:${track.id}:audio`,
      source: 'track_audio',
      kind: 'audio',
      label: `${title} — master`,
      fileName: null,
      mime: null,
      sizeBytes: null,
      location: locationOf(track.audio_url, publicBucket),
      contentKey: assetContentKey(track.audio_url),
      playable: true,
      openUrl: trackAudioOpenUrl(track.audio_url),
    });
  }

  // A WAV that is the same reference as the master is one file, not two.
  if (track.wav_url && track.wav_url !== track.audio_url) {
    out.push({
      ...base(track.id),
      id: `track:${track.id}:wav`,
      source: 'track_wav',
      kind: 'audio',
      label: `${title} — WAV`,
      fileName: null,
      mime: 'audio/wav',
      sizeBytes: null,
      location: locationOf(track.wav_url, publicBucket),
      contentKey: assetContentKey(track.wav_url),
      playable: true,
      openUrl: trackAudioOpenUrl(track.wav_url),
    });
  }

  for (const key of STEM_KEYS) {
    const ref = stems?.[key];
    if (!ref) continue;
    out.push({
      ...base(track.id),
      id: `track:${track.id}:stem:${key}`,
      source: 'track_stem',
      kind: 'stem',
      label: `${title} — ${key}`,
      fileName: null,
      mime: null,
      sizeBytes: null,
      location: locationOf(ref, publicBucket),
      contentKey: assetContentKey(ref),
      playable: true,
      openUrl: trackAudioOpenUrl(ref),
    });
  }
  return out;
}
