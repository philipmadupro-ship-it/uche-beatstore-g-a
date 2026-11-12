/**
 * Promoting a released item's preview to the PUBLIC bucket (LABEL-42, D8).
 *
 * An org recording's 75 s clip is private (lib/storage/org-media) until the
 * music is out. When a RELEASED release goes on the store, each item's clip
 * is COPIED, server side, to `store-releases/<release>/<master track>` in the
 * public bucket; the private original stays where it was, so unlisting can
 * delete the public copy without touching the org's own file. Callers decide
 * whether a release may be promoted at all (lib/labelos/store-listing); this
 * module only moves bytes, and refuses anything that is not a PRIVATE org
 * preview of the given org (a reference to somewhere else is never copied).
 *
 * Without R2 (local development, the real-db harness) nothing is promoted and
 * `promote` reports 0: full-length playback streams the master through the
 * server and needs no copy, and a preview-mode release simply has nothing to
 * play locally.
 */
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { isR2Configured } from '@/lib/local-store';
import { isPrivateOrgMediaRef } from '@/lib/labelos/org-upload';
import { publicPreviewKey, publicReleasePrefix } from '@/lib/labelos/store-listing';
import { deletePrefix } from './org-objects';
import { parseR2ObjectRef, r2, r2ObjectRef } from './upload';

export function publicStoreBucket(): string | null {
  return process.env.R2_BUCKET_NAME || null;
}

/** The stored reference of a promoted preview, or null when it cannot exist (no R2 / no public bucket / bad ids). */
export function promotedPreviewRef(releaseId: string, masterTrackId: string): string | null {
  const bucket = publicStoreBucket();
  const key = publicPreviewKey(releaseId, masterTrackId);
  return isR2Configured() && bucket && key ? r2ObjectRef(bucket, key) : null;
}

export type PromoteInput = { masterTrackId: string; privatePreviewRef: string | null };

/** Copy each item's private preview to the public bucket. Returns the master track ids that now have a public copy. */
export async function promotePreviews(orgId: string, releaseId: string, items: readonly PromoteInput[]): Promise<string[]> {
  const bucket = publicStoreBucket();
  if (!isR2Configured() || !bucket) return [];
  const promoted: string[] = [];
  for (const item of items) {
    const ref = item.privatePreviewRef;
    if (!ref) continue;
    if (!isPrivateOrgMediaRef(ref, { orgId, privateBucket: process.env.R2_PRIVATE_BUCKET_NAME, kind: 'previews' })) continue;
    const src = parseR2ObjectRef(ref);
    const key = publicPreviewKey(releaseId, item.masterTrackId);
    if (!src || !key) continue;
    await r2.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${src.bucket}/${src.key.split('/').map(encodeURIComponent).join('/')}`,
      // Keep the clip's own content type; the public route sets its own cache headers.
      MetadataDirective: 'COPY',
    }));
    promoted.push(item.masterTrackId);
  }
  return promoted;
}

/** Remove everything promoted for one release. Throws when something could not be removed. */
export async function deletePromotedPreviews(releaseId: string): Promise<number> {
  const bucket = publicStoreBucket();
  const prefix = publicReleasePrefix(releaseId);
  if (!isR2Configured() || !bucket || !prefix) return 0;
  return deletePrefix(r2, bucket, prefix);
}
