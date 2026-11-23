/**
 * The `.wave.bin` file: the SAME model `buildWaveformModel` makes in the browser,
 * built once on the server and stored next to the public preview clip, so a
 * visitor downloads ~100 KB instead of decoding 75 s of audio.
 *
 * Layout (little-endian; all integers unsigned unless noted):
 *
 *   0   4  magic "U2CW"
 *   4   1  version (1)
 *   5   2  columns per second (441)
 *   7   4  column count N
 *   11  4  peak: loudest |sample| of the mix, float32 (the scale `all` was
 *          normalised to; the model's `peak`)
 *   15  1  reserved (0)
 *   16  N  mix  (Uint8, global scale)
 *   ..  N  low
 *   ..  N  mid
 *   ..  N  high
 *   ..  2  readout slice count S (u16, 512)
 *   ..  S  db: Int8 per slice, dBFS rounded and clamped to [-127, 0]; -128 = silence
 *   ..  2S hz: Uint16 per slice; 0 = no pitch
 *
 * The file is keyed by the preview's URL (`<previewUrl>.wave.bin`): no column.
 * Pure and dependency-light on purpose — the browser, the upload pipeline and
 * the backfill all use this one encoder/decoder.
 */

import { canFetchReadableAudio, cdnAudioSrc } from '@/lib/audio/cdn';
import type { WaveformModel } from './waveform-model';

export const WAVE_FILE_MAGIC = 'U2CW';
export const WAVE_FILE_VERSION = 1;
export const WAVE_FILE_HEADER_BYTES = 16;
export const WAVE_FILE_SUFFIX = '.wave.bin';
/** Silence floor shared with `rmsToDb` (lib/audio/pitch MIN_DB). */
const DB_FLOOR = -100;
const DB_SILENCE_CODE = -128;
/** Refuse absurd headers: ~3 hours of columns. */
const MAX_COLUMNS = 441 * 60 * 60 * 3;

export interface WaveformReadout {
  /** dBFS per slice; the silence floor (-100) where the audio is silent. */
  db: number[];
  /** Hz per slice; null where there is no pitch. */
  hz: (number | null)[];
}

export interface WaveformFile {
  model: WaveformModel;
  readout: WaveformReadout;
}

export function encodeWaveformFile(model: WaveformModel, readout: WaveformReadout): Uint8Array {
  const n = model.all.length;
  const slices = Math.min(readout.db.length, readout.hz.length, 0xffff);
  const out = new Uint8Array(WAVE_FILE_HEADER_BYTES + 4 * n + 2 + 3 * slices);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[i] = WAVE_FILE_MAGIC.charCodeAt(i);
  out[4] = WAVE_FILE_VERSION;
  view.setUint16(5, Math.round(model.columnsPerSecond), true);
  view.setUint32(7, n, true);
  view.setFloat32(11, model.peak, true);

  let at = WAVE_FILE_HEADER_BYTES;
  for (const series of [model.all, model.low, model.mid, model.high]) {
    out.set(series.subarray(0, n), at);
    at += n;
  }
  view.setUint16(at, slices, true);
  at += 2;
  for (let i = 0; i < slices; i += 1) {
    const v = readout.db[i];
    const code = !Number.isFinite(v) || v <= DB_FLOOR ? DB_SILENCE_CODE : Math.max(-127, Math.min(0, Math.round(v)));
    view.setInt8(at + i, code);
  }
  at += slices;
  for (let i = 0; i < slices; i += 1) {
    const v = readout.hz[i];
    view.setUint16(at + 2 * i, v != null && Number.isFinite(v) && v > 0 ? Math.min(0xffff, Math.round(v)) : 0, true);
  }
  return out;
}

/** Decode a `.wave.bin`; null for anything that is not exactly a v1 file (a 404 body, a truncated copy…). */
export function decodeWaveformFile(input: ArrayBuffer | Uint8Array): WaveformFile | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < WAVE_FILE_HEADER_BYTES + 2) return null;
  for (let i = 0; i < 4; i += 1) if (bytes[i] !== WAVE_FILE_MAGIC.charCodeAt(i)) return null;
  if (bytes[4] !== WAVE_FILE_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const columnsPerSecond = view.getUint16(5, true);
  const n = view.getUint32(7, true);
  const peak = view.getFloat32(11, true);
  if (columnsPerSecond <= 0 || n <= 0 || n > MAX_COLUMNS || !Number.isFinite(peak) || peak < 0) return null;
  const readoutAt = WAVE_FILE_HEADER_BYTES + 4 * n;
  if (bytes.length < readoutAt + 2) return null;
  const slices = view.getUint16(readoutAt, true);
  if (slices <= 0 || bytes.length !== readoutAt + 2 + 3 * slices) return null;

  const take = (index: number) => bytes.slice(WAVE_FILE_HEADER_BYTES + index * n, WAVE_FILE_HEADER_BYTES + (index + 1) * n);
  const model: WaveformModel = { all: take(0), low: take(1), mid: take(2), high: take(3), columnsPerSecond, peak };

  const dbAt = readoutAt + 2;
  const hzAt = dbAt + slices;
  const db: number[] = new Array(slices);
  const hz: (number | null)[] = new Array(slices);
  for (let i = 0; i < slices; i += 1) {
    const code = view.getInt8(dbAt + i);
    db[i] = code === DB_SILENCE_CODE ? DB_FLOOR : code;
    const f = view.getUint16(hzAt + 2 * i, true);
    hz[i] = f === 0 ? null : f;
  }
  return { model, readout: { db, hz } };
}

/** `<previewUrl>.wave.bin` for a preview this app wrote (an http(s) or site-relative URL); null otherwise. */
export function waveFileUrlFor(previewUrl: string | null | undefined): string | null {
  if (!previewUrl || typeof previewUrl !== 'string') return null;
  if (previewUrl.startsWith('r2://') || previewUrl.startsWith('/api/')) return null;
  if (!/^https?:\/\//i.test(previewUrl) && !previewUrl.startsWith('/')) return null;
  if (previewUrl.includes('?') || previewUrl.includes('#')) return null;
  return `${previewUrl}${WAVE_FILE_SUFFIX}`;
}

/**
 * Where the browser may read a track's model file from, or null (decode as before).
 *
 * The preview URL when it is directly READABLE (our CDN, or a local path) — the
 * public R2 host sends no CORS headers, so `fetch()` cannot read it — otherwise
 * the same-origin `/api/store/wave/<id>` that sits beside `/api/store/preview/<id>`.
 */
export function waveModelFileUrl(
  audioUrl: string | null | undefined,
  publicAnalysisUrl: string | null | undefined,
): string | null {
  const fromPreviewRoute = (): string | null => {
    const m = /^\/api\/store\/preview\/([^/?#]+)$/.exec(publicAnalysisUrl ?? '');
    return m ? `/api/store/wave/${m[1]}` : null;
  };
  if (!audioUrl) return null;
  if (audioUrl.startsWith('/api/store/preview/')) return fromPreviewRoute();
  const direct = cdnAudioSrc(audioUrl);
  if (direct && !direct.startsWith('/api/') && canFetchReadableAudio(direct)) return waveFileUrlFor(direct);
  // A public store surface whose preview sits on a host the browser cannot read.
  return /^https?:\/\//i.test(direct) ? fromPreviewRoute() : null;
}
