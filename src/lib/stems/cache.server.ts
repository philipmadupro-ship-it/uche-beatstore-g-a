import 'server-only';
import { isR2Configured } from '@/lib/local-store';
import {
  deletePrivateKeys, listPrivateKeys, privateAudioBucket, putPrivateObject, r2ObjectRef, storedObjectExists,
} from '@/lib/storage/upload';
import { pruneStemCache, type StemCacheDeps, type StemCachePruneDeps } from './cache';

export const realStemPruneDeps: StemCachePruneDeps = {
  list: async (prefix) => (isR2Configured() ? listPrivateKeys(prefix) : []),
  remove: async (keys) => { if (isR2Configured()) await deletePrivateKeys(keys); },
};

/** Drop a track's superseded stem results (all of them when `source` is null). */
export function pruneTrackStemCache(track: { id: string; source: string | null | undefined }): Promise<number> {
  return pruneStemCache(track, realStemPruneDeps);
}

export const realStemCache: StemCacheDeps = {
  refFor: (key) => (isR2Configured() ? r2ObjectRef(privateAudioBucket(), key) : null),
  exists: storedObjectExists,
  put: (key, buffer) => putPrivateObject(key, buffer, 'audio/wav'),
  prune: (track) => pruneTrackStemCache(track),
};
