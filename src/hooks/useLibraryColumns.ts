'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_COLUMN_IDS, reorderColumns, toggleColumn } from '@/lib/library/columns';

export interface SavedLayout {
  name: string;
  columnIds: string[];
}

/**
 * Which library columns are shown, in what order, plus named layouts.
 *
 * Persisted because it is a workspace preference, not session state — the
 * point of arranging columns for pricing work is that they are still arranged
 * that way tomorrow.
 *
 * Layouts are named sets rather than a single remembered arrangement: the
 * workflows that motivate this feature alternate (mixing vs pricing vs
 * cataloguing), and re-picking eight columns each time you switch is the
 * problem, not the solution.
 */
interface LibraryColumnsState {
  columnIds: string[];
  layouts: SavedLayout[];
  toggle: (id: string) => void;
  move: (from: number, to: number) => void;
  reset: () => void;
  saveLayout: (name: string) => void;
  applyLayout: (name: string) => void;
  deleteLayout: (name: string) => void;
}

export const useLibraryColumns = create<LibraryColumnsState>()(
  persist(
    (set, get) => ({
      columnIds: DEFAULT_COLUMN_IDS,
      layouts: [],

      toggle: (id) => set({ columnIds: toggleColumn(get().columnIds, id) }),
      move: (from, to) => set({ columnIds: reorderColumns(get().columnIds, from, to) }),
      reset: () => set({ columnIds: DEFAULT_COLUMN_IDS }),

      saveLayout: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const columnIds = [...get().columnIds];
        const existing = get().layouts.filter((l) => l.name !== trimmed);
        // Re-saving a name overwrites it rather than creating a second entry
        // the user cannot tell apart in the menu.
        set({ layouts: [...existing, { name: trimmed, columnIds }] });
      },

      applyLayout: (name) => {
        const layout = get().layouts.find((l) => l.name === name);
        if (layout) set({ columnIds: [...layout.columnIds] });
      },

      deleteLayout: (name) => set({ layouts: get().layouts.filter((l) => l.name !== name) }),
    }),
    { name: 'antigravity-library-columns' },
  ),
);
