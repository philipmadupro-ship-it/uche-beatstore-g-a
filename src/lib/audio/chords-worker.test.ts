import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { extractChords, type ChordEssentiaCore } from './chord-extract';
import { progression } from './mocks/chord-signal';
import { ESSENTIA_SAMPLE_RATE } from './essentia-extract';

/**
 * `chords.worker.js` is a classic worker script with its own copy of the
 * extraction (see its header). This runs THAT FILE, loading the same two UMD
 * builds the browser loads, and requires its output to equal `extractChords`
 * on the same signal. If either copy changes alone, this fails.
 */
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'node_modules/essentia.js/dist');
const workerSource = readFileSync(path.join(__dirname, 'chords.worker.js'), 'utf8');

type Reply = { id: number; ok: boolean; chords?: unknown; error?: string };

function bootWorker() {
  const posted: Reply[] = [];
  const sandbox: Record<string, unknown> = {
    // Browser-worker globals only: no `require`/`module`/`process`, so the
    // UMD builds take their worker branch exactly as they do in Chromium.
    WebAssembly, Float32Array, Uint8Array, Math, console, TextDecoder, performance,
    setTimeout, clearTimeout,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    postMessage: (m: Reply) => posted.push(m),
    location: { href: 'http://localhost/_next/static/media/chords.worker.js' },
  };
  const context = vm.createContext(sandbox);
  sandbox.self = context;
  sandbox.importScripts = (...urls: string[]) => {
    for (const url of urls) vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url });
  };
  vm.runInContext(workerSource, context, { filename: 'chords.worker.js' });
  const send = (data: unknown): Reply => {
    (context.onmessage as (e: { data: unknown }) => void)({ data });
    return posted.pop() as Reply;
  };
  return { send };
}

describe('chords.worker.js', () => {
  const worker = bootWorker();
  const require = createRequire(import.meta.url);
  const { Essentia, EssentiaWASM } = require('essentia.js') as {
    Essentia: new (wasm: unknown) => ChordEssentiaCore;
    EssentiaWASM: unknown;
  };
  const reference = new Essentia(EssentiaWASM);
  const urls = {
    wasmUrl: path.join(dist, 'essentia-wasm.umd.js'),
    coreUrl: path.join(dist, 'essentia.js-core.umd.js'),
  };

  it('detects a progression and matches the shared extractor', () => {
    const signal = progression([['C', 'E', 'G'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['G', 'B', 'D']]);
    const reply = worker.send({ id: 3, ...urls, signal: signal.slice() });
    expect(reply.error).toBeUndefined();
    expect(reply).toMatchObject({ id: 3, ok: true });
    expect(reply.chords).toEqual([
      { time: 0, chord: 'C' }, { time: 2, chord: 'Am' }, { time: 4, chord: 'F' }, { time: 6, chord: 'G' },
    ]);
    expect(reply.chords).toEqual(extractChords(reference, signal));
  }, 60_000);

  it('matches on a silent intro, and on pure silence', () => {
    const chords = progression([['D', 'F#', 'A'], ['B', 'D', 'F#']]);
    const signal = new Float32Array(ESSENTIA_SAMPLE_RATE * 2 + chords.length);
    signal.set(chords, ESSENTIA_SAMPLE_RATE * 2);
    expect(worker.send({ id: 4, ...urls, signal: signal.slice() }).chords).toEqual(extractChords(reference, signal));
    const silence = new Float32Array(ESSENTIA_SAMPLE_RATE * 2);
    expect(worker.send({ id: 5, ...urls, signal: silence }).chords).toEqual([]);
  }, 60_000);

  it('reports a failure instead of throwing', () => {
    const reply = worker.send({ id: 9, ...urls, signal: null });
    expect(reply).toMatchObject({ id: 9, ok: false });
    expect(typeof reply.error).toBe('string');
  });
});
