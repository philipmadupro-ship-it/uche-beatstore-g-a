import type { Asset, OfflineState } from './types';

/**
 * The one place that words an asset's availability, so the offline page, the
 * project Files section, the track drawer and the Studio say the same thing.
 */
export function offlineLabel(state: OfflineState): string | null {
  switch (state) {
    case 'saved':
      return 'Available offline';
    case 'stale':
      return 'Offline copy out of date';
    case 'none':
      return 'Online only';
    case 'unsupported':
    default:
      return null;
  }
}

export function offlineTone(state: OfflineState): 'ok' | 'warn' | 'quiet' {
  return state === 'saved' ? 'ok' : state === 'stale' ? 'warn' : 'quiet';
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  audio: 'Audio',
  stem: 'Stem',
  artwork: 'Artwork',
  document: 'Document',
  project: 'Project file',
  other: 'File',
};
export function assetKindLabel(kind: Asset['kind']): string {
  return KIND_LABEL[kind];
}

const LOCATION_LABEL: Record<Asset['location'], string> = {
  public: 'Public',
  private: 'Private',
  local: 'This server',
};
/** Who can fetch the bytes: the public store/CDN, only the owner through the app, or the local-dev disk. */
export function locationLabel(location: Asset['location']): string {
  return LOCATION_LABEL[location];
}
