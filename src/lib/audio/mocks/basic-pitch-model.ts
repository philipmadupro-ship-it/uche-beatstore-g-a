/**
 * The REAL basic-pitch model (from node_modules), loaded from memory as the
 * chord worker loads it, for tests.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BasicPitchModel, TfLike } from '../basic-pitch';

const modelDir = path.resolve(__dirname, '../../../../node_modules/@spotify/basic-pitch/model');

/**
 * tfjs and basic-pitch are loaded untyped on purpose. tfjs-core's typings
 * pull in @webgpu/types, whose global `getContext('webgpu')` overload breaks
 * unrelated canvas mocks elsewhere in the program (AsciiCoverArt.test.tsx).
 * `basic-pitch.ts` only needs the structural `TfLike` / `BasicPitchModel`.
 */
interface TfTestApi extends TfLike {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
  memory(): { numTensors: number };
  loadGraphModel(handler: unknown): Promise<BasicPitchModel>;
  io: { fromMemory(artifacts: unknown): unknown };
}
const requireCjs = createRequire(import.meta.url);
export const tf = requireCjs('@tensorflow/tfjs') as TfTestApi;
requireCjs('@tensorflow/tfjs-backend-wasm');
export const { BasicPitch } = requireCjs('@spotify/basic-pitch') as {
  BasicPitch: new (model: Promise<BasicPitchModel>) => {
    evaluateModel(audio: Float32Array, onComplete: (frames: number[][]) => void, onProgress: (p: number) => void): Promise<void>;
  };
};

export async function loadBasicPitchModel(): Promise<BasicPitchModel> {
  const json = JSON.parse(readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
  const bin = readFileSync(path.join(modelDir, 'group1-shard1of1.bin'));
  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest[0].weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
  }));
}

