import type { Asset } from './types';

/**
 * The src to hand an <audio> element: the saved copy when there is a current
 * one, otherwise the asset's own owner-gated route. A stale copy is NOT used —
 * playing yesterday's master under today's title is worse than a network fetch.
 * Never returns a private reference: `openUrl` is same-origin by construction.
 */
export function resolveAssetSrc(
  asset: Pick<Asset, 'openUrl' | 'offline'>,
  offlineBlobUrl: string | null | undefined,
): string {
  if (offlineBlobUrl && asset.offline === 'saved') return offlineBlobUrl;
  return asset.openUrl ?? '';
}
