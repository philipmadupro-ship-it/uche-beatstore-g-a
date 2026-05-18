'use client';

import { useEffect, useState } from 'react';
import { CloudDownload, CloudCheck, Loader2, X } from 'lucide-react';
import { cacheTrack, getCachedMeta, removeCached } from '@/lib/offline/audio-cache';
import { toast } from '@/hooks/useToast';

/**
 * "Sync playlist offline" button.
 *
 * Drives the same IndexedDB blob cache that powers the per-track
 * OfflineToggle. The wedge is: a producer or artist on the move
 * wants to sync a whole curated set in one tap, not click 12
 * download buttons.
 *
 * State machine:
 *   - idle              : "Sync offline" (cloud-download icon)
 *   - syncing N/M       : spinner + progress count
 *   - all cached        : "Synced" (cloud-check, click to clear)
 *   - partial cached    : "Sync remaining N" (shows how many are missing)
 *
 * Downloads run sequentially so a 30-track set doesn't open 30 parallel
 * Range requests against R2 — politer to the CDN, easier to reason about
 * progress, and the user is rarely staring at the bar anyway. If the user
 * leaves the page mid-sync the loop bails out cleanly via a cancel flag.
 */

interface PlaylistTrack {
  id: string;
  audio_url: string;
  title: string;
}

interface Props {
  tracks: PlaylistTrack[];
}

export function PlaylistOfflineSync({ tracks }: Props) {
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const cancelRef = { current: false };

  // Initial scan of cache state. Cheap (IDB metadata reads), runs once
  // per playlist mount and after each sync/clear so the chip stays
  // honest about what's actually on disk.
  const refresh = async () => {
    const present = new Set<string>();
    for (const t of tracks) {
      const meta = await getCachedMeta(t.id);
      if (meta) present.add(t.id);
    }
    setCachedIds(present);
  };

  useEffect(() => {
    refresh();
    return () => {
      // Bail out of an in-flight loop if the user navigates away.
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => t.id).join(',')]);

  const missing = tracks.filter((t) => !cachedIds.has(t.id));
  const allCached = tracks.length > 0 && missing.length === 0;

  const handleSync = async () => {
    if (!missing.length || syncing) return;
    setSyncing(true);
    setProgress({ done: 0, total: missing.length });
    cancelRef.current = false;
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < missing.length; i++) {
      if (cancelRef.current) break;
      const t = missing[i];
      try {
        await cacheTrack(t.id, t.audio_url, t.title);
        succeeded += 1;
      } catch (err) {
        console.error(`Cache failed for ${t.title}:`, err);
        failed += 1;
      }
      setProgress({ done: i + 1, total: missing.length });
    }
    setSyncing(false);
    await refresh();
    if (failed === 0) {
      toast.success(`Synced ${succeeded} track${succeeded === 1 ? '' : 's'} offline`);
    } else {
      toast.warning(
        `Synced ${succeeded}, ${failed} failed`,
        'Failed tracks stay un-cached — try again or check the audio URL.',
      );
    }
  };

  const handleClear = async () => {
    if (syncing) return;
    for (const t of tracks) {
      if (cachedIds.has(t.id)) {
        try { await removeCached(t.id); } catch {/* swallow */}
      }
    }
    await refresh();
    toast.success(`Cleared ${cachedIds.size} cached track${cachedIds.size === 1 ? '' : 's'}`);
  };

  if (!tracks.length) return null;

  if (syncing) {
    return (
      <button
        disabled
        className="flex items-center gap-2 bg-[#14110d] border border-[#2d2620] text-[#E8D8B8] px-4 py-2 rounded-md text-[12px] font-medium"
      >
        <Loader2 size={12} className="animate-spin" />
        Syncing {progress.done}/{progress.total}
      </button>
    );
  }

  if (allCached) {
    return (
      <button
        onClick={handleClear}
        className="group flex items-center gap-2 bg-[#0e1f17] border border-[#6DC6A4]/30 text-[#6DC6A4] hover:bg-red-950/30 hover:text-red-400 hover:border-red-900/50 px-4 py-2 rounded-md text-[12px] font-medium transition-colors"
        title={`${cachedIds.size} tracks cached offline — click to clear`}
      >
        <CloudCheck size={12} className="group-hover:hidden" />
        <X size={12} className="hidden group-hover:inline" />
        Synced offline
      </button>
    );
  }

  return (
    <button
      onClick={handleSync}
      className="flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
      title={cachedIds.size > 0 ? `${cachedIds.size}/${tracks.length} already cached` : 'Cache for offline playback'}
    >
      <CloudDownload size={12} />
      {cachedIds.size > 0 ? `Sync remaining ${missing.length}` : 'Sync offline'}
    </button>
  );
}
