import { describe, it, expect, beforeAll } from 'vitest';
import {
  basicPitchNoteFrames, BASIC_PITCH_FRAME_SECONDS, BASIC_PITCH_KEYS, BASIC_PITCH_SAMPLE_RATE, type BasicPitchModel, type TfLike,
} from './basic-pitch';
import { chordsFromBuckets, noteBuckets } from './chord-extract';
import { progression } from './mocks/chord-signal';
import { BasicPitch, loadBasicPitchModel, tf } from './mocks/basic-pitch-model';

let model: BasicPitchModel;
const tfLike: TfLike = tf;

beforeAll(async () => {
  await tf.setBackend('wasm');
  await tf.ready();
  model = await loadBasicPitchModel();
}, 60_000);

/** Runs the REAL basic-pitch model on tfjs' WASM backend, the backend the browser uses. */
describe('basicPitchNoteFrames (real model, WASM backend)', () => {
  const signal = progression([['C', 'E', 'G'], ['G', 'B', 'D']], 2, BASIC_PITCH_SAMPLE_RATE);

  it("reproduces @spotify/basic-pitch's own evaluateModel frames", async () => {
    const ours = await basicPitchNoteFrames(tfLike, model, signal);
    // The package cannot run on the WASM backend: its prepareData calls
    // tf.zeros, and tfjs-backend-wasm 3.21's Fill kernel loses the dtype
    // ("Unknown dtype undefined"). So its reference output comes from CPU.
    const theirs: number[][] = [];
    await tf.setBackend('cpu');
    try {
      await new BasicPitch(Promise.resolve(model)).evaluateModel(signal, (frames) => theirs.push(...frames), () => {});
    } finally {
      await tf.setBackend('wasm');
    }
    expect(ours.length).toBe(theirs.length);
    expect(ours.length).toBe(Math.floor(signal.length * (86 / BASIC_PITCH_SAMPLE_RATE)));
    expect(ours[0]).toHaveLength(BASIC_PITCH_KEYS);
    for (let i = 0; i < ours.length; i++) {
      for (let k = 0; k < BASIC_PITCH_KEYS; k++) expect(ours[i][k]).toBeCloseTo(theirs[i][k], 3);
    }
  }, 60_000);

  it('leaves no tensors behind (the package leaks every window)', async () => {
    const before = tf.memory().numTensors;
    await basicPitchNoteFrames(tfLike, model, signal);
    expect(tf.memory().numTensors).toBe(before);
  }, 60_000);

  it('hears the triads: note chroma alone names C then G', async () => {
    const frames = await basicPitchNoteFrames(tfLike, model, signal);
    const notes = noteBuckets(frames, BASIC_PITCH_FRAME_SECONDS);
    expect(chordsFromBuckets([], notes).map((s) => s.chord)).toEqual(['C', 'G']);
  }, 60_000);

  it('returns no frames for an empty signal', async () => {
    expect(await basicPitchNoteFrames(tfLike, model, new Float32Array(0))).toEqual([]);
  });
});
