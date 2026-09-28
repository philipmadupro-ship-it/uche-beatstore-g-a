/**
 * Browser-only chord detection: Essentia.js HPCP chromagram + 24 major/minor
 * triad templates, in a Web Worker so a long track doesn't lock the UI.
 *
 * Output: an ordered array of { time, chord } segments where `chord` is a
 * label like "C", "Am", "F#m" (or "N" for no/low-confidence chord). Adjacent
 * identical chords are merged so the timeline is compact.
 *
 * The extraction lives in `chord-extract.ts` (tested against the real
 * package); `chords.worker.js` is its classic-worker copy. The worker and the
 * two essentia.js UMD builds are same-origin `/_next/static/media` files, like
 * `analyze.client.ts` — the old version loaded essentia.js from jsDelivr, which
 * the CSP does not allow, and could not have worked even where it loaded.
 */

import { downmix, ESSENTIA_SAMPLE_RATE } from './essentia-extract';
import type { ChordSegment } from './chord-extract';

export type { ChordSegment } from './chord-extract';

/** ~20 ms of work per second of audio; this is a generous ceiling for a long track. */
const WORKER_TIMEOUT_MS = 120_000;

/** See the header of `essentia.worker.js` for why these are `new URL(…)` rather than imports. */
const CHORDS_WORKER_URL = () => new URL('./chords.worker.js', import.meta.url);
const ESSENTIA_WASM_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia-wasm.umd.js', import.meta.url).href;
const ESSENTIA_CORE_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia.js-core.umd.js', import.meta.url).href;

export async function detectChordsFromUrl(rawUrl: string): Promise<ChordSegment[]> {
  if (typeof window === 'undefined') return [];

  const url = rawUrl.startsWith('/') ? rawUrl : `/api/audio?src=${encodeURIComponent(rawUrl)}`;

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('Chord detection: audio fetch failed', err);
    return [];
  }

  // Decode AND resample in one step, as analyze.client.ts does: an
  // OfflineAudioContext decodes to its own rate, so frames and timestamps are
  // the same on a 44.1 kHz and a 48 kHz device.
  let mono: Float32Array;
  try {
    const ctx = new OfflineAudioContext(1, 1, ESSENTIA_SAMPLE_RATE);
    const decoded = await ctx.decodeAudioData(buffer);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    // Copy: the worker takes ownership of the buffer.
    mono = downmix(channels).slice();
  } catch (err) {
    console.warn('Chord detection: decode failed', err);
    return [];
  }

  try {
    return await runChordWorker(mono);
  } catch (err) {
    console.warn('Chord detection failed', err);
    return [];
  }
}

function runChordWorker(signal: Float32Array): Promise<ChordSegment[]> {
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
    worker.onmessage = (e: MessageEvent<{ ok: boolean; chords?: ChordSegment[]; error?: string }>) => {
      done();
      if (e.data?.ok && Array.isArray(e.data.chords)) resolve(e.data.chords);
      else reject(new Error(e.data?.error || 'Chord worker error'));
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || 'Chord worker failed to load'));
    };
    worker.postMessage(
      { id: 1, wasmUrl: ESSENTIA_WASM_URL(), coreUrl: ESSENTIA_CORE_URL(), signal },
      [signal.buffer],
    );
  });
}
