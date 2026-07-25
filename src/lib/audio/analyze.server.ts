/**
 * Node-only audio analysis: duration via music-metadata, BPM via music-tempo.
 * NEVER import this from a client component — it pulls in audio-decode and
 * worker bundles that break webpack/turbopack client builds.
 */

import 'server-only';

export interface AudioFeatures {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  loudness: number | null;
  duration: number | null;
  /** Heuristic 0-1 values when full extractors are unavailable. */
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  /** Diagnostics — never persisted, only used to drive the UI toast. */
  _decoded?: boolean;
  _ffmpegUsed?: boolean;
  _ffmpegAvailable?: boolean;
  _bytes?: number;
  /** Short human-readable reason for failure (or trace), e.g.
   *  "audio-decode failed: invalid header" / "ffmpeg not on PATH". */
  _reason?: string;
}

interface AudioDecodeResult {
  channelData?: Float32Array[];
  _channelData?: Float32Array[];
  sampleRate?: number;
  getChannelData?: (channel: number) => Float32Array;
}

type AudioDecodeFn = (buffer: Buffer) => Promise<AudioDecodeResult | null>;

interface AudioDecodeModule {
  default: AudioDecodeFn;
}

interface MusicTempoResult {
  tempo: number | string;
}

type MusicTempoConstructor = new (samples: number[]) => MusicTempoResult;

