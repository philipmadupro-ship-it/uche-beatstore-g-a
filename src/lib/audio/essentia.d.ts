/**
 * essentia.js 0.1.3 ships no types for its dist files.
 *
 * The shapes matter: this file used to declare `EssentiaWASM` as a
 * `() => Promise<runtime>` factory with the algorithms on it. The real export
 * is the instantiated WASM module, and the algorithms live on the `Essentia`
 * core class. tsc accepted every call against the wrong declaration, so the
 * client analysis threw at runtime on every upload and nothing flagged it.
 * Only the subpaths the app imports are declared, so a new import has to
 * state its shape here.
 */
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  /** The Emscripten module, already instantiated (the WASM is embedded and compiled synchronously). */
  export const EssentiaWASM: { EssentiaJS: unknown; arrayToVector(input: Float32Array): unknown };
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export default class Essentia {
    constructor(wasmModule: unknown, isDebug?: boolean);
    arrayToVector(input: Float32Array): unknown;
    vectorToArray(input: unknown): Float32Array;
    RhythmExtractor2013(signal: unknown, maxTempo?: number, method?: string, minTempo?: number): {
      bpm: number; confidence: number; ticks: unknown; estimates: unknown; bpmIntervals: unknown;
    };
    KeyExtractor(signal: unknown): { key: string; scale: string; strength: number };
    delete(): void;
    shutdown(): void;
  }
}
