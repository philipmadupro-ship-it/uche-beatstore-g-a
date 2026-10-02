import 'server-only';
import { isR2Configured } from '@/lib/local-store';
import { makeDeliveryMp3Buffer } from '@/lib/audio/convert';
import {
  deletePrivateKeys,
  listPrivateKeys,
  privateAudioBucket,
  putPrivateObject,
  r2ObjectRef,
  readStoredObject,
  storedObjectExists,
} from '@/lib/storage/upload';
import { canDeriveMp3, ensureMp3Deliverable, mp3DeliverableKey, pruneMp3Deliverables, type EnsureMp3Deps, type Mp3Deliverable, type PruneDeps } from './mp3-deliverable';
import { mp3Status, type Mp3Status } from './mp3-status';

/** Pruning needs the bucket; without R2 (local dev) there is nothing to prune. */
export const realPruneDeps: PruneDeps = {
  list: async (prefix) => (isR2Configured() ? listPrivateKeys(prefix) : []),
  remove: async (keys) => { if (isR2Configured()) await deletePrivateKeys(keys); },
};

/** Drop a track's superseded derivatives (all of them if `audio_url` is null). */
export function pruneTrackMp3s(track: { id: string; audio_url: string | null | undefined }): Promise<number> {
  return pruneMp3Deliverables(track, realPruneDeps);
}

/** The real dependencies: R2 private bucket + ffmpeg. */
export const realMp3Deps: EnsureMp3Deps = {
  refFor: (key) => (isR2Configured() ? r2ObjectRef(privateAudioBucket(), key) : null),
  exists: storedObjectExists,
  readMaster: readStoredObject,
  transcode: makeDeliveryMp3Buffer,
  put: (key, buffer) => putPrivateObject(key, buffer, 'audio/mpeg'),
  prune: (track) => pruneTrackMp3s(track),
};

export function ensureTrackMp3(track: { id: string; audio_url: string | null | undefined }): Promise<Mp3Deliverable | null> {
  return ensureMp3Deliverable(track, realMp3Deps);
}

/**
 * The producer-facing MP3 status for a track: reads storage for the one key
 * that matters (no column holds this), and never claims "ready" it could not
 * confirm.
 */
export async function getTrackMp3Status(track: { id: string; audio_url: string | null | undefined }): Promise<Mp3Status> {
  let exists: boolean | null = null;
  if (canDeriveMp3(track.audio_url)) {
    try {
      const ref = realMp3Deps.refFor(mp3DeliverableKey(track.id, track.audio_url as string));
      exists = ref ? await realMp3Deps.exists(ref) : null;
    } catch {
      exists = null;
    }
  }
  return mp3Status(track.audio_url, exists);
}
