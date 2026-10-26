/**
 * Derived files of ORG recordings (LABEL-14): the 75 s preview clip and the
 * peaks sidecar. D8 — private until released — so both go to the PRIVATE
 * bucket under `orgs/<org>/previews/` and `orgs/<org>/peaks/`
 * (lib/labelos/org-upload#orgMediaKey), never to the public bucket where a
 * producer's previews and sidecars live (R-05). They are read back only by
 * `GET /api/org/[orgId]/audio/[trackId]?variant=preview|peaks`, which checks
 * the member against that one recording.
 *
 * Without R2 (local development, the local-db harness) there is no private
 * bucket, and the public fallback (`public/uploads/`) is exactly what these
 * must never use: both return null, the track simply has no preview or peaks,
 * and the player streams `full` and decodes peaks in the browser.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import { isR2Configured } from '@/lib/local-store';
import { isPrivateOrgMediaRef, orgMediaKey, type OrgMediaKind } from '@/lib/labelos/org-upload';
import { privateAudioBucket, r2, r2ObjectRef } from './upload';

async function putPrivate(orgId: string, kind: OrgMediaKind, body: Buffer | string, ext: string, contentType: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  const Bucket = privateAudioBucket();
  const Key = orgMediaKey(orgId, kind, nanoid(12), ext);
  await r2.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType: contentType, CacheControl: 'private, no-store' }));
  const ref = r2ObjectRef(Bucket, Key);
  // Belt and braces: what goes on the row must be a private org reference.
  if (!isPrivateOrgMediaRef(ref, { orgId, privateBucket: process.env.R2_PRIVATE_BUCKET_NAME, kind })) {
    throw new Error('Org media must be stored in the private bucket');
  }
  return ref;
}

/** The 75 s clip of an org master, in the private bucket. Null when no clip could be cut or R2 is not configured. */
export async function uploadOrgPreview(
  orgId: string,
  source: Buffer,
  sourceRef?: string | null,
  durationSeconds?: number | null,
): Promise<string | null> {
  if (!isR2Configured()) return null;
  const { buildPreviewClip } = await import('@/lib/audio/preview-clip');
  const clip = await buildPreviewClip(source, sourceRef ?? null, durationSeconds ?? null);
  if (!clip) return null;
  return putPrivate(orgId, 'previews', clip.buffer, clip.ext, clip.contentType);
}

/** The peaks sidecar of an org master, in the private bucket. Null (never throws) on failure, as for producer sidecars. */
export async function uploadOrgPeaks(orgId: string, peaksJson: string): Promise<string | null> {
  try {
    return await putPrivate(orgId, 'peaks', peaksJson, 'json', 'application/json');
  } catch (err) {
    console.warn('uploadOrgPeaks failed:', err);
    return null;
  }
}
