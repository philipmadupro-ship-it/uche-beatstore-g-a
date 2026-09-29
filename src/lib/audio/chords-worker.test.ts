import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { chordsFromBuckets, extractChords, hpcpBuckets, type ChordEssentiaCore } from './chord-extract';
import { basicPitchNoteFrames, BASIC_PITCH_FRAME_SECONDS, BASIC_PITCH_SAMPLE_RATE, type BasicPitchModel } from './basic-pitch';
import { loadBasicPitchModel, tf } from './mocks/basic-pitch-model';
import { progression } from './mocks/chord-signal';
import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';

/**
 * `chords.worker.js` is a classic worker script with its own copy of the
 * extraction (see its header). This runs THAT FILE in a worker-like sandbox,
 * loading the same UMD builds, WASM binaries and model the browser loads, and
 * requires its output to equal `chord-extract.ts` + `basic-pitch.ts` on the
 * same signal. If either copy changes alone, this fails.
 */
const root = path.resolve(__dirname, '../../..');
const nm = (p: string) => path.join(root, 'node_modules', p);
const workerSource = readFileSync(path.join(__dirname, 'chords.worker.js'), 'utf8');

type Reply = { id: number; ok: boolean; chords?: unknown; engine?: string; basicPitchError?: string; error?: string };

function bootWorker() {
  let resolveNext: ((r: Reply) => void) | null = null;
  const sandbox: Record<string, unknown> = {
    // Browser-worker globals only: no `require`/`module`/`process`, so the UMD
    // builds take their browser branch exactly as they do in Chromium.
    WebAssembly, Math, console, TextDecoder, TextEncoder, performance, setTimeout, clearTimeout, queueMicrotask,
    // One realm's typed arrays for the worker, the UMD builds and the test.
    ArrayBuffer, Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray,
    Uint16Array, Uint32Array, DataView,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    // Same-origin static files in the browser; files on disk here.
    fetch: async (url: string) => new Response(readFileSync(url), {
      headers: { 'Content-Type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
    }),
    Response,
    navigator: { userAgent: 'vitest-worker', hardwareConcurrency: 1 },
    postMessage: (m: Reply) => resolveNext?.(m),
    location: { href: 'http://localhost/_next/static/media/chords.worker.js' },
  };
  const context = vm.createContext(sandbox);
  sandbox.self = context;
  sandbox.importScripts = (...urls: string[]) => {
    for (const url of urls) vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url });
  };
  vm.runInContext(workerSource, context, { filename: 'chords.worker.js' });
  const send = (data: unknown): Promise<Reply> => new Promise((resolve) => {
    resolveNext = resolve;
    (context.onmessage as (e: { data: unknown }) => void)({ data });
  });
  return { send };
}

const essentiaUrls = {
  wasmUrl: nm('essentia.js/dist/essentia-wasm.umd.js'),
  coreUrl: nm('essentia.js/dist/essentia.js-core.umd.js'),
};
const basicPitchUrls = {
  tfUrl: nm('@tensorflow/tfjs/dist/tf.min.js'),
  tfWasmUrl: nm('@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js'),
  wasmPaths: {
    'tfjs-backend-wasm.wasm': nm('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm'),
    'tfjs-backend-wasm-simd.wasm': nm('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm'),
    'tfjs-backend-wasm-threaded-simd.wasm': nm('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm'),
  },
  modelUrl: nm('@spotify/basic-pitch/model/model.json'),
  weightsUrl: nm('@spotify/basic-pitch/model/group1-shard1of1.bin'),
};

describe('chords.worker.js', () => {
  const worker = bootWorker();
  const require = createRequire(import.meta.url);
  const { Essentia, EssentiaWASM } = require('essentia.js') as {
    Essentia: new (wasm: unknown) => ChordEssentiaCore;
    EssentiaWASM: unknown;
  };
  const reference = new Essentia(EssentiaWASM);
  let model: BasicPitchModel;

  beforeAll(async () => {
    await tf.setBackend('wasm');
    await tf.ready();
    model = await loadBasicPitchModel();
  }, 60_000);

  const chords = [['C', 'E', 'G'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['G', 'B', 'D']] as Parameters<typeof progression>[0];

  it('blends basic-pitch in, and matches chord-extract.ts + basic-pitch.ts', async () => {
    const s44 = progression(chords);
    const s22 = progression(chords, 2, BASIC_PITCH_SAMPLE_RATE);
    const reply = await worker.send({
      id: 3, ...essentiaUrls, signal: s44.slice(), basicPitch: { signal: s22.slice(), ...basicPitchUrls },
    });
    expect(reply.error).toBeUndefined();
    expect(reply.basicPitchError).toBeUndefined();
    expect(reply).toMatchObject({ id: 3, ok: true, engine: 'essentia+basic-pitch' });
    expect(reply.chords).toEqual([
      { time: 0, chord: 'C' }, { time: 2, chord: 'Am' }, { time: 4, chord: 'F' }, { time: 6, chord: 'G' },
    ]);
    const frames = await basicPitchNoteFrames(tf, model, s22);
    expect(reply.chords).toEqual(extractChords(reference, s44, frames, BASIC_PITCH_FRAME_SECONDS));
  }, 120_000);

  it('is HPCP alone, and matches, without a basicPitch config', async () => {
    const s44 = progression(chords);
    const reply = await worker.send({ id: 4, ...essentiaUrls, signal: s44.slice() });
    expect(reply).toMatchObject({ id: 4, ok: true, engine: 'essentia' });
    expect(reply.chords).toEqual(chordsFromBuckets(hpcpBuckets(reference, s44), null));
  }, 60_000);

  it('falls back to HPCP alone, and says why, when basic-pitch cannot load', async () => {
    const s44 = progression(chords);
    // A fresh worker: the shared one has already cached the model.
    const reply = await bootWorker().send({
      id: 5, ...essentiaUrls, signal: s44.slice(),
      basicPitch: { signal: progression(chords, 2, BASIC_PITCH_SAMPLE_RATE), ...basicPitchUrls, modelUrl: '/nonexistent/model.json' },
    });
    expect(reply).toMatchObject({ id: 5, ok: true, engine: 'essentia' });
    expect(typeof reply.basicPitchError).toBe('string');
    expect(reply.chords).toEqual(chordsFromBuckets(hpcpBuckets(reference, s44), null));
  }, 60_000);

  it('keeps timestamps after a silent intro, and returns nothing for silence', async () => {
    const tones = progression([['D', 'F#', 'A'], ['B', 'D', 'F#']]);
    const signal = new Float32Array(ESSENTIA_SAMPLE_RATE * 2 + tones.length);
    signal.set(tones, ESSENTIA_SAMPLE_RATE * 2);
    expect((await worker.send({ id: 6, ...essentiaUrls, signal: signal.slice() })).chords)
      .toEqual(chordsFromBuckets(hpcpBuckets(reference, signal), null));
    expect((await worker.send({ id: 7, ...essentiaUrls, signal: new Float32Array(ESSENTIA_SAMPLE_RATE * 2) })).chords).toEqual([]);
  }, 60_000);

  it('reports a failure instead of throwing', async () => {
    const reply = await worker.send({ id: 9, ...essentiaUrls, signal: null });
    expect(reply).toMatchObject({ id: 9, ok: false });
    expect(typeof reply.error).toBe('string');
  });
});