interface MusicTempoModule {
  default: MusicTempoConstructor;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Temperley/Kostka-Payne revised key profiles. The original Krumhansl-
// Schmuckler profiles were derived from probe-tone experiments on
// classical music — they over-weight the third and tonic. Temperley's
// revised set was fit against a corpus that includes contemporary
// popular music and works substantially better on hip-hop / electronic.
// Reference: Temperley (2007), "Music and Probability".
const MAJOR_PROFILE = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const MINOR_PROFILE = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

function corr(a: number[], b: number[]): number {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}

/**
 * Standalone BPM detector via autocorrelation of the energy envelope.
 *
 * Algorithm:
 *   1. Window the audio into ~10ms frames; compute the sum-of-squares
 *      energy per frame. This gives us an "envelope" — a low-rate
 *      signal that spikes on transients (kicks, snares, plucks).
 *   2. Take the autocorrelation of the envelope at lags corresponding
 *      to 60-240 BPM. The peak lag tells us the beat period.
 *   3. Convert peak lag → BPM. Apply the same octave-folding music-tempo
 *      needs (real tempo could be half/double).
 *
 * Faster and more reliable than music-tempo on modern dense mixes where
 * the kick is the dominant transient. Misses unusual styles (very
 * sparse ambient, complex polyrhythms) but those are rare in our
 * target catalogue (beats / hip-hop / trap / electronic).
 *
 * Returns null when no peak is confident (autocorrelation is uniform).
 */
function autocorrelateBpm(
  channel: Float32Array,
  sampleRate: number,
  startOffset = 0,
  length?: number,
): number | null {
  const end = length != null ? startOffset + length : channel.length;

  // Envelope: 10ms frames. At 44.1 kHz that's 441 samples per frame.
  const frameMs = 10;
  const frameSize = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const envelope: number[] = [];
  for (let i = startOffset; i + frameSize <= end; i += frameSize) {
    let s = 0;
    for (let j = 0; j < frameSize; j++) {
      const v = channel[i + j];
      s += v * v;
    }
    envelope.push(s);
  }
  if (envelope.length < 200) return null; // need ~2 seconds minimum

  // Subtract the moving mean so DC offset doesn't dominate the
  // autocorrelation. Center on zero.
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  for (let i = 0; i < envelope.length; i++) envelope[i] -= mean;

  // Lag bounds: 60 BPM = 1s/beat, 240 BPM = 0.25s/beat. Convert to
  // frame indices given frameMs.
  const minLag = Math.round((60 / 240) * 1000 / frameMs); // 25 frames @ 10ms
  const maxLag = Math.round((60 / 60)  * 1000 / frameMs); // 100 frames @ 10ms

  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < envelope.length; i++) {
      sum += envelope[i] * envelope[i + lag];
    }
    // Normalise by overlap so longer lags aren't penalised.
    const score = sum / (envelope.length - lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  if (bestLag === 0 || bestScore <= 0) return null;
  // Lag in seconds → BPM
  const beatSec = (bestLag * frameMs) / 1000;
  let bpm = 60 / beatSec;
  // Octave fold into 60-180 band (same heuristic as the music-tempo path).
  if (bpm < 60)  bpm *= 2;
  if (bpm > 200) bpm /= 2;
  return Math.round(bpm);
}

/**
 * Pre-computed Hamming window of `size` samples. Cached at module scope
 * — `detectKey` runs hundreds of frames per analysis, all the same size.
 */
const _hammingCache = new Map<number, Float32Array>();
function hamming(size: number): Float32Array {
  let w = _hammingCache.get(size);
  if (w) return w;
  w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  _hammingCache.set(size, w);
  return w;
}

function detectKey(channel: Float32Array, sampleRate: number): { key: string | null; scale: string | null } {
  // Analyse up to the first 90 seconds. Most songs settle their key by
  // then; longer doesn't materially help and slows the route.
  const maxSamples = Math.min(channel.length, sampleRate * 90);
  const chroma = new Float64Array(12);

  // Frame setup: 4096 samples with 75% overlap, windowed by Hamming.
  // Hamming reduces spectral leakage so a bass note at the tonic
  // doesn't bleed power into its neighbouring pitch classes — this was
  // the primary cause of "D♯m detected as Cm" style errors before.
  const frameSize = 4096;
  const hop = frameSize / 4;
  const window = hamming(frameSize);

  // 6 octaves of C2..B7 (65 Hz → ~2 kHz). Wider range than the old 4
  // octaves catches both bass-driven and synth-heavy productions.
  // We also sum 2 harmonics (octave + perfect fifth) back into the
  // tonic's pitch class — bass notes carry strong overtones that
  // would otherwise vote for the fifth instead of the tonic.
  const OCTAVES = 6;
  const baseFreq = 65.41; // C2
  // Harmonic weights — fundamental, 2× (octave), 3× (perfect fifth).
  // Fifth harmonic gets folded back into pc with reduced weight so it
  // boosts the tonic instead of competing with it.
  const HARMONIC_WEIGHTS = [1.0, 0.6, 0.4];
  const HARMONIC_PC_OFFSETS = [0, 0, 7]; // fund, 2× → same pc, 3× → fifth (+7 semis)

  // Build frequency list: for each pitch class and octave, also include
  // each harmonic with its pc offset. We Goertzel-evaluate all of these
  // and then re-bin into 12 chroma slots.
  type Probe = { freq: number; pc: number; weight: number };
  const probes: Probe[] = [];
  for (let oct = 0; oct < OCTAVES; oct++) {
    for (let pc = 0; pc < 12; pc++) {
      const f0 = baseFreq * Math.pow(2, oct + pc / 12);
      if (f0 >= sampleRate / 2) continue; // above Nyquist
      for (let h = 0; h < HARMONIC_WEIGHTS.length; h++) {
        const fh = f0 * (h + 1);
        if (fh >= sampleRate / 2) continue;
        // Harmonic energy gets attributed back to the fundamental's
        // pc, BUT shifted by the pc-offset of that harmonic so the
        // fifth's energy lands on the fifth chroma bin (i.e. it
        // doesn't all collapse to the tonic). HARMONIC_PC_OFFSETS[h]
        // is 0 for fundamental + octave, 7 for the perfect fifth.
        probes.push({
          freq: fh,
          pc: (pc + HARMONIC_PC_OFFSETS[h]) % 12,
          weight: HARMONIC_WEIGHTS[h],
        });
      }
    }
  }

  // Goertzel per-frame, windowed.
  for (let start = 0; start + frameSize <= maxSamples; start += hop) {
    for (const probe of probes) {
      const omega = (2 * Math.PI * probe.freq) / sampleRate;
      const coeff = 2 * Math.cos(omega);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < frameSize; i++) {
        const x = channel[start + i] * window[i];
        const s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      // Magnitude (not power) — keeps the dynamic range tighter so
      // soft pitch content isn't completely swamped by transients.
      const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));
      chroma[probe.pc] += mag * probe.weight;
    }
  }

  // Normalise.
  const sum = chroma.reduce((a, b) => a + b, 0) || 1;
  const norm = Array.from(chroma).map((v) => v / sum);

  let bestScore = -Infinity, bestKey = 0, bestMode: 'major' | 'minor' = 'major';
  for (let k = 0; k < 12; k++) {
    const rotated = norm.slice(k).concat(norm.slice(0, k));
    const cMaj = corr(rotated, MAJOR_PROFILE);
    const cMin = corr(rotated, MINOR_PROFILE);
    if (cMaj > bestScore) { bestScore = cMaj; bestKey = k; bestMode = 'major'; }
    if (cMin > bestScore) { bestScore = cMin; bestKey = k; bestMode = 'minor'; }
  }
  if (bestScore < 0.2) return { key: null, scale: null };
  return { key: NOTE_NAMES[bestKey], scale: bestMode };
}

