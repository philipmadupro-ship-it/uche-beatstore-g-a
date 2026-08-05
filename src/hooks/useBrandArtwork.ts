'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { normalisePalette } from '@/lib/artwork/palette';

/**
 * The producer's default artwork and brand palette, fetched once per session.
 *
 * Every card that lacks a cover needs this, which on a full library page is
 * fifty components asking the same question. A shared store with a single
 * in-flight fetch keeps that to one request; a hook-local fetch would issue
 * fifty, and a context provider would mean threading a provider through both
 * the dashboard and storefront trees for two fields.
 */
interface BrandArtworkState {
  defaultArtworkUrl: string | null;
  palette: string[];
  loaded: boolean;
  loading: boolean;
  load: () => void;
  /** Applied straight after the producer saves, so Settings updates live. */
  set: (next: { defaultArtworkUrl: string | null; palette: string[] }) => void;
}

export const useBrandArtworkStore = create<BrandArtworkState>((set, get) => ({
  defaultArtworkUrl: null,
  palette: [],
  loaded: false,
  loading: false,

  load: () => {
    const { loaded, loading } = get();
    if (loaded || loading) return;
    set({ loading: true });

    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const profile = j?.profile ?? {};
        set({
          defaultArtworkUrl: profile.default_artwork_url ?? null,
          palette: normalisePalette(profile.default_artwork_palette),
          loaded: true,
          loading: false,
        });
      })
      .catch(() => {
        // A failed fetch must not block rendering: `generateGradient` falls
        // back to the theme accent, so covers still appear, just unbranded.
        set({ loaded: true, loading: false });
      });
  },

  set: ({ defaultArtworkUrl, palette }) =>
    set({ defaultArtworkUrl, palette, loaded: true }),
}));

export function useBrandArtwork() {
  const defaultArtworkUrl = useBrandArtworkStore((s) => s.defaultArtworkUrl);
  const palette = useBrandArtworkStore((s) => s.palette);
  const load = useBrandArtworkStore((s) => s.load);

  useEffect(() => { load(); }, [load]);

  return { defaultArtworkUrl, palette };
}
