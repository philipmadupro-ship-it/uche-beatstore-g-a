import 'server-only';

import type { AudioFeatures } from './analyze.server';
import type { AuddFeatures } from './audd';

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

  return {
    // Tempo + harmony: the filename wins, then client, then server.
    bpm: bpm != null ? Math.round(bpm) : null,
    key: pick(title?.key, client?.key, server?.key),
    scale: pick(title?.scale, client?.scale, server?.scale),
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
