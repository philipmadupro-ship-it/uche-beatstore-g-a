'use client';

import { useEffect, useState } from 'react';
import { getCachedMeta } from '@/lib/offline/audio-cache';
import { resolveStudioAsset, type StudioResolveResult } from '@/lib/assets';
import type { StudioSource } from '@/lib/assets';

export type StudioAssetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: StudioSource }
  | { status: 'error'; message: string };

/**
 * Resolve `/studio?asset=<id>` into a `StudioSource` through the dashboard's
 * own owner-gated reads (lib/assets/studio-resolve). The result is stored with
 * the id it answers, so a change of id never shows the previous file.
 */
export function useStudioAssetSource(assetId: string | null): StudioAssetState {
  const [done, setDone] = useState<{ id: string; result: StudioResolveResult } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    void resolveStudioAsset(assetId, {
      readSaved: async (cacheId) => {
        try {
          const meta = await getCachedMeta(cacheId);
          return meta ? { title: meta.title, size: meta.size } : null;
        } catch {
          return null; // IndexedDB unavailable
        }
      },
    }).then((result) => {
      if (!cancelled) setDone({ id: assetId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (!assetId) return { status: 'idle' };
  if (!done || done.id !== assetId) return { status: 'loading' };
  return done.result.ok ? { status: 'ready', source: done.result.source } : { status: 'error', message: done.result.message };
}
