import 'server-only';

import type { AudioFeatures } from './analyze.server';
import type { AuddFeatures } from './audd';
import { normalizeKey } from './key-normalize';

/**
 * Source-of-truth precedence for the analysis fields written to `tracks`.
 *
 * Four potential sources, in order of preference:
 *
 *   0. **The filename** (`lib/upload/title-metadata`) — when the producer
 *      wrote `140 Fm` in the name, that is a statement, not a guess. It wins
 *      over every detector for `bpm`, `key` and `scale`, because a detector
 *      working from audio routinely halves or doubles a tempo and picks the
 *      relative major. It never supplies the other fields.
 *
 *   1. **Client (Essentia.js, browser)** — most accurate for `bpm`, `key`,
 *      `scale`, `loudness`. When the client uploads with a `features` payload
 *      we trust those values for those four fields.
 *   2. **AudD (Spotify catalogue match)** — only useful for the four
 *      "vibe" fields (`energy`, `danceability`, `valence`, `acousticness`)
 *      *and only when the song is actually catalogued*. We detect that via
 *      any non-zero signal; for unreleased tracks AudD returns zeros and we
 *      ignore it.
 *   3. **Server heuristics (analyzeAudio)** — fallback for everything. Cheap
 *      Krumhansl-Schmuckler key detection, music-tempo BPM, RMS energy,
 *      ZCR-based valence/acousticness/danceability.
 *
 * The same merge runs at upload, chunked-complete, and re-analyze time so a
 * field's meaning never changes based on which path the track came in
 * through.
 *
 * Whichever source wins, the key is then put through
 * `lib/audio/key-normalize` before it is stored. The three sources spell the
 * same key differently — the filename parser emits the flat the producer
 * typed, the server detector indexes a sharps-only table — and `tracks.key` is
 * an unconstrained `TEXT` column, so without this the same key arrives in two
 * spellings and anything comparing keys as strings treats them as different.
 */
export interface MergedFeatures {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  loudness: number | null;
  duration_seconds: number | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
}

/** What the filename claimed; see `lib/upload/title-metadata`. */
export interface TitleFeatures {
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

export function mergeFeatures(opts: {
  title?: TitleFeatures | null;
  client?: Partial<AudioFeatures> | null;
  server?: AudioFeatures | null;
  audd?: AuddFeatures | null;
}): MergedFeatures {
  const { title, client, server, audd } = opts;

  const auddHasSignal = !!(
    audd &&
    (audd.energy > 0 || audd.danceability > 0 || audd.valence > 0)
  );

  const pick = <T>(...vals: (T | null | undefined)[]): T | null => {
    for (const v of vals) if (v != null) return v;
    return null;
  };

  const bpm = pick(title?.bpm, client?.bpm, server?.bpm);
  const duration = pick(client?.duration, server?.duration);

  const rawKey = pick(title?.key, client?.key, server?.key);
  const rawScale = pick(title?.scale, client?.scale, server?.scale);
  const harmony = normalizeKey(rawKey, rawScale);

  return {
    // Tempo + harmony: the filename wins, then client, then server.
    bpm: bpm != null ? Math.round(bpm) : null,
    // Canonical spelling when the value is readable as a key. When it isn't,
    // the original is kept rather than discarded: it is not a key this app can
    // match on, but it is what a source reported and dropping it here would
    // lose the only record of that.
    key: harmony.key ?? rawKey,
    scale: harmony.scale ?? rawScale,
    loudness: pick(client?.loudness, server?.loudness),
    duration_seconds: duration != null ? Math.round(duration) : null,

    // Vibe fields: AudD only when it has signal, otherwise heuristics.
    energy: auddHasSignal ? audd!.energy : pick(client?.energy, server?.energy),
    danceability: auddHasSignal
      ? audd!.danceability
      : pick(client?.danceability, server?.danceability),
    valence: auddHasSignal ? audd!.valence : pick(client?.valence, server?.valence),
    acousticness: auddHasSignal
      ? audd!.acousticness
      : pick(client?.acousticness, server?.acousticness),
  };
}