function deriveFeatures(channel: Float32Array, sampleRate: number, bpm: number | null) {
  // RMS over first 60s.
  const limit = Math.min(channel.length, sampleRate * 60);
  let sumSq = 0, peak = 0;
  for (let i = 0; i < limit; i++) {
    const v = channel[i];
    sumSq += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sumSq / Math.max(1, limit));
  // Crude LUFS-ish estimate (-23 ref). This is not true LUFS but gives a useful signed number.
  const loudness = rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : null;
  // Energy: log-scaled RMS mapped to 0..1.
  const energy = Math.min(1, Math.max(0, (Math.log10(rms + 1e-6) + 4) / 4));

  // Spectral flatness over a downsampled FFT window — chill vs hype.
  // Cheap proxy: zero-crossing rate over RMS.
  let zc = 0;
  for (let i = 1; i < limit; i++) {
    if ((channel[i - 1] >= 0) !== (channel[i] >= 0)) zc++;
  }
  const zcr = zc / Math.max(1, limit);
  // Acousticness goes up as ZCR drops & RMS is low. Map roughly.
  const acousticness = Math.min(1, Math.max(0, 1 - energy * 0.7 - zcr * 30));

  // Danceability: tempo proximity to 90-130 + energy boost.
  let tempoFit = 0.5;
  if (bpm) {
    const inBand = bpm >= 80 && bpm <= 140;
    tempoFit = inBand ? 1 - Math.abs(110 - bpm) / 60 : 0.3;
  }
  const danceability = Math.min(1, Math.max(0, tempoFit * 0.6 + energy * 0.4));

  // Valence: bright if zcr high & energy moderate.
  const valence = Math.min(1, Math.max(0, zcr * 20 * 0.5 + energy * 0.5));

  return {
    energy: +energy.toFixed(2),
    danceability: +danceability.toFixed(2),
    valence: +valence.toFixed(2),
    acousticness: +acousticness.toFixed(2),
    loudness,
  };
}

/**
 * Try to decode an audio buffer via the pure-JS `audio-decode` path.
 * Returns null if decode produces no usable channel data — caller may
 * then invoke the ffmpeg fallback.
 */
async function tryDecode(buffer: Buffer): Promise<
  | { channel: Float32Array; sampleRate: number; duration: number | null; _err?: undefined }
  | { _err: string }
