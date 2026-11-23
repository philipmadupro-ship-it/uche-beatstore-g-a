import 'server-only';
import { decodeToMonoFloat32 } from '@/lib/audio/convert';
import { readoutFromMono } from '@/lib/audio/peaks';
import { readStoredObject, uploadWaveModelFile } from '@/lib/storage/upload';
import { isOrgMasterRef } from '@/lib/labelos/org-upload';
import { buildWaveformModel } from '@/lib/visuals/waveform-model';
import { encodeWaveformFile } from '@/lib/visuals/waveform-file';

/** The rate the model is built at: what the pipeline's ffmpeg decode already produces. */
export const WAVE_MODEL_SAMPLE_RATE = 44100;

/**
 * The `.wave.bin` bytes for one mono signal: `buildWaveformModel` (the browser's own
 * function, so the arrays are the same bytes it would make) plus the dB / Hz readout
 * from `readoutFromMono` (the same call the `.bands.json` sidecar makes).
 */
export function buildWaveformFileFromPcm(mono: Float32Array, sampleRate: number = WAVE_MODEL_SAMPLE_RATE): Uint8Array {
  return encodeWaveformFile(buildWaveformModel(mono, sampleRate), readoutFromMono(mono, sampleRate));
}

export interface WaveformModelDeps {
  read: (source: string) => Promise<Buffer>;
  decode: (audio: Buffer) => Promise<Float32Array | null>;
  put: (previewUrl: string, bytes: Uint8Array) => Promise<string | null>;
}

export const realWaveformModelDeps: WaveformModelDeps = {
  read: readStoredObject,
  decode: (audio) => decodeToMonoFloat32(audio, WAVE_MODEL_SAMPLE_RATE),
  put: uploadWaveModelFile,
};

export type WaveformModelOutcome = 'written' | 'skipped' | 'failed';

/**
 * Build and store the model file for a PUBLIC preview clip. Best effort by contract:
 * it never throws, so an upload job cannot fail because of it. An organization
 * recording (private preview) is skipped outright — nothing of one goes to the
 * public bucket.
 */
export async function ensureWaveformModelFile(
  previewUrl: string | null | undefined,
  deps: WaveformModelDeps = realWaveformModelDeps,
): Promise<WaveformModelOutcome> {
  if (!previewUrl || isOrgMasterRef(previewUrl) || previewUrl.startsWith('r2://')) return 'skipped';
  try {
    const audio = await deps.read(previewUrl);
    const mono = audio && audio.length > 0 ? await deps.decode(audio) : null;
    if (!mono || mono.length === 0) {
      console.warn('Waveform model file: preview could not be decoded', { previewUrl });
      return 'failed';
    }
    const stored = await deps.put(previewUrl, buildWaveformFileFromPcm(mono));
    return stored ? 'written' : 'failed';
  } catch (err) {
    console.warn('Waveform model file failed:', err);
    return 'failed';
  }
}
