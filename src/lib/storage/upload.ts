import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import { isR2Configured } from '@/lib/local-store';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Uploads an audio/image buffer.
 * Uses Cloudflare R2 when configured, otherwise saves to public/uploads/ for local dev.
 */
export async function uploadAudio(fileBuffer: Buffer, fileName: string, contentType: string): Promise<string> {
  // Local fallback when R2 is not configured
  if (!isR2Configured()) {
    return uploadLocal(fileBuffer, fileName);
  }

  // Production: upload to R2
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error('Missing R2_BUCKET_NAME');

  const fileExtension = fileName.split('.').pop() || 'mp3';
  const uniqueId = nanoid(10);
  const objectKey = `tracks/${uniqueId}.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await r2.send(command);

  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!publicUrl) throw new Error('Missing NEXT_PUBLIC_R2_PUBLIC_URL');

  return `${publicUrl}/${objectKey}`;
}

/**
 * Generates a short-lived signed URL for private R2 access. Default TTL 1h.
 * Pass `downloadFilename` to force a browser download with a clean name
 * (sets Content-Disposition via the presigned response override).
 */
export async function getPresignedUrl(
  key: string,
  opts: { expiresIn?: number; downloadFilename?: string } = {},
): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error('Missing R2_BUCKET_NAME');

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ...(opts.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename.replace(/"/g, '')}"` }
      : {}),
  });

  return await getSignedUrl(r2, command, { expiresIn: opts.expiresIn ?? 3600 });
}

/**
 * Derive the R2 object key from a stored public R2 URL, or null if the URL
 * isn't an R2 public URL (e.g. a local `/uploads/...` dev path or a legacy
 * absolute URL). Callers fall back to the proxy when this returns null.
 */
export function r2KeyFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '');
  if (!base) return null;
  const prefix = base + '/';
  return rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : null;
}

/**
 * Upload a precomputed waveform peaks JSON sidecar.
 *
 * Convention: the peaks file lives next to the audio at the same key with
 * `.peaks.json` appended. This lets the client construct the peaks URL
 * deterministically from the audio URL if we ever lose the explicit
 * `peaks_url` column, and makes the bucket layout self-describing.
 *
 * Returns the public URL of the JSON, or null if upload failed (the caller
 * should treat peaks as best-effort and fall back to client-side decode).
 */
export async function uploadPeaksSidecar(
  audioUrl: string,
  peaksJson: string,
): Promise<string | null> {
  try {
    if (!isR2Configured()) {
      // Local dev: write a sidecar next to the audio file in /public/uploads.
      // audioUrl looks like "/uploads/abc123.mp3" — derive the sidecar path.
      const m = audioUrl.match(/^\/uploads\/(.+)$/);
      if (!m) return null;
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const sidecarPath = path.join(uploadsDir, `${m[1]}.peaks.json`);
      fs.writeFileSync(sidecarPath, peaksJson, 'utf-8');
      return `/uploads/${m[1]}.peaks.json`;
    }

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    if (!bucketName || !publicUrl) return null;

    // Pull the object key out of the R2 URL: NEXT_PUBLIC_R2_PUBLIC_URL/<key>.
    const prefix = publicUrl.replace(/\/$/, '') + '/';
    if (!audioUrl.startsWith(prefix)) return null;
    const audioKey = audioUrl.slice(prefix.length);
    const peaksKey = `${audioKey}.peaks.json`;

    await r2.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: peaksKey,
      Body: peaksJson,
      ContentType: 'application/json',
      // Long cache — peaks for a given audio object are immutable, so
      // give the CDN a year to keep them.
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return `${publicUrl.replace(/\/$/, '')}/${peaksKey}`;
  } catch (err) {
    console.warn('uploadPeaksSidecar failed:', err);
    return null;
  }
}

/**
 * Upload a generated preview clip next to the master at `<audioKey>.preview.mp3`.
 * This is the PUBLIC, store-served asset; the master stays private. Returns the
 * public URL or null (caller treats null as "no preview yet — fall back").
 */
export async function uploadPreviewAsset(
  audioUrl: string,
  preview: Buffer,
  ext: string = 'mp3',
  contentType: string = 'audio/mpeg',
): Promise<string | null> {
  try {
    if (!isR2Configured()) {
      const m = audioUrl.match(/^\/uploads\/(.+)$/);
      if (!m) return null;
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const previewPath = path.join(uploadsDir, `${m[1]}.preview.${ext}`);
      fs.writeFileSync(previewPath, preview);
      return `/uploads/${m[1]}.preview.${ext}`;
    }

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    if (!bucketName || !publicUrl) return null;

    const prefix = publicUrl.replace(/\/$/, '') + '/';
    if (!audioUrl.startsWith(prefix)) return null;
    const audioKey = audioUrl.slice(prefix.length);
    const previewKey = `${audioKey}.preview.${ext}`;

    await r2.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: previewKey,
      Body: preview,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return `${publicUrl.replace(/\/$/, '')}/${previewKey}`;
  } catch (err) {
    console.warn('uploadPreviewAsset failed:', err);
    return null;
  }
}

/**
 * Upload a generated PDF (license contract) to R2 under contracts/.
 * Falls back to /public/uploads/contracts/ in local dev.
 *
 * Returns the public URL on success, null on failure — the caller
 * should treat null as "fall back to non-PDF email delivery" rather
 * than failing the whole webhook.
 */
export async function uploadContractPdf(
  purchaseId: string,
  pdf: Buffer,
): Promise<string | null> {
  try {
    const filename = `${purchaseId}.pdf`;

    if (!isR2Configured()) {
      const dir = path.join(process.cwd(), 'public', 'uploads', 'contracts');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), pdf);
      return `/uploads/contracts/${filename}`;
    }

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    if (!bucketName || !publicUrl) return null;

    const key = `contracts/${filename}`;
    await r2.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: pdf,
      ContentType: 'application/pdf',
      // Contracts are per-purchase + immutable.
      CacheControl: 'public, max-age=31536000, immutable',
      ContentDisposition: `attachment; filename="license-${purchaseId}.pdf"`,
    }));

    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  } catch (err) {
    console.warn('uploadContractPdf failed:', err);
    return null;
  }
}

/**
 * Local filesystem upload fallback for development.
 * Saves files to /public/uploads/ and returns a URL path.
 */
/**
 * Uploads a cover image buffer to R2 (or local fallback).
 * Centralises image uploads so no caller needs to instantiate their own S3Client.
 */
export async function uploadImage(buffer: Buffer, ext: string, contentType: string): Promise<string> {
  const objectKey = `covers/${nanoid(10)}.${ext}`;

  if (!isR2Configured()) {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'covers');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const local = path.join(uploadsDir, `${objectKey.split('/').pop()}`);
    fs.writeFileSync(local, buffer);
    return `/uploads/covers/${objectKey.split('/').pop()}`;
  }

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!bucketName || !publicUrl) throw new Error('R2 not configured');

  await r2.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${publicUrl.replace(/\/$/, '')}/${objectKey}`;
}

function uploadLocal(fileBuffer: Buffer, fileName: string): string {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const ext = path.extname(fileName) || '.mp3';
  const safeName = `${nanoid(10)}${ext}`;
  const filePath = path.join(uploadsDir, safeName);

  fs.writeFileSync(filePath, fileBuffer);

  return `/uploads/${safeName}`;
}

