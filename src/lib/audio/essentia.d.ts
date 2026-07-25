declare module 'essentia.js' {
  interface EssentiaRuntime {
    arrayToVector(input: Float32Array): unknown;
    RhythmExtractor2013(signal: unknown): { bpm: number };
    KeyExtractor(signal: unknown): { key?: string | null; scale?: string | null };
    LoudnessEBUR128(left: unknown, right: unknown): { integratedLoudness: number };
    delete(): void;
  }

  const EssentiaWASM: () => Promise<EssentiaRuntime>;
  export default EssentiaWASM;
}
