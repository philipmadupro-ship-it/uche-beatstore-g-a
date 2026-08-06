'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { normalisePalette } from '@/lib/artwork/palette';
import type { ArtworkKind } from '@/lib/artwork/gradient';

/**
 * The producer's brand assets: a logo, and one default artwork per kind.
 *
 * Fetched once per session. Every card that lacks a cover needs this, which on
 * a full library page is fifty components asking the same question — a shared
 * store with a single in-flight fetch keeps that to one request.
 */
export interface KindArtwork {
  url: string | null;
  palette: string[];
}

interface BrandArtworkState {
  logoUrl: string | null;
  /** Per kind. `track` doubles as the fallback for the other two. */
  artwork: Record<ArtworkKind, KindArtwork>;
  loaded: boolean;
  loading: boolean;
  load: () => void;
  /** Applied straight after a save so Settings updates without a refetch. */
  apply: (next: Partial<Omit<BrandArtworkState, 'load' | 'apply'>>) => void;
}

const EMPTY: KindArtwork = { url: null, palette: [] };

export const useBrandArtworkStore = create<BrandArtworkState>((set, get) => ({
  logoUrl: null,
  artwork: { track: EMPTY, project: EMPTY, playlist: EMPTY },
  loaded: false,
  loading: false,

  load: () => {
    const { loaded, loading } = get();
    if (loaded || loading) return;
    set({ loading: true });

    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const p = j?.profile ?? {};
        set({
          logoUrl: p.logo_url ?? null,
          artwork: {
            track: {
              url: p.default_artwork_url ?? null,
              palette: normalisePalette(p.default_artwork_palette),
            },
            project: {
              url: p.default_artwork_project_url ?? null,
              palette: normalisePalette(p.default_artwork_project_palette),
            },
            playlist: {
              url: p.default_artwork_playlist_url ?? null,
              palette: normalisePalette(p.default_artwork_playlist_palette),
            },
          },
          loaded: true,
          loading: false,
        });
      })
      // A failed fetch must not block rendering: gradients fall back to the
      // theme accent, so covers still appear, just unbranded.
      .catch(() => set({ loaded: true, loading: false }));
  },

  apply: (next) => set({ ...next, loaded: true } as Partial<BrandArtworkState>),
}));

/**
 * Resolve the artwork for one kind.
 *
 * Projects and playlists fall back to the track artwork when they have none of
 * their own. Setting one image and having it used everywhere is the reasonable
 * default; the other two slots exist for producers who want to differentiate,
 * not as three things you must fill in before anything works.
 */
export function useBrandArtwork(kind: ArtworkKind = 'track') {
  const logoUrl = useBrandArtworkStore((s) => s.logoUrl);
  const artwork = useBrandArtworkStore((s) => s.artwork);
  const load = useBrandArtworkStore((s) => s.load);

  useEffect(() => { load(); }, [load]);

  const own = artwork[kind] ?? EMPTY;
  const fallback = artwork.track ?? EMPTY;
  const resolved = own.url ? own : fallback;

  return {
    logoUrl,
    defaultArtworkUrl: resolved.url,
    // Palette follows the image it was extracted from — using one kind's
    // image with another's colours would tint it wrong.
    palette: resolved.palette.length > 0 ? resolved.palette : fallback.palette,
  };
}
