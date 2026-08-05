'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Open/closed state of the secondary navigation panel.
 *
 * Persisted, because this is a workspace preference rather than a transient
 * UI state: a producer who works with the panel closed should not have to
 * close it again on every navigation, and one who keeps it open should not
 * lose their nav on reload.
 *
 * Lives outside the components because three of them need it — the TopBar
 * renders the toggle, the panel renders itself, and the dashboard layout has
 * to inset the content so nothing sits underneath.
 */
interface NavPanelState {
  open: boolean;
  /** Which hub sections are expanded in the panel, by group key. */
  expanded: string[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  toggleSection: (key: string) => void;
}

export const useNavPanel = create<NavPanelState>()(
  persist(
    (set, get) => ({
      // Open by default: a producer landing in a new workspace should see the
      // navigation, not have to discover a toggle to find it.
      open: true,
      expanded: [],
      setOpen: (open) => set({ open }),
      toggle: () => set({ open: !get().open }),
      toggleSection: (key) => {
        const cur = get().expanded;
        set({ expanded: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
      },
    }),
    { name: 'antigravity-nav-panel' },
  ),
);
