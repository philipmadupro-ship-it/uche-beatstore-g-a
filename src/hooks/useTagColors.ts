'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { normaliseTagColors, normaliseTagKey, type TagColorMap } from '@/lib/artwork/tag-colors';

/**
 * The producer's tag colour overrides, fetched once per session.
 *
 * Same shape and reasoning as the brand palette store: every card that renders
 * generated artwork needs this, and a hook-local fetch would issue one request
 * per card on a full library page.
 */
interface TagColorState {
  colors: TagColorMap;
  loaded: boolean;
  loading: boolean;
  load: () => void;
  /** Optimistic local write; the caller persists separately. */
  setLocal: (tag: string, color: string | null) => void;
}

export const useTagColorStore = create<TagColorState>((set, get) => ({
  colors: {},
  loaded: false,
  loading: false,

  load: () => {
    const { loaded, loading } = get();
    if (loaded || loading) return;
    set({ loading: true });

    fetch('/api/tags/colors')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => set({
        colors: normaliseTagColors(j?.colors),
        loaded: true,
        loading: false,
      }))
      // A failure must not block rendering: `colorForTag` falls back to its
      // curated defaults, so artwork still appears, just uncustomised.
      .catch(() => set({ loaded: true, loading: false }));
  },

  setLocal: (tag, color) => {
    const key = normaliseTagKey(tag);
    const next = { ...get().colors };
    if (color) next[key] = color.toLowerCase();
    else delete next[key];
    set({ colors: next });
  },
}));

export function useTagColors() {
  const colors = useTagColorStore((s) => s.colors);
  const load = useTagColorStore((s) => s.load);
  useEffect(() => { load(); }, [load]);
  return colors;
}

/** Persist one tag colour. `null` clears the override. */
export async function saveTagColor(tag: string, color: string | null, category?: string) {
  useTagColorStore.getState().setLocal(tag, color);
  const res = await fetch('/api/tags/colors', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, color, category: category ?? null }),
  });
  if (!res.ok) throw new Error('Could not save tag colour');
}
