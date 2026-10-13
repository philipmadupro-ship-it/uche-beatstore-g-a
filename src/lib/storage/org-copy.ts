/**
 * Copying a master into an organization (LABEL-41, D6 "Use in a label song").
 * The bytes are COPIED, never shared: the new object lives under the label's
 * own `orgs/<org>/tracks/` prefix in the PRIVATE bucket (the same home a label
 * upload gets, D8), so removing, ending or changing the source can never
 * reach the copy and the copy can never reach the source. R2 does the copy
 * server-side (no bytes pass through the app); without R2 (local development)
 * the file is copied under `public/uploads/orgs/<org>/tracks/`, which is
 * where the local fallback keeps org masters.
 *
 * A source that is not a private-bucket reference (or a local upload) is
 * refused: a public URL names a file that is not ours to move, and a copy of
 * "something at an address" is how a private path gets smuggled in.
 */
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { isR2Configured } from '@/lib/local-store';
import { orgUploadKeyPrefix } from '@/lib/labelos/org-upload';
import { deleteStoredObject, parseR2ObjectRef, privateAudioBucket, r2, r2ObjectRef } from './upload';

export class CopySourceError extends Error {}

/** Can this stored reference be copied? A private-bucket `r2://` object, or a local `/uploads/` file when R2 is off. */
export function copyableSource(ref: string | null | undefined, privateBucket: string | null | undefined, r2On: boolean): boolean {
  if (typeof ref !== 'string' || ref === '') return false;
  const parsed = /^r2:\/\/([^/]+)\/(.+)$/.exec(ref);
  if (parsed) return r2On && !!privateBucket && parsed[1] === privateBucket && !parsed[2].includes('..');
  return !r2On && ref.startsWith('/uploads/') && !ref.includes('..');
}

function extOf(ref: string): string {
  const e = path.extname(ref.split('?')[0]).replace('.', '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return e || 'mp3';
}

/** Copy one master into `destOrgId`'s private prefix; returns the new stored reference. */
export async function copyMasterToOrg(sourceRef: string, destOrgId: string): Promise<string> {
  const r2On = isR2Configured();
  const bucket = r2On ? privateAudioBucket() : null;
  if (!copyableSource(sourceRef, bucket, r2On)) throw new CopySourceError('That recording cannot be copied');
  const ext = extOf(sourceRef);
  const prefix = orgUploadKeyPrefix(destOrgId);

  if (r2On) {
    const src = parseR2ObjectRef(sourceRef)!;
    const Key = `${prefix}/${nanoid(16)}.${ext}`;
    await r2.send(new CopyObjectCommand({
      Bucket: src.bucket,
      Key,
      CopySource: `${src.bucket}/${src.key.split('/').map(encodeURIComponent).join('/')}`,
      MetadataDirective: 'COPY',
    }));
    return r2ObjectRef(src.bucket, Key);
  }

  const from = path.join(process.cwd(), 'public', sourceRef);
  const dir = path.join(process.cwd(), 'public', 'uploads', prefix);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${nanoid(16)}.${ext}`;
  fs.copyFileSync(from, path.join(dir, name));
  return `/uploads/${prefix}/${name}`;
}

/** Remove a copy that could not be recorded. Never throws. */
export async function discardCopy(ref: string | null | undefined): Promise<void> {
  if (!ref) return;
  try {
    if (ref.startsWith('/uploads/')) {
      const file = path.join(process.cwd(), 'public', ref);
      if (!ref.includes('..') && fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    await deleteStoredObject(ref);
  } catch {
    // best effort: an orphan object is harmless, a leaked error is not useful
  }
}