> {
  try {
    const decode = ((await import('audio-decode')) as AudioDecodeModule).default;
    const result = await decode(buffer);

    // audio-decode v3 returns `{ channelData: Float32Array[], sampleRate }`.
    // v2 returned a Web-Audio-style AudioBuffer with `getChannelData()`.
    // We support both shapes so a future downgrade / lockfile churn
    // doesn't break the analyzer silently.
    let channel: Float32Array | undefined;
    let sampleRate = 44100;
    if (result && Array.isArray(result.channelData) && result.channelData[0]) {
      // v3 shape
      channel = result.channelData[0];
      sampleRate = result.sampleRate || 44100;
    } else if (result && typeof result.getChannelData === 'function') {
      // v2 shape
      channel = result.getChannelData(0);
      sampleRate = result.sampleRate || 44100;
    } else if (result && result._channelData?.[0]) {
      // Older / internal v2 shape
      channel = result._channelData[0];
      sampleRate = result.sampleRate || 44100;
    }

    if (!channel) return { _err: 'no channel data' };
    if (channel.length <= 1000) return { _err: `channel too short (${channel.length} samples)` };

    // Duration computed from channel length — v3 doesn't ship a duration
    // field, and the v2 one was the same calculation anyway.
    return {
      channel,
      sampleRate,
      duration: sampleRate > 0 ? Math.round(channel.length / sampleRate) : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('audio-decode failed:', msg);
    return { _err: msg };
  }
}

export async function analyzeAudio(buffer: Buffer): Promise<AudioFeatures> {
  let duration: number | null = null;
  let bpm: number | null = null;
  let key: string | null = null;
  let scale: string | null = null;
  let loudness: number | null = null;
  let energy: number | null = null;
  let danceability: number | null = null;
  let valence: number | null = null;
  let acousticness: number | null = null;

  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseBuffer(buffer);
    duration = meta.format.duration ? Math.round(meta.format.duration) : null;
  } catch (err) {
    console.warn('music-metadata failed:', err);
  }

  // First attempt: pure-JS audio-decode. Handles vanilla WAV / MP3 /
  // FLAC / OGG / M4A. For anything weirder we fall through to ffmpeg
  // conversion → re-decode the resulting WAV.
  let decoded = await tryDecode(buffer);
  let ffmpegUsed = false;
  let ffmpegAvailable = false;
  const reasons: string[] = [];

  if ('_err' in decoded) {
    reasons.push(`audio-decode: ${decoded._err}`);
    // Second-chance: convert through ffmpeg, then decode the WAV. This
    // is the path that lets us analyze AAC, opus, unusual MP3 frame
    // headers, MP4 containers, etc. — every codec ffmpeg supports
    // becomes analyzable. Falls back gracefully when ffmpeg isn't
    // installed on the host.
    try {
      const conv = await import('./convert');
      ffmpegAvailable = await conv.isFfmpegInstalled();
      if (!ffmpegAvailable) {
        reasons.push('ffmpeg not available on PATH');
      } else {
        const wav = await conv.convertToWavBuffer(buffer);
        if (wav) {
          ffmpegUsed = true;
          console.info('audio-decode failed; retried after ffmpeg→WAV conversion.');
          decoded = await tryDecode(wav);
          if ('_err' in decoded) reasons.push(`after ffmpeg: ${decoded._err}`);
        } else {
          reasons.push('ffmpeg conversion produced no output (corrupt or unsupported codec)');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('ffmpeg fallback could not be invoked:', msg);
      reasons.push(`ffmpeg fallback errored: ${msg}`);
    }
  }
  const decodeOk = !('_err' in decoded);

  if (decodeOk && !('_err' in decoded)) {
    const { channel, sampleRate } = decoded;

    // BPM — robust path:
    //   1. Take a 60-second window FROM THE MIDDLE of the track. Songs
    //      often have quiet intros / outros that confuse onset detection.
    //      The middle is the most beat-stable section.
    //   2. Downsample by averaging in groups of N — preserves the *shape*
    //      of the envelope (where music-tempo derives BPM from) instead of
    //      skipping samples like the old code, which corrupted time
    //      resolution for any file over 60s.
    //   3. Try music-tempo first. If it returns nothing usable, fall back
    //      to an autocorrelation pass on the energy envelope — slower but
    //      far more reliable on clean dance / hip-hop tracks.
    //   4. Use the ACTUAL sampleRate, not a hardcoded 44.1 kHz. FLAC at
    //      48 / 96 kHz is common and the old step calc lied about timing.
    try {
      // Window selection: middle 60s, or the whole track if shorter.
      const windowSec = 60;
      const targetSampleRate = 22_050;       // music-tempo is tuned for ~22 kHz
      const windowLen = Math.min(channel.length, windowSec * sampleRate);
      const startOffset = Math.max(0, Math.floor((channel.length - windowLen) / 2));

      // Downsample by averaging (preserves envelope) to ~22 kHz. Use
      // bigger groups when sample rate is higher (48 / 96 kHz).
      const groupSize = Math.max(1, Math.round(sampleRate / targetSampleRate));
      const samples: number[] = [];
      for (let i = startOffset; i < startOffset + windowLen; i += groupSize) {
        // Average a small group of consecutive samples — preserves
        // attack transients better than sample-skipping.
        let sum = 0;
        const end = Math.min(i + groupSize, startOffset + windowLen);
        for (let j = i; j < end; j++) sum += channel[j];
        samples.push(sum / (end - i));
      }

      const MusicTempo = ((await import('music-tempo')) as MusicTempoModule).default;
      const mt = new MusicTempo(samples);
      let tempo = Number(mt.tempo);

      // music-tempo sometimes reports half/double the real tempo
      // (classic autocorrelation ambiguity). Fold extremes into the
      // 60-160 BPM band where the vast majority of music sits.
      if (tempo > 0 && tempo < 60) tempo *= 2;
      if (tempo > 200) tempo /= 2;

      if (!Number.isNaN(tempo) && tempo > 40 && tempo < 240) {
        bpm = Math.round(tempo);
      } else {
        // Fallback: autocorrelate the energy envelope ourselves. This
        // handles the common case where music-tempo silently returns
        // 0 / NaN on dense, modern productions.
        bpm = autocorrelateBpm(channel, sampleRate, startOffset, windowLen);
      }
    } catch (err) {
      console.warn('music-tempo failed:', err);
      // Last-resort: pure autocorrelation, no third-party lib involved.
      try {
        bpm = autocorrelateBpm(channel, sampleRate);
      } catch {}
    }

    // Key detection
    try {
      const k = detectKey(channel, sampleRate);
      key = k.key;
      scale = k.scale;
    } catch (err) {
      console.warn('key detection failed:', err);
    }

    // Heuristic features
    try {
      const feats = deriveFeatures(channel, sampleRate, bpm);
      energy = feats.energy;
      danceability = feats.danceability;
      valence = feats.valence;
      acousticness = feats.acousticness;
      loudness = feats.loudness;
    } catch (err) {
      console.warn('feature derivation failed:', err);
    }
  }

  return {
    bpm, key, scale, loudness, duration, energy, danceability, valence, acousticness,
    _decoded: decodeOk,
    _ffmpegUsed: ffmpegUsed,
    _ffmpegAvailable: ffmpegAvailable,
    _bytes: buffer.length,
    _reason: reasons.length > 0 ? reasons.join(' → ') : undefined,
  };
}
