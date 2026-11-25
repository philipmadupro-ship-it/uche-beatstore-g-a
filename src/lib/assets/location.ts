import type { AssetLocation } from './types';

/**
 * Storage class of a stored reference, from its scheme alone. The reference
 * itself is read here and never returned.
 *
 * `r2://<bucket>/<key>` is private unless the bucket is the configured public
 * one (the caller passes its name); `local://` is the private filesystem
 * fallback; `/uploads/...` and http(s) URLs are public.
 */
export function locationOf(ref: string | null | undefined, publicBucket?: string | null): AssetLocation {
  if (!ref) return 'private';
  if (ref.startsWith('local://')) return 'local';
  if (ref.startsWith('r2://')) {
    const bucket = ref.slice('r2://'.length).split('/')[0];
    return publicBucket && bucket === publicBucket ? 'public' : 'private';
  }
  if (ref.startsWith('/uploads/') || /^https?:\/\//i.test(ref)) return 'public';
  return 'private';
}
