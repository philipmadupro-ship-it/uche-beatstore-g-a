import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { extractEssentiaFeatures, ESSENTIA_SAMPLE_RATE, type EssentiaCore } from './essentia-extract';

/**
 * `essentia.worker.js` is a classic worker script with its own copy of the
 * extraction (the bundler cannot bundle a worker entry here — see its header).
 * This runs THAT FILE, loading the same two UMD builds the browser loads, and
 * requires its output to equal `extractEssentiaFeatures` on the same signal.
 * If either copy changes alone, this fails.
 */
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'node_modules/essentia.js/dist');
const workerSource = readFileSync(path.join(__dirname, 'essentia.worker.js'), 'utf8');

type Reply = { id: number; ok: boolean; features?: unknown; error?: string };

function bootWorker() {
  const posted: Reply[] = [];
  const sandbox: Record<string, unknown> = {
    // Browser-worker globals only: no `require`/`module`/`process`, so the
    // UMD builds take their worker branch exactly as they do in Chromium.
    WebAssembly, Float32Array, Uint8Array, Math, console, TextDecoder, performance,
    setTimeout, clearTimeout,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    postMessage: (m: Reply) => posted.push(m),
    location: { href: 'http://localhost/_next/static/media/essentia.worker.js' },
  };
  const context = vm.createContext(sandbox);
  // In a worker, `self` IS the global object.
  sandbox.self = context;
  sandbox.importScripts = (...urls: string[]) => {
    for (const url of urls) vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url });
  };
  vm.runInContext(workerSource, context, { filename: 'essentia.worker.js' });
  const send = (data: unknown): Reply => {
    (context.onmessage as (e: { data: unknown }) => void)({ data });
    return posted.pop() as Reply;
  };
  return { send };
}

function beat(seconds: number, bpm: number): Float32Array {
  const sr = ESSENTIA_SAMPLE_RATE;
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of [174.61, 207.65, 261.63]) v += Math.sin(2 * Math.PI * f * t) * 0.12;
    const kick = t % period;
    if (kick < 0.03) v += Math.sin(2 * Math.PI * 55 * t) * (1 - kick / 0.03);
    out[i] = v;
  }
  return out;
}

describe('essentia.worker.js', () => {
  const worker = bootWorker();
  const require = createRequire(import.meta.url);
  const { Essentia, EssentiaWASM } = require('essentia.js') as {
    Essentia: new (wasm: unknown) => EssentiaCore;
    EssentiaWASM: unknown;
  };
  const reference = new Essentia(EssentiaWASM);
  const urls = {
    wasmUrl: path.join(dist, 'essentia-wasm.umd.js'),
    coreUrl: path.join(dist, 'essentia.js-core.umd.js'),
  };

  it.each([
    ['a 20 s beat', 20, 140],
    ['a track longer than the analysis window', 75, 96],
  ])('matches the shared extractor on %s', (_label, seconds, bpm) => {
    const signal = beat(seconds, bpm);
    const reply = worker.send({ id: 7, ...urls, signal: signal.slice() });
    expect(reply.error).toBeUndefined();
    expect(reply).toMatchObject({ id: 7, ok: true });
    expect(reply.features).toEqual(extractEssentiaFeatures(reference, signal));
  }, 60_000);

  it('matches on a clip too short to measure', () => {
    const signal = beat(1, 140);
    expect(worker.send({ id: 8, ...urls, signal }).features).toEqual(extractEssentiaFeatures(reference, signal));
  });

  it('reports a failure instead of throwing', () => {
    const reply = worker.send({ id: 9, ...urls, signal: null });
    expect(reply).toMatchObject({ id: 9, ok: false });
    expect(typeof reply.error).toBe('string');
  });
});
