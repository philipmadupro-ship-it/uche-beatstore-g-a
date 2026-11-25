/**
 * What a DAW project file says about itself, and nothing more (AUDIO-02):
 * the app, its version and the tempo. Never a sample path, plugin name,
 * channel or track name — a session holds file paths of the producer's own
 * machine, and none of that is read, kept or returned.
 *
 * Pure over the first bytes of the file. Anything unreadable is `null`, never
 * a guess. Every read is bounded: the caller passes at most `DAW_META_HEAD_BYTES`
 * of input, FLP parsing stops after `MAX_FLP_EVENTS`, and the Ableton gzip
 * stream is inflated with a hard OUTPUT cap (`boundedGunzip`), so a gzip bomb
 * costs a few MB and a few milliseconds, not the process.
 */
import zlib from 'node:zlib';
import { DAW_APP_LABEL, DAW_EXTENSIONS } from './daw';

export interface DawMetadata {
  app: string;
  appVersion: string | null;
  bpm: number | null;
}

/** Input cap: how much of the stored file is ever read for metadata. */
export const DAW_META_HEAD_BYTES = 1024 * 1024;
/** Output cap for the Ableton gunzip. */
export const ALS_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_FLP_EVENTS = 8192;

function sane(bpm: number): number | null {
  return Number.isFinite(bpm) && bpm >= 20 && bpm <= 999 ? Math.round(bpm * 100) / 100 : null;
}
function versionOrNull(s: string): string | null {
  const v = s.replace(/\0/g, '').trim();
  return /^\d+(\.\d+){1,3}$/.test(v) ? v : null;
}

/**
 * FL Studio: "FLhd" (len 6, format, channels, ppq) then "FLdt" and a stream of
 * events. Event id < 64 carries 1 byte, < 128 two, < 192 four, otherwise a
 * varint length. 199 is the version text, 156 the tempo in thousandths of a
 * BPM (66, the older whole-BPM word, is the fallback).
 */
export function readFlpMetadata(head: Uint8Array): DawMetadata | null {
  if (head.length < 22 || String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'FLhd') return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const hdrLen = view.getUint32(4, true);
  let pos = 8 + hdrLen;
  if (pos + 8 > head.length || String.fromCharCode(head[pos], head[pos + 1], head[pos + 2], head[pos + 3]) !== 'FLdt') {
    return { app: DAW_APP_LABEL.fl_studio, appVersion: null, bpm: null };
  }
  pos += 8;
  let version: string | null = null;
  let bpm: number | null = null;
  let legacyBpm: number | null = null;
  for (let n = 0; n < MAX_FLP_EVENTS && pos < head.length; n++) {
    const id = head[pos++];
    let size: number;
    if (id < 64) size = 1;
    else if (id < 128) size = 2;
    else if (id < 192) size = 4;
    else {
      size = 0;
      let shift = 0;
      for (let k = 0; k < 4; k++) {
        if (pos >= head.length) return { app: DAW_APP_LABEL.fl_studio, appVersion: version, bpm: bpm ?? legacyBpm };
        const b = head[pos++];
        size |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
    }
    if (pos + size > head.length) break;
    if (id === 199) {
      let text = '';
      for (let i = 0; i < size; i++) text += String.fromCharCode(head[pos + i]);
      version = version ?? versionOrNull(text);
    } else if (id === 156 && size === 4) {
      bpm = sane(view.getUint32(pos, true) / 1000);
    } else if (id === 66 && size === 2) {
      legacyBpm = sane(view.getUint16(pos, true));
    }
    pos += size;
    if (version && bpm != null) break;
  }
  return { app: DAW_APP_LABEL.fl_studio, appVersion: version, bpm: bpm ?? legacyBpm };
}

/** Inflate a gzip stream, keeping at most `maxOut` bytes of output; never throws on a bomb. */
export function boundedGunzip(input: Uint8Array, maxOut: number = ALS_MAX_OUTPUT_BYTES): Promise<Buffer> {
  return new Promise((resolve) => {
    const gz = zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    };
    gz.on('data', (c: Buffer) => {
      if (total < maxOut) {
        const take = c.subarray(0, maxOut - total);
        chunks.push(take);
        total += take.length;
      }
      if (total >= maxOut) {
        gz.destroy();
        finish();
      }
    });
    gz.on('end', finish);
    gz.on('close', finish);
    gz.on('error', finish);
    gz.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  });
}

/** Ableton: a gzipped XML document; `Creator="Ableton Live 11.0.12"` and the master `<Tempo>`. */
export async function readAlsMetadata(head: Uint8Array): Promise<DawMetadata | null> {
  if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) return null;
  const text = (await boundedGunzip(head)).toString('latin1');
  if (!text.includes('<Ableton')) return { app: DAW_APP_LABEL.ableton, appVersion: null, bpm: null };
  const creator = /<Ableton\b[^>]*\bCreator="Ableton Live ([^"]+)"/.exec(text);
  const tempo = /<Tempo>[\s\S]{0,600}?<Manual Value="([\d.]+)"/.exec(text);
  return {
    app: DAW_APP_LABEL.ableton,
    appVersion: creator ? versionOrNull(creator[1].split(/\s/)[0]) : null,
    bpm: tempo ? sane(parseFloat(tempo[1])) : null,
  };
}

/** Reaper: `<REAPER_PROJECT 0.1 "6.80/linux-x86_64" …` and a `TEMPO 120 4 4` line. */
export function readRppMetadata(head: Uint8Array): DawMetadata | null {
  const text = Buffer.from(head.subarray(0, Math.min(head.length, 64 * 1024))).toString('latin1').replace(/^﻿|^\xEF\xBB\xBF/, '');
  if (!/^\s*<REAPER_PROJECT/.test(text)) return null;
  const version = /^\s*<REAPER_PROJECT\s+\S+\s+"([\d.]+)/.exec(text);
  const tempo = /^\s*TEMPO\s+([\d.]+)/m.exec(text);
  return { app: DAW_APP_LABEL.reaper, appVersion: version ? versionOrNull(version[1]) : null, bpm: tempo ? sane(parseFloat(tempo[1])) : null };
}

/** The metadata of a project file by extension; the other formats say only which app they are. */
export async function readDawMetadata(ext: string, head: Uint8Array): Promise<DawMetadata | null> {
  const info = DAW_EXTENSIONS[ext];
  if (!info) return null;
  let found: DawMetadata | null = null;
  if (ext === 'flp') found = readFlpMetadata(head);
  else if (ext === 'als') found = await readAlsMetadata(head);
  else if (ext === 'rpp') found = readRppMetadata(head);
  else return { app: DAW_APP_LABEL[info.app], appVersion: null, bpm: null };
  return found;
}
