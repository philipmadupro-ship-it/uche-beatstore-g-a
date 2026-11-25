'use client';

/**
 * Save-offline control for one project file (AUDIO-01). Only audio files get
 * one — the same IndexedDB store, state machine and wording as a track
 * (`useOfflineTrack`, `lib/assets/availability`), keyed by the file's asset
 * id. The bytes come through the file's own owner-gated download route; no
 * reference ever reaches the page.
 */
import { CheckCircle2, CloudDownload, Loader2, RefreshCw } from 'lucide-react';
import { useOfflineTrack } from '@/hooks/useOfflineCache';
import { assetsOfProject, canSaveOffline, offlineCacheId, offlineLabel } from '@/lib/assets';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

export function ProjectFileOffline({ file }: { file: ProjectAssetView }) {
  const asset = assetsOfProject([file])[0];
  const supported = canSaveOffline(asset);
  const { isCached, isStale, downloading, progress, error, announcement, download, remove } = useOfflineTrack(
    supported ? offlineCacheId(asset) : null,
    asset.contentKey,
  );
  if (!supported || !asset.openUrl) return null;

  const state = isCached ? (isStale ? 'stale' : 'saved') : 'none';
  const word = offlineLabel(state) ?? '';
  const action = downloading
    ? `Saving ${asset.label} offline, ${Math.round(progress * 100)}%`
    : state === 'saved'
      ? `${asset.label}: ${word}. Remove offline copy`
      : state === 'stale'
        ? `${asset.label}: ${word}. Update offline copy`
        : `Save ${asset.label} offline`;

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
      <button
        type="button"
        disabled={downloading}
        onClick={() => (state === 'saved' ? void remove() : void download(asset.openUrl as string, asset.label))}
        aria-label={action}
        title={error ? `${word} — ${error}` : word}
        data-testid={`project-file-offline-${file.id}`}
        data-state={downloading ? 'downloading' : state}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-[11px] transition-colors hover:bg-white/[0.10] ${
          state === 'saved' ? 'text-[#6DC6A4]' : 'text-white/50 hover:text-white'
        }`}
      >
        {downloading ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : state === 'saved' ? (
          <CheckCircle2 size={14} aria-hidden="true" />
        ) : state === 'stale' ? (
          <RefreshCw size={14} aria-hidden="true" />
        ) : (
          <CloudDownload size={14} aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{downloading ? `${Math.round(progress * 100)}%` : word}</span>
      </button>
    </>
  );
}
