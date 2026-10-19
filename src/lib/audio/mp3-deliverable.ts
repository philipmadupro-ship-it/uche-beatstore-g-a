import { createHash } from 'node:crypto';

/**
 * The MP3 a lease buyer is sold, for a track whose master is not an MP3.
 *
 * A lease tier promises MP3. The master is whatever the producer uploaded —
 * usually a WAV — and the delivery routes (correctly) will not hand a WAV to
 * an MP3-only tier, so before this a lease on a WAV master paid and received
 * nothing. The deliverable is now made from the master and kept in PRIVATE
 * storage; the master never leaves it.
 *
 * No column tracks it. The key is derived from the track id AND a hash of the
 * master's reference, so
 *  - existence of that key is the whole state ("is there a current MP3?"),
 *  - a new master (re-upload, version revert) hashes to a new key and can never
 *    be served a stale MP3 of the old one,
 *  - writing the key twice is one object (concurrent first downloads are safe),
 *  - it works for every existing track without a migration or a backfill.
 * The cost is that a superseded derivative is orphaned rather than deleted.
 */

/** Formats the upload path accepts (see /api/upload/init ALLOWED_EXT). */
const AUDIO_EXT_RE = /\.(mp3|wav|flac|aiff|aif|m4a|ogg)(?:\?|$)/i;
const MP3_RE = /\.mp3(?:\?|$)/i;

export function isMp3Master(audioUrl: string | null | undefined): boolean {
  return typeof audioUrl === 'string' && MP3_RE.test(audioUrl);
}

/** A master ffmpeg can turn into an MP3 (any uploadable format that is not one already). */
export function canDeriveMp3(audioUrl: string | null | undefined): boolean {
  return typeof audioUrl === 'string' && AUDIO_EXT_RE.test(audioUrl) && !MP3_RE.test(audioUrl);
}

export function mp3DeliverableKey(trackId: string, audioUrl: string): string {
  const fingerprint = createHash('sha256').update(audioUrl).digest('hex').slice(0, 12);
  return `deliverables/${trackId}-${fingerprint}.mp3`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Listing prefix for one track's derivatives. */
export function mp3DeliverablePrefix(trackId: string): string {
  return `deliverables/${trackId}-`;
}

/**
 * Which of `listedKeys` are SUPERSEDED derivatives of this track: made from a
 * master the track no longer has. Everything but the key for `currentAudioUrl`
 * (all of them when the track has no master that needs one — deleted, or itself
 * an MP3).
 *
 * This is the only thing that decides what gets deleted, so it is strict by
 * construction: a key is returned only if it is EXACTLY
 * `deliverables/<this track's uuid>-<12 hex>.mp3`. A bad listing, another
 * track's derivative, a master (`tracks/…`) or a stem can never be named.
 */
export function supersededDeliverableKeys(
  listedKeys: string[],
  trackId: string,
  currentAudioUrl: string | null | undefined,
): string[] {
  if (!new RegExp(`^${UUID}$`, 'i').test(trackId)) return [];
  const exact = new RegExp(`^deliverables/${trackId}-[0-9a-f]{12}\\.mp3$`);
  const keep = canDeriveMp3(currentAudioUrl) ? mp3DeliverableKey(trackId, currentAudioUrl as string) : null;
  return [...new Set(listedKeys)].filter((k) => exact.test(k) && k !== keep);
}

export type PruneDeps = {
  list: (prefix: string) => Promise<string[]>;
  remove: (keys: string[]) => Promise<void>;
};

/**
 * Delete this track's superseded derivatives. Best-effort and never throws: an
 * orphan costs a few MB, and a failed cleanup must not fail the download,
 * revert or delete that triggered it. Returns how many it removed.
 */
export async function pruneMp3Deliverables(
  track: { id: string; audio_url: string | null | undefined },
  deps: PruneDeps,
): Promise<number> {
  try {
    const stale = supersededDeliverableKeys(await deps.list(mp3DeliverablePrefix(track.id)), track.id, track.audio_url);
    if (stale.length === 0) return 0;
    await deps.remove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

export type Mp3Deliverable =
  /** Served from storage: the master itself (already an MP3) or the stored derivative. */
  | { kind: 'ref'; ref: string; created: boolean }
  /** Made just now but could not be stored; serve these bytes. */
  | { kind: 'buffer'; buffer: Buffer };

export type EnsureMp3Deps = {
  /** r2:// ref for a key, or null when there is no private storage (local dev). */
  refFor: (key: string) => string | null;
  exists: (ref: string) => Promise<boolean>;
  readMaster: (audioUrl: string) => Promise<Buffer>;
  transcode: (master: Buffer) => Promise<Buffer | null>;
  put: (key: string, buffer: Buffer) => Promise<string>;
  /** Called after a NEW derivative is stored, to drop the ones it supersedes. */
  prune?: (track: { id: string; audio_url: string }) => Promise<unknown>;
};

/**
 * The MP3 deliverable for a track, making it if there is not a current one.
 * Returns null when it cannot be made (no ffmpeg, unreadable master, not a
 * transcodable format): the caller says "being prepared" and alerts the
 * producer rather than handing over the master.
 */
export async function ensureMp3Deliverable(
  track: { id: string; audio_url: string | null | undefined },
  deps: EnsureMp3Deps,
): Promise<Mp3Deliverable | null> {
  const audioUrl = track.audio_url;
  if (!audioUrl) return null;
  if (isMp3Master(audioUrl)) return { kind: 'ref', ref: audioUrl, created: false };
  if (!canDeriveMp3(audioUrl)) return null;

  const key = mp3DeliverableKey(track.id, audioUrl);
  const ref = deps.refFor(key);
  if (ref && (await deps.exists(ref))) return { kind: 'ref', ref, created: false };

  let buffer: Buffer | null = null;
  try {
    buffer = await deps.transcode(await deps.readMaster(audioUrl));
  } catch {
    buffer = null;
  }
  if (!buffer || buffer.length === 0) return null;

  if (!ref) return { kind: 'buffer', buffer };
  try {
    const stored = await deps.put(key, buffer);
    // A new key means the master changed (or this is the first MP3): anything
    // else under this track is a derivative of a master it no longer has.
    try { await deps.prune?.({ id: track.id, audio_url: audioUrl }); } catch { /* best-effort */ }
    return { kind: 'ref', ref: stored, created: true };
  } catch {
    // The bytes are good even though they could not be kept: the buyer still
    // gets their file, and the next request tries again.
    return { kind: 'buffer', buffer };
  }
}

/**
 * Make the deliverable at upload time, from a master the caller already holds
 * in memory, so the first buyer does not wait for the transcode. A no-op for an
 * MP3 master (nothing to make) and never throws: the same MP3 is made on first
 * download if this fails.
 */
export async function prepareMp3Deliverable(
  track: { id: string; audio_url: string | null | undefined },
  master: Buffer,
  deps: EnsureMp3Deps,
): Promise<Mp3Deliverable | null> {
  if (!canDeriveMp3(track.audio_url)) return null;
  try {
    return await ensureMp3Deliverable(track, { ...deps, readMaster: async () => master });
  } catch {
    return null;
  }
}
