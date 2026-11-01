/**
 * The lossy full-length derivative of an org recording (LABEL-72).
 *
 * Full-length playback to the public store, and to a project member who may listen but not download, is NEVER
 * the master: it is a 128 kbps MP3 cut once, server side, with the same ffmpeg path as the preview clip, and
 * kept in the PRIVATE bucket at a key derived from the org and the master track
 * (`orgs/<org>/derivatives/<track>.mp3`, lib/labelos/org-upload#orgDerivativeKey). No column holds it, no
 * public URL of it exists, and it goes with the rest of `orgs/<org>/` when the organization is purged.
 * Without R2 (local development, the real-database harness) it is a file under `data/orgs/<org>/derivatives/`,
 * never under `public/`.
 *
 * It is streamed back through the server only, in bounded partial responses (lib/audio/range-cap): a client
 * cannot pull the whole file in one request however it asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { isR2Configured } from '@/lib/local-store';
import { orgDerivativeKey } from '@/lib/labelos/org-upload';
import { orgAudioSourceAllowed } from '@/lib/labelos/org-audio';
import { DERIVATIVE_MAX_RANGE_BYTES, planCappedRange } from '@/lib/audio/range-cap';
import { r2, readStoredObject } from './upload';
import { localOrgDir } from './org-objects';

type Where = { kind: 'r2'; bucket: string; key: string } | { kind: 'local'; file: string };

function where(orgId: string, masterTrackId: string, root?: string): Where | null {
  const key = orgDerivativeKey(orgId, masterTrackId);
  if (!key) return null;
  if (isR2Configured()) {
    const bucket = process.env.R2_PRIVATE_BUCKET_NAME;
    return bucket ? { kind: 'r2', bucket, key } : null;
  }
  return { kind: 'local', file: path.join(localOrgDir(orgId, root), 'derivatives', `${masterTrackId.toLowerCase()}.mp3`) };
}

async function sizeOf(w: Where): Promise<number | null> {
  if (w.kind === 'local') {
    try {
      return fs.statSync(w.file).size;
    } catch {
      return null;
    }
  }
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: w.bucket, Key: w.key }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** True once the derivative of this recording exists. */
export async function hasFullDerivative(orgId: string, masterTrackId: string, root?: string): Promise<boolean> {
  const w = where(orgId, masterTrackId, root);
  return !!w && ((await sizeOf(w)) ?? 0) > 0;
}

const inflight = new Map<string, Promise<boolean>>();

/**
 * Make sure the derivative exists, cutting it from the master if it does not. Idempotent and safe to call
 * from several requests at once (one cut per recording per process). False when it could not be made
 * (ffmpeg missing, an unreadable master, no private bucket) — callers answer "not ready", never the master.
 */
export async function ensureFullDerivative(
  orgId: string,
  masterTrackId: string,
  masterRef: string | null,
  deps: { root?: string; cut?: (master: Buffer) => Promise<Buffer | null> } = {},
): Promise<boolean> {
  const w = where(orgId, masterTrackId, deps.root);
  if (!w) return false;
  if (((await sizeOf(w)) ?? 0) > 0) return true;
  if (!masterRef || !orgAudioSourceAllowed(masterRef, isR2Configured() ? process.env.R2_PRIVATE_BUCKET_NAME : null)) return false;
  const id = `${orgId.toLowerCase()}:${masterTrackId.toLowerCase()}`;
  const running = inflight.get(id);
  if (running) return running;
  const job = (async () => {
    const master = await readStoredObject(masterRef);
    const cut = deps.cut ?? (async (b: Buffer) => (await import('@/lib/audio/convert')).makeFullLossyMp3Buffer(b));
    const mp3 = await cut(master);
    if (!mp3 || mp3.length === 0) return false;
    if (w.kind === 'local') {
      fs.mkdirSync(path.dirname(w.file), { recursive: true });
      // Written whole, then moved into place: a reader never sees half a derivative.
      const tmp = `${w.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, mp3);
      fs.renameSync(tmp, w.file);
    } else {
      await r2.send(
        new PutObjectCommand({ Bucket: w.bucket, Key: w.key, Body: mp3, ContentType: 'audio/mpeg', CacheControl: 'private, no-store' }),
      );
    }
    return true;
  })()
    .catch(() => false)
    .finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/**
 * A bounded partial of the derivative as a `Response` (206, or 416), or null when it does not exist.
 * The same code answers HEAD: the caller drops the body.
 */
export async function openFullDerivative(
  orgId: string,
  masterTrackId: string,
  rangeHeader: string | null,
  opts: { cap?: number; root?: string } = {},
): Promise<Response | null> {
  const w = where(orgId, masterTrackId, opts.root);
  if (!w) return null;
  const size = await sizeOf(w);
  if (!size) return null;
  const plan = planCappedRange(rangeHeader, size, opts.cap ?? DERIVATIVE_MAX_RANGE_BYTES);
  const base = {
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  };
  if (!plan.ok) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  const length = plan.end - plan.start + 1;
  const headers = { ...base, 'content-length': String(length), 'content-range': `bytes ${plan.start}-${plan.end}/${size}` };
  if (w.kind === 'local') {
    const stream = fs.createReadStream(w.file, { start: plan.start, end: plan.end });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: 206, headers });
  }
  const object = await r2.send(new GetObjectCommand({ Bucket: w.bucket, Key: w.key, Range: `bytes=${plan.start}-${plan.end}` }));
  if (!object.Body) return null;
  return new Response(object.Body.transformToWebStream(), { status: 206, headers });
}
