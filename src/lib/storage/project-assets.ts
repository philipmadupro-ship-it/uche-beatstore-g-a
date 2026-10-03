/**
 * Storage for project files (lib/projects/assets.ts has the rules).
 *
 * Files go to the PRIVATE bucket and are only ever streamed back by a route
 * that has checked ownership or portal membership — never by a public URL.
 * Without R2 (local development and the local-db harness) they go under
 * `data/project-assets/`, outside `public/`, as `local://` references, so the
 * local fallback is private too. Org files (LABEL-15) use the same helpers
 * with keys under `orgs/<org>/assets/<project>/` (lib/labelos/org-assets),
 * in the private bucket or `data/orgs/` — never `public/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { NextRequest } from 'next/server';
import { isR2Configured } from '@/lib/local-store';
import { getStoredObject, parseR2ObjectRef, privateAudioBucket, r2, r2ObjectRef } from './upload';

const LOCAL_ROOT = path.join(process.cwd(), 'data');

/** An org file's local key (LABEL-15): `orgs/<org>/assets/<project>/<file>`, still under `data/`. */
const ORG_LOCAL_KEY = /^orgs\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{6,64}\.[a-z0-9]{1,8}$/;

function localPath(key: string): string {
  const full = path.resolve(LOCAL_ROOT, key);
  if (full.startsWith(path.resolve(LOCAL_ROOT, 'project-assets') + path.sep)) return full;
  if (ORG_LOCAL_KEY.test(key) && full.startsWith(path.resolve(LOCAL_ROOT, 'orgs') + path.sep)) return full;
  throw new Error('Invalid local asset path');
}

/** Buckets a stored project-file reference may point into. */
export function projectAssetBuckets(): string[] {
  return [process.env.R2_PRIVATE_BUCKET_NAME].filter((b): b is string => !!b);
}

export async function storeProjectAsset(buffer: Buffer, key: string, mime: string): Promise<string> {
  if (!isR2Configured()) {
    const file = localPath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return `local://${key}`;
  }
  const Bucket = privateAudioBucket();
  await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: mime }));
  return r2ObjectRef(Bucket, key);
}

/** A 15-minute presigned PUT into the private bucket, or null without R2. */
export async function presignProjectAssetPut(key: string, mime: string): Promise<{ uploadUrl: string; url: string } | null> {
  if (!isR2Configured()) return null;
  const Bucket = privateAudioBucket();
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket, Key: key, ContentType: mime }), { expiresIn: 15 * 60 });
  return { uploadUrl, url: r2ObjectRef(Bucket, key) };
}

/** Size of a stored object, or null when it does not exist. */
export async function projectAssetSize(ref: string): Promise<number | null> {
  if (ref.startsWith('local://')) {
    try { return fs.statSync(localPath(ref.slice(8))).size; } catch { return null; }
  }
  const r = parseR2ObjectRef(ref);
  if (!r) return null;
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: r.bucket, Key: r.key }));
    return head.ContentLength ?? 0;
  } catch {
    return null;
  }
}

export async function deleteProjectAssetObject(ref: string): Promise<void> {
  if (ref.startsWith('local://')) {
    try { fs.unlinkSync(localPath(ref.slice(8))); } catch { /* already gone */ }
    return;
  }
  const r = parseR2ObjectRef(ref);
  if (!r) return;
  await r2.send(new DeleteObjectCommand({ Bucket: r.bucket, Key: r.key }));
}

/**
 * Stream a stored project file. `inline` shows images and PDFs in the tab;
 * everything else downloads. The MIME is the one stored at upload (from the
 * allowlist), never re-derived from the object, and `nosniff` stops a
 * browser second-guessing it.
 */
export async function streamProjectAsset(
  req: NextRequest,
  ref: string,
  opts: { fileName: string; mime: string | null; inline?: boolean },
): Promise<Response> {
  const headers = new Headers();
  const mime = opts.mime || 'application/octet-stream';
  const safe = opts.fileName.replace(/[\r\n"\\]/g, '_');
  const inlineOk = !!opts.inline && (/^image\/(png|jpeg|webp|gif)$/.test(mime) || mime === 'application/pdf' || mime === 'text/plain');
  headers.set('content-type', mime);
  headers.set('content-disposition', `${inlineOk ? 'inline' : 'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");

  if (ref.startsWith('local://')) {
    let file: string;
    try { file = localPath(ref.slice(8)); } catch { return new Response('Source not allowed', { status: 403 }); }
    if (!fs.existsSync(file)) return new Response('File unavailable', { status: 404 });
    const body = fs.readFileSync(file);
    headers.set('content-length', String(body.length));
    return new Response(body, { status: 200, headers });
  }

  const r = parseR2ObjectRef(ref);
  if (!r || !projectAssetBuckets().includes(r.bucket)) return new Response('Source not allowed', { status: 403 });
  const range = req.headers.get('range');
  const object = await getStoredObject(ref, range);
  if (!object?.Body) return new Response('File unavailable', { status: 404 });
  headers.set('accept-ranges', 'bytes');
  if (object.ContentLength != null) headers.set('content-length', String(object.ContentLength));
  if (object.ContentRange) headers.set('content-range', object.ContentRange);
  return new Response(object.Body.transformToWebStream(), { status: range ? 206 : 200, headers });
}
