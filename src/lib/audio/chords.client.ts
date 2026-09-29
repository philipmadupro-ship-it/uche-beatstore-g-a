/**
 * Browser-only chord detection in a Web Worker: Essentia.js HPCP chroma blended
 * with Spotify basic-pitch note activations (tfjs, WASM backend), matched
 * against 24 major/minor triad templates.
 *
 * Output: an ordered array of { time, chord } segments where `chord` is a
 * label like "C", "Am", "F#m" (or "N" for no/low-confidence chord). Adjacent
 * identical chords are merged so the timeline is compact.
 *
 * On 40 GuitarSet comping takes (real acoustic guitar, lead-sheet chords
 * reduced to triads) HPCP alone labelled 52.7% of seconds correctly, basic-pitch
 * alone 72.3%, and the blend 77.2%; see docs/codex-execution-log.md (AUDIO-06).
 * If basic-pitch cannot load or run, the result is HPCP alone.
 *
 * The extraction lives in `chord-extract.ts` + `basic-pitch.ts` (tested against
 * the real packages); `chords.worker.js` is their classic-worker copy. Every
 * script, WASM binary and model file is a same-origin `/_next/static/media`
 * file, like `analyze.client.ts` — nothing is fetched from a CDN, so the
 * enforced /store CSP has nothing to block.
 */

import { downmix, ESSENTIA_SAMPLE_RATE } from './essentia-extract';
import { BASIC_PITCH_SAMPLE_RATE } from './basic-pitch';
import type { ChordSegment } from './chord-extract';

export type { ChordSegment } from './chord-extract';

/** Which analysis produced a timeline: the blend, or HPCP alone when basic-pitch could not run. */
export type ChordEngine = 'essentia+basic-pitch' | 'essentia';

export interface ChordDetection {
  chords: ChordSegment[];
  engine: ChordEngine | null;
}

/**
 * basic-pitch runs ~9x faster than realtime on the WASM backend and HPCP far
 * faster still, so this covers a long track on a slow machine.
 */
const WORKER_TIMEOUT_MS = 180_000;

/** See the header of `essentia.worker.js` for why these are `new URL(…)` rather than imports. */
const CHORDS_WORKER_URL = () => new URL('./chords.worker.js', import.meta.url);
const ESSENTIA_WASM_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia-wasm.umd.js', import.meta.url).href;
const ESSENTIA_CORE_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia.js-core.umd.js', import.meta.url).href;
const basicPitchAssets = () => ({
  tfUrl: new URL('../../../node_modules/@tensorflow/tfjs/dist/tf.min.js', import.meta.url).href,
  tfWasmUrl: new URL('../../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js', import.meta.url).href,
  // All three names are required by setWasmPaths; the threaded build is only
  // chosen on a cross-origin-isolated page, which this app is not.
  wasmPaths: {
    'tfjs-backend-wasm.wasm':
      new URL('../../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', import.meta.url).href,
    'tfjs-backend-wasm-simd.wasm':
      new URL('../../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', import.meta.url).href,
    'tfjs-backend-wasm-threaded-simd.wasm':
      new URL('../../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm', import.meta.url).href,
  },
  modelUrl: new URL('../../../node_modules/@spotify/basic-pitch/model/model.json', import.meta.url).href,
  weightsUrl: new URL('../../../node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin', import.meta.url).href,
});

export async function detectChordsFromUrl(rawUrl: string): Promise<ChordSegment[]> {
  return (await detectChordsWithEngine(rawUrl)).chords;
}

/** As `detectChordsFromUrl`, and says which analysis produced the timeline. */
export async function detectChordsWithEngine(rawUrl: string): Promise<ChordDetection> {
  const none: ChordDetection = { chords: [], engine: null };
  if (typeof window === 'undefined') return none;

  const url = rawUrl.startsWith('/') ? rawUrl : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Chord detection: audio fetch failed', err);
    return none;
  }

  // Decode AND resample in one step, as analyze.client.ts does: an
  // OfflineAudioContext decodes to its own rate, so frames and timestamps are
  // the same on a 44.1 kHz and a 48 kHz device. Essentia wants 44.1 kHz and
  // basic-pitch 22.05 kHz; decoding twice is cheaper than resampling in JS.
  let mono44k: Float32Array;
  let mono22k: Float32Array | null = null;
  try {
    mono44k = await decodeMono(buffer.slice(0), ESSENTIA_SAMPLE_RATE);
  } catch (err) {
    console.warn('Chord detection: decode failed', err);
    return none;
  }
  try {
    mono22k = await decodeMono(buffer, BASIC_PITCH_SAMPLE_RATE);
  } catch (err) {
    console.warn('Chord detection: 22.05 kHz decode failed; using HPCP alone', err);
  }

  try {
    return await runChordWorker(mono44k, mono22k);
  } catch (err) {
    console.warn('Chord detection failed', err);
    return none;
  }
}

async function decodeMono(buffer: ArrayBuffer, sampleRate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await ctx.decodeAudioData(buffer);
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  // Copy: the worker takes ownership of the buffer.
  return downmix(channels).slice();
}

function runChordWorker(mono44k: Float32Array, mono22k: Float32Array | null): Promise<ChordDetection> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(CHORDS_WORKER_URL());
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('Chord worker timed out'));
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = (
      e: MessageEvent<{ ok: boolean; chords?: ChordSegment[]; engine?: ChordEngine; basicPitchError?: string; error?: string }>,
    ) => {
      done();
      if (e.data?.ok && Array.isArray(e.data.chords)) {
        if (e.data.basicPitchError) console.warn('basic-pitch unavailable; chords from HPCP alone:', e.data.basicPitchError);
        resolve({ chords: e.data.chords, engine: e.data.engine ?? 'essentia' });
      } else {
        reject(new Error(e.data?.error || 'Chord worker error'));
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || 'Chord worker failed to load'));
    };
    const transfer: Transferable[] = [mono44k.buffer];
    const basicPitch = mono22k ? { signal: mono22k, ...basicPitchAssets() } : undefined;
    if (mono22k) transfer.push(mono22k.buffer);
    worker.postMessage(
      { id: 1, wasmUrl: ESSENTIA_WASM_URL(), coreUrl: ESSENTIA_CORE_URL(), signal: mono44k, basicPitch },
      transfer,
    );
  });
}
