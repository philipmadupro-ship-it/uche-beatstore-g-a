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
export function privateAudioBucket(): string {
  const bucket = process.env.R2_PRIVATE_BUCKET_NAME;
  if (bucket) return bucket;
  throw new Error('Missing R2_PRIVATE_BUCKET_NAME');
}

export function r2ObjectRef(bucket: string, key: string): string {
  return `r2://${bucket}/${key}`;
}

export function parseR2ObjectRef(value: string): { bucket: string; key: string } | null {
  if (!value.startsWith('r2://')) return null;
  const withoutScheme = value.slice(5);
  const slash = withoutScheme.indexOf('/');
  if (slash <= 0 || slash === withoutScheme.length - 1) return null;
  return {
    bucket: withoutScheme.slice(0, slash),
    key: withoutScheme.slice(slash + 1),
  };
}

export async function getStoredObject(
  source: string,
  range?: string | null,
) {
  const ref = parseR2ObjectRef(source);
  if (!ref) return null;
  return r2.send(new GetObjectCommand({
    Bucket: ref.bucket,
    Key: ref.key,
    Range: range || undefined,
  }));
}

export async function readStoredObject(source: string): Promise<Buffer> {
  const object = await getStoredObject(source);
  if (object?.Body) {
    return Buffer.from(await object.Body.transformToByteArray());
  }

  if (source.startsWith('/uploads/') && !source.includes('..')) {
    return fs.readFileSync(path.join(process.cwd(), 'public', source));
  }

  const parsed = new URL(source);
  if (parsed.protocol !== 'https:') throw new Error('Stored object source not allowed');
  const response = await fetch(parsed, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Stored object fetch failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Upload a full-resolution audio asset to private storage. Local development
 * keeps its filesystem fallback; production fails closed without a private
 * bucket so a master can never silently land in the public bucket.
 */
export async function uploadPrivateAudio(fileBuffer: Buffer, fileName: string, contentType: string): Promise<string> {
  // Local fallback when R2 is not configured
  if (!isR2Configured()) {
    return uploadLocal(fileBuffer, fileName);
  }

  const bucketName = privateAudioBucket();
  if (!bucketName) throw new Error('Missing R2_PRIVATE_BUCKET_NAME');

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

  return r2ObjectRef(bucketName, objectKey);
}

/**
 * Backwards-compatible name used by stems and licensed source uploads.
 */
export const uploadAudio = uploadPrivateAudio;

export async function uploadPublicAudioAsset(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  prefix = 'public-audio',
): Promise<string> {
  if (!isR2Configured()) return uploadLocal(fileBuffer, fileName, prefix);

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!bucketName || !publicUrl) throw new Error('Public R2 bucket not configured');

  const ext = path.extname(fileName).replace('.', '').toLowerCase() || 'mp3';
  const objectKey = `${prefix}/${nanoid(10)}.${ext}`;
  await r2.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: fileBuffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${publicUrl.replace(/\/$/, '')}/${objectKey}`;
}

export async function uploadPublicPreview(source: Buffer): Promise<string | null> {
  const { createPreviewMp3Buffer } = await import('@/lib/audio/convert');
  const preview = await createPreviewMp3Buffer(source);
  if (!preview) return null;
  return uploadPublicAudioAsset(preview, 'preview.mp3', 'audio/mpeg', 'previews');
}

/**
 * Upload an already-truncated preview clip (produced by makeTruncatedPreview)
 * to the PUBLIC bucket and return its public URL. `sourceRef` is the master
 * the preview derives from — kept in the signature for traceability; the
 * stored object always gets a fresh public key so the private master is never
 * exposed via the preview URL.
 */
export async function uploadPreviewAsset(
  sourceRef: string,
  previewBuffer: Buffer,
  ext: string,
  contentType: string,
): Promise<string> {
  void sourceRef;
  const safeExt = (ext || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  return uploadPublicAudioAsset(previewBuffer, `preview.${safeExt}`, contentType, 'previews');
}

/**
 * Generates a signed URL valid for 1 hour for private R2 access.
 */
export async function getPresignedUrl(keyOrRef: string): Promise<string> {
  const ref = parseR2ObjectRef(keyOrRef);
  const bucketName = ref?.bucket || privateAudioBucket();
  const key = ref?.key || keyOrRef;

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(r2, command, { expiresIn: 3600 });
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

    const privateRef = parseR2ObjectRef(audioUrl);
    if (privateRef) {
      const peaksKey = `peaks/${privateRef.key.replace(/\//g, '-')}.peaks.json`;
      await r2.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: peaksKey,
        Body: peaksJson,
        ContentType: 'application/json',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${publicUrl.replace(/\/$/, '')}/${peaksKey}`;
    }

    // Pull the object key out of the legacy public R2 URL.
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

function uploadLocal(fileBuffer: Buffer, fileName: string, prefix = ''): string {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', prefix);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const ext = path.extname(fileName) || '.mp3';
  const safeName = `${nanoid(10)}${ext}`;
  const filePath = path.join(uploadsDir, safeName);

  fs.writeFileSync(filePath, fileBuffer);

  return `/uploads/${prefix ? `${prefix}/` : ''}${safeName}`;
}
