/**
 * Spotify basic-pitch (Apache-2.0) note transcription, reduced to what chord
 * detection needs: per-frame activations for the 88 piano keys.
 *
 * This reimplements `BasicPitch.evaluateModel` from @spotify/basic-pitch 1.0.1
 * with the SAME constants and windowing (`basic-pitch.test.ts` holds its output
 * equal to the package's own), for two reasons:
 *
 *   - The package's loop never disposes a tensor, so every 2 s window leaks
 *     three model outputs plus slices; a long track grows the backend's memory
 *     until the tab struggles. Each window here runs in `tf.tidy` and its
 *     result is disposed after it is read.
 *   - It imports `@tensorflow/tfjs` as a module, which the classic chord worker
 *     cannot do (see the header of `essentia.worker.js`). The worker loads the
 *     tfjs UMD build instead and carries a copy of this loop.
 *
 * `tf` and the model are passed in, so Node tests can run the real model on
 * any backend. In the browser the worker uses the WASM backend: the WebGL one
 * hung compiling shaders on a machine without a GPU, and plain CPU is ~1.6x
 * slower than realtime, where WASM is ~9x faster than realtime.
 */

export const BASIC_PITCH_SAMPLE_RATE = 22050;
const FFT_HOP = 256;
/** Output frames per second: floor(22050 / 256) = 86, as the package computes it. */
export const BASIC_PITCH_FPS = Math.floor(BASIC_PITCH_SAMPLE_RATE / FFT_HOP);
/** Seconds per output frame, exactly: the model emits one frame per 256-sample hop. */
export const BASIC_PITCH_FRAME_SECONDS = FFT_HOP / BASIC_PITCH_SAMPLE_RATE;
export const BASIC_PITCH_KEYS = 88;
const AUDIO_N_SAMPLES = BASIC_PITCH_SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = N_OVERLAPPING_FRAMES / 2;
const OVERLAP_LENGTH_FRAMES = N_OVERLAPPING_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH_FRAMES;
/** The model's note-activation output ("frames"), as the package names it. */
const FRAMES_OUTPUT = 'Identity_1';

interface TensorLike {
  shape: number[];
  slice(begin: number[], size: number[]): TensorLike;
  reshape(shape: number[]): TensorLike;
  array(): Promise<unknown>;
  dispose(): void;
}

export interface BasicPitchModel {
  execute(input: TensorLike, output: string): TensorLike;
}

/** The subset of the tfjs namespace this module uses. */
export interface TfLike {
  tidy<T>(fn: () => T): T;
  tensor3d(values: Float32Array, shape: [number, number, number]): TensorLike;
}

/**
 * Note activations for mono audio ALREADY at 22.05 kHz: one row per
 * `BASIC_PITCH_FRAME_SECONDS`, 88 values in 0–1, key 0 = A0 (MIDI 21).
 */
export async function basicPitchNoteFrames(tf: TfLike, model: BasicPitchModel, mono22k: Float32Array): Promise<number[][]> {
  const nOutput = Math.floor(mono22k.length * (BASIC_PITCH_FPS / BASIC_PITCH_SAMPLE_RATE));
  // The package prepends half an overlap of silence, then frames with pad_end.
  const padded = new Float32Array(OVERLAP_LENGTH_FRAMES / 2 + mono22k.length);
  padded.set(mono22k, OVERLAP_LENGTH_FRAMES / 2);
  const windows = Math.max(1, Math.ceil(padded.length / HOP_SIZE));
  const rows: number[][] = [];
  const window = new Float32Array(AUDIO_N_SAMPLES);
  for (let w = 0; w < windows && rows.length < nOutput; w++) {
    window.fill(0);
    window.set(padded.subarray(w * HOP_SIZE, w * HOP_SIZE + AUDIO_N_SAMPLES));
    const out = tf.tidy(() => {
      const frames = model.execute(tf.tensor3d(window, [1, AUDIO_N_SAMPLES, 1]), FRAMES_OUTPUT);
      return frames
        .slice([0, N_OVERLAP_OVER_2, 0], [-1, frames.shape[1] - 2 * N_OVERLAP_OVER_2, -1])
        .reshape([-1, BASIC_PITCH_KEYS]);
    });
    const values = (await out.array()) as number[][];
    out.dispose();
    for (const row of values) {
      if (rows.length >= nOutput) break;
      rows.push(row);
    }
  }
  return rows;
}
