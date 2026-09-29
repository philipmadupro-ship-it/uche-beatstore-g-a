/**
 * The browser side of `essentia.worker.js`: one worker, same-origin, shared by
 * every Essentia caller (BPM/key in `analyze.client.ts`, chords in
 * `chords.client.ts`), plus the one decode path they must all use.
 *
 * Browser-only. Nothing here runs on the server.
 */
import { ESSENTIA_SAMPLE_RATE, downmix, type EssentiaFeatures } from './essentia-extract';
import type { ChordSegment } from './chord-extract';

/** Which analysis produced a chord timeline: the blend, or HPCP alone when basic-pitch could not run. */
export type ChordEngine = 'essentia+basic-pitch' | 'essentia';

export interface ChordResult {
  chords: ChordSegment[];
  engine: ChordEngine;
  /** Why basic-pitch was skipped, when it was asked for and could not run. */
  basicPitchError?: string;
}

/** The chords task's optional basic-pitch stage: mono audio at 22.05 kHz, plus its assets. */
export interface BasicPitchPayload {
  signal: Float32Array;
  tfUrl: string;
  tfWasmUrl: string;
  wasmPaths: Record<string, string>;
  modelUrl: string;
  weightsUrl: string;
}

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
  chords: ChordResult;
}
export type EssentiaTask = keyof TaskResult;

/**
 * Same-origin URLs for the chords task's basic-pitch stage: the tfjs UMD build,
 * its WASM backend (all three binaries — `setWasmPaths` requires every name,
 * though the threaded one is only picked on a cross-origin-isolated page,
 * which this app is not) and the model. Fetched only when chords run.
 */
export const basicPitchAssets = (): Omit<BasicPitchPayload, 'signal'> => ({
  tfUrl: new URL('../../../node_modules/@tensorflow/tfjs/dist/tf.min.js', import.meta.url).href,
  tfWasmUrl: new URL('../../../node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js', import.meta.url).href,
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

let worker: Worker | null = null;
let nextId = 0;

function dropWorker() {
  worker?.terminate();
  worker = null;
}

/**
 * Run one task in the shared worker. The signal must be mono at
 * `ESSENTIA_SAMPLE_RATE` (see `decodeMono44k`); it is transferred, not copied,
 * so the caller must not use it afterwards. The chords task may also carry a
 * basic-pitch payload, whose signal is transferred too.
 *
 * Rejects on a worker error, a load failure or `timeoutMs`. A worker that
 * failed to load, or hung, is dropped so the next call starts a fresh one.
 */
export function runEssentiaTask<T extends EssentiaTask>(
  task: T,
  signal: Float32Array,
  timeoutMs: number,
  basicPitch?: T extends 'chords' ? BasicPitchPayload : never,
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
    const onMessage = (
      e: MessageEvent<{
        id: number; ok: boolean; error?: string; features?: EssentiaFeatures; chords?: ChordSegment[];
        engine?: ChordEngine; basicPitchError?: string;
      }>,
    ) => {
      if (e.data?.id !== id) return;
      cleanup();
      if (!e.data.ok) {
        reject(new Error(e.data.error || 'Essentia worker error'));
      } else if (task === 'chords' && Array.isArray(e.data.chords)) {
        const result: ChordResult = { chords: e.data.chords, engine: e.data.engine ?? 'essentia' };
        if (e.data.basicPitchError) result.basicPitchError = e.data.basicPitchError;
        resolve(result as TaskResult[T]);
      } else if (task === 'features' && e.data.features) {
        resolve(e.data.features as TaskResult[T]);
      } else {
        reject(new Error('Essentia worker error'));
      }
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
    const transfer: Transferable[] = [signal.buffer];
    if (basicPitch) transfer.push(basicPitch.signal.buffer);
    w.postMessage(
      { id, task, wasmUrl: ESSENTIA_WASM_URL(), coreUrl: ESSENTIA_CORE_URL(), signal, basicPitch },
      transfer,
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
  return decodeMonoAt(buffer, ESSENTIA_SAMPLE_RATE);
}

/** As `decodeMono44k`, at any rate (basic-pitch wants 22.05 kHz). */
export async function decodeMonoAt(
  buffer: ArrayBuffer,
  sampleRate: number,
): Promise<{ mono: Float32Array; duration: number }> {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  return { mono: downmix(channels), duration: Math.round(decoded.duration) };
}
