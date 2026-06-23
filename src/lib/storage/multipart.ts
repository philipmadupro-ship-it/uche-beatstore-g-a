/**
 * Server-side multipart upload helpers for Cloudflare R2 (S3-compatible).
 *
 * R2 supports the S3 multipart spec — minimum part size is 5 MiB except for
 * the final part. Sessions persist as long as the R2 multipart upload itself,
 * so resumes survive arbitrary client downtime including page refreshes.
 *
 * For local-fs / dev mode (no R2 configured), we emulate multipart by writing
 * each chunk to a per-session staging directory and concatenating on complete.
 */

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import { privateAudioBucket, r2, r2ObjectRef, readStoredObject } from './upload';
import { isR2Configured } from '@/lib/local-store';

export interface PartRef {
  PartNumber: number;
  ETag: string;
  Size?: number;
}

const STAGING_ROOT = path.join(process.cwd(), 'data', 'upload-staging');

function ensureStagingDir(sessionId: string) {
  const dir = path.join(STAGING_ROOT, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function detectExt(fileName: string): string {
  const ext = (fileName.split('.').pop() || 'mp3').toLowerCase();
  return ext;
}

function buildObjectKey(fileName: string): string {
  const ext = detectExt(fileName);
  return `tracks/${nanoid(10)}.${ext}`;
}

/* ─────────── R2 backend ─────────── */

async function r2Init(fileName: string, contentType: string) {
  const Bucket = privateAudioBucket();
  if (!Bucket) throw new Error('Missing R2_PRIVATE_BUCKET_NAME');
  const Key = buildObjectKey(fileName);
  const cmd = new CreateMultipartUploadCommand({ Bucket, Key, ContentType: contentType });
  const res = await r2.send(cmd);
  if (!res.UploadId) throw new Error('R2 did not return UploadId');
  return { uploadId: res.UploadId, key: Key };
}

async function r2UploadPart(opts: {
  uploadId: string;
  key: string;
  partNumber: number;
  body: Buffer;
}): Promise<PartRef> {
  const Bucket = privateAudioBucket();
  const cmd = new UploadPartCommand({
    Bucket,
    Key: opts.key,
    UploadId: opts.uploadId,
    PartNumber: opts.partNumber,
    Body: opts.body,
  });
  const res = await r2.send(cmd);
  if (!res.ETag) throw new Error('R2 did not return ETag');
  return { PartNumber: opts.partNumber, ETag: res.ETag, Size: opts.body.length };
}

async function r2Complete(opts: { uploadId: string; key: string; parts: PartRef[] }) {
  const Bucket = privateAudioBucket();
  const sorted = [...opts.parts].sort((a, b) => a.PartNumber - b.PartNumber);
  const cmd = new CompleteMultipartUploadCommand({
    Bucket,
    Key: opts.key,
    UploadId: opts.uploadId,
    MultipartUpload: {
      Parts: sorted.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
    },
  });
  await r2.send(cmd);
  return r2ObjectRef(Bucket, opts.key);
}

async function r2Abort(opts: { uploadId: string; key: string }) {
  const Bucket = privateAudioBucket();
  await r2.send(
    new AbortMultipartUploadCommand({ Bucket, Key: opts.key, UploadId: opts.uploadId })
  );
}

async function r2ListParts(opts: { uploadId: string; key: string }) {
  const Bucket = privateAudioBucket();
  const res = await r2.send(
    new ListPartsCommand({ Bucket, Key: opts.key, UploadId: opts.uploadId })
  );
  return (res.Parts || [])
    .filter((p) => p.PartNumber != null && p.ETag)
    .map<PartRef>((p) => ({ PartNumber: p.PartNumber!, ETag: p.ETag!, Size: p.Size }));
}

/* ─────────── Local-fs backend (dev fallback) ─────────── */

async function localInit(fileName: string) {
  const sessionId = nanoid(16);
  const dir = ensureStagingDir(sessionId);
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify({ fileName, createdAt: Date.now() }));
  return { uploadId: sessionId, key: `local:${sessionId}` };
}

async function localUploadPart(opts: { uploadId: string; partNumber: number; body: Buffer }): Promise<PartRef> {
  const dir = ensureStagingDir(opts.uploadId);
  const partPath = path.join(dir, `part-${String(opts.partNumber).padStart(5, '0')}`);
  fs.writeFileSync(partPath, opts.body);
  const etag = `"local-${opts.partNumber}-${opts.body.length}"`;
  return { PartNumber: opts.partNumber, ETag: etag, Size: opts.body.length };
}

async function localComplete(opts: { uploadId: string; fileName: string }) {
  const dir = ensureStagingDir(opts.uploadId);
  const parts = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('part-'))
    .sort();

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = detectExt(opts.fileName);
  const finalName = `${nanoid(10)}.${ext}`;
  const finalPath = path.join(uploadsDir, finalName);

  // Stream-concat the parts into the final file
  const fd = fs.openSync(finalPath, 'w');
  try {
    for (const p of parts) {
      const data = fs.readFileSync(path.join(dir, p));
      fs.writeSync(fd, data);
    }
  } finally {
    fs.closeSync(fd);
  }

  // Cleanup staging
  try {
    for (const p of parts) fs.unlinkSync(path.join(dir, p));
    fs.unlinkSync(path.join(dir, '_meta.json'));
    fs.rmdirSync(dir);
  } catch {}

  return `/uploads/${finalName}`;
}

