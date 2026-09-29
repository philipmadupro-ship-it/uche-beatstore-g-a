/**
 * The browser side of `essentia.worker.js`: one worker, same-origin, shared by
 * every Essentia caller (BPM/key in `analyze.client.ts`, chords in
 * `chords.client.ts`), plus the one decode path they must all use.
 *
 * Browser-only. Nothing here runs on the server.
 */
import { ESSENTIA_SAMPLE_RATE, downmix, type EssentiaFeatures } from './essentia-extract';
import type { ChordSegment } from './chord-extract';

/**
 * Same-origin URLs for the classic worker and the two essentia.js UMD builds
 * it loads. The bundler copies each `new URL(…, import.meta.url)` target into
 * /_next/static/media verbatim — see the header of `essentia.worker.js`. They
 * are relative to THIS file; move it and they move with it.
 */
const ESSENTIA_WORKER_URL = () => new URL('./essentia.worker.js', import.meta.url);
const ESSENTIA_WASM_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia-wasm.umd.js', import.meta.url).href;
const ESSENTIA_CORE_URL = () =>
  new URL('../../../node_modules/essentia.js/dist/essentia.js-core.umd.js', import.meta.url).href;

interface TaskResult {
  features: EssentiaFeatures;
  chords: ChordSegment[];
}
export type EssentiaTask = keyof TaskResult;

let worker: Worker | null = null;
let nextId = 0;

function dropWorker() {
  worker?.terminate();
  worker = null;
}

/**
 * Run one task in the shared worker. The signal must be mono at
 * `ESSENTIA_SAMPLE_RATE` (see `decodeMono44k`); it is transferred, not copied,
 * so the caller must not use it afterwards.
 *
 * Rejects on a worker error, a load failure or `timeoutMs`. A worker that
 * failed to load, or hung, is dropped so the next call starts a fresh one.
 */
export function runEssentiaTask<T extends EssentiaTask>(
  task: T,
  signal: Float32Array,
  timeoutMs: number,
): Promise<TaskResult[T]> {
  return new Promise((resolve, reject) => {
    try {
      worker ??= new Worker(ESSENTIA_WORKER_URL());
    } catch (err) {
      reject(err);
      return;
    }
    const w = worker;
    const id = ++nextId;
    const cleanup = () => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string } & Partial<TaskResult>>) => {
      if (e.data?.id !== id) return;
      cleanup();
      const value = e.data[task];
      if (e.data.ok && value !== undefined) resolve(value as TaskResult[T]);
      else reject(new Error(e.data.error || 'Essentia worker error'));
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      dropWorker();
      reject(new Error(e.message || 'Essentia worker failed to load'));
    };
    const timer = setTimeout(() => {
      cleanup();
      dropWorker();
      reject(new Error(`Essentia worker timed out (${task})`));
    }, timeoutMs);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(
      { id, task, wasmUrl: ESSENTIA_WASM_URL(), coreUrl: ESSENTIA_CORE_URL(), signal },
      [signal.buffer],
    );
  });
}

/**
 * Decode AND resample in one step: an OfflineAudioContext decodes to its own
 * rate. A plain AudioContext decodes at the device rate (usually 48 kHz), and
 * Essentia's extractors assume 44.1 kHz — at 48 kHz a 140 BPM F-minor beat
 * reads as 128.6 BPM C major, and HPCP disagrees with SpectralPeaks about
 * every bin. All channels are averaged; channel 0 alone drops anything panned
 * right.
 */
export async function decodeMono44k(buffer: ArrayBuffer): Promise<{ mono: Float32Array; duration: number }> {
  const ctx = new OfflineAudioContext(1, 1, ESSENTIA_SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  return { mono: downmix(channels), duration: Math.round(decoded.duration) };
}
