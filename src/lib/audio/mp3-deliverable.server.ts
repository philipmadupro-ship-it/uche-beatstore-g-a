import 'server-only';
import { isR2Configured } from '@/lib/local-store';
import { makeDeliveryMp3Buffer } from '@/lib/audio/convert';
import {
  privateAudioBucket,
  putPrivateObject,
  r2ObjectRef,
  readStoredObject,
  storedObjectExists,
} from '@/lib/storage/upload';
import { ensureMp3Deliverable, type EnsureMp3Deps, type Mp3Deliverable } from './mp3-deliverable';

/** The real dependencies: R2 private bucket + ffmpeg. */
export const realMp3Deps: EnsureMp3Deps = {
  refFor: (key) => (isR2Configured() ? r2ObjectRef(privateAudioBucket(), key) : null),
  exists: storedObjectExists,
  readMaster: readStoredObject,
  transcode: makeDeliveryMp3Buffer,
  put: (key, buffer) => putPrivateObject(key, buffer, 'audio/mpeg'),
};

export function ensureTrackMp3(track: { id: string; audio_url: string | null | undefined }): Promise<Mp3Deliverable | null> {
  return ensureMp3Deliverable(track, realMp3Deps);
}