async function localAbort(uploadId: string) {
  const dir = path.join(STAGING_ROOT, uploadId);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
  try { fs.rmdirSync(dir); } catch {}
}

async function localListParts(uploadId: string): Promise<PartRef[]> {
  const dir = path.join(STAGING_ROOT, uploadId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('part-'))
    .map((f) => {
      const num = parseInt(f.replace('part-', ''), 10);
      const stat = fs.statSync(path.join(dir, f));
      return { PartNumber: num, ETag: `"local-${num}-${stat.size}"`, Size: stat.size };
    });
}

/* ─────────── Public API (auto-routes to R2 or local) ─────────── */

export const MIN_PART_SIZE = 5 * 1024 * 1024;        // 5 MiB minimum (S3/R2)
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;    // 8 MiB default
export const MAX_PARTS = 10_000;

export async function initMultipart(fileName: string, contentType: string) {
  if (isR2Configured()) return r2Init(fileName, contentType);
  return localInit(fileName);
}

export async function uploadPart(opts: {
  uploadId: string;
  key: string;
  partNumber: number;
  body: Buffer;
}) {
  if (isR2Configured()) return r2UploadPart(opts);
  return localUploadPart({ uploadId: opts.uploadId, partNumber: opts.partNumber, body: opts.body });
}

export async function getUploadPartUrl(opts: {
  uploadId: string;
  key: string;
  partNumber: number;
}): Promise<string | null> {
  if (!isR2Configured()) return null;
  const command = new UploadPartCommand({
    Bucket: privateAudioBucket(),
    Key: opts.key,
    UploadId: opts.uploadId,
    PartNumber: opts.partNumber,
  });
  return getSignedUrl(r2, command, { expiresIn: 15 * 60 });
}

export async function completeMultipart(opts: {
  uploadId: string;
  key: string;
  fileName: string;
  parts: PartRef[];
}): Promise<string> {
  if (isR2Configured()) return r2Complete({ uploadId: opts.uploadId, key: opts.key, parts: opts.parts });
  return localComplete({ uploadId: opts.uploadId, fileName: opts.fileName });
}

export async function abortMultipart(opts: { uploadId: string; key: string }) {
  if (isR2Configured()) return r2Abort(opts);
  return localAbort(opts.uploadId);
}

export async function listParts(opts: { uploadId: string; key: string }): Promise<PartRef[]> {
  if (isR2Configured()) return r2ListParts(opts);
  return localListParts(opts.uploadId);
}

/* ─────────── Concat helper for analysis after complete ─────────── */

/**
 * Reads the assembled object back into memory for server-side analysis.
 * For R2 uploads: fetches via the public URL with retry+backoff to handle
 * R2 eventual consistency (the object may not be readable immediately after
 * completeMultipart returns). For local: reads file from disk.
 *
 * NOTE: only call this for files <= ~100 MiB — otherwise analysis should be
 * deferred to a background job. Call ONCE and reuse the buffer across all
 * analysis steps to avoid triple-fetching large files.
 */
export async function readAssembledBuffer(audioUrl: string, maxAttempts = 4): Promise<Buffer> {
  if (audioUrl.startsWith('/uploads/')) {
    const full = path.join(process.cwd(), 'public', audioUrl);
    return fs.readFileSync(full);
  }
  // R2 public URL — retry with exponential backoff for eventual consistency.
  let lastErr: Error = new Error('fetch failed');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await readStoredObject(audioUrl);
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < maxAttempts) {
      // 1s, 2s, 4s backoff
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}
