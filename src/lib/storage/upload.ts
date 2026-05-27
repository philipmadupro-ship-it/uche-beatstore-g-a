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
 * Generates a signed URL valid for 1 hour for private R2 access.
 */
export async function getPresignedUrl(key: string): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error('Missing R2_BUCKET_NAME');

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

