'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  DEFAULT_TEMPO_TOLERANCE,
  clampSessionBpm,
  type SessionContext,
} from '@/lib/audio/session-match';
import { relativeKey, type CanonicalKey, type Scale } from '@/lib/audio/key-normalize';

/**
 * The tempo and key of whatever the producer currently has open in their DAW.
 *
 * Every track row is read against it — same key, relative key, half-time — so
 * browsing the catalogue answers "does this fit what I'm working on" rather
 * than "what key is this in". Optionally the preview is adjusted to match too;
 * see `previewInSession`.
 *
 * Persisted to localStorage rather than to `creator_profiles`, for the same
 * reason `lib/notifications/desktop.ts` keeps its preference locally: this
 * describes the machine the producer is sitting at. The session open on the
 * studio Mac is not the session open on the laptop, and an account-level value
 * would claim otherwise.
 *
 * Deliberately NOT a filter. Setting a tempo marks what fits and leaves the
 * catalogue intact; `matchTolerance` only widens what counts as a match. A
 * session context that silently hid two thirds of the library every time it
 * was set would be abandoned within a day.
 */
interface SessionContextState extends SessionContext {
  /** How many BPM either side still counts as the same tempo. */
  matchTolerance: number;
  /** Whether previews are time-stretched to the session tempo. */
  previewInSession: boolean;

  setBpm: (bpm: number | null) => void;
  setKey: (key: CanonicalKey | null, scale?: Scale | null) => void;
  setScale: (scale: Scale | null) => void;
  /** Swap to the relative major/minor — the key sharing the same pitches. */
  makeRelative: () => void;
  /** Halve or double the tempo, the way a DAW's ½ / 2× buttons do. */
  scaleTempo: (factor: number) => void;
  setMatchTolerance: (bpm: number) => void;
  setPreviewInSession: (on: boolean) => void;
  clear: () => void;
}

/** The tolerances offered: exact, a little, and "near enough to warp". */
export const TOLERANCE_CHOICES = [0, DEFAULT_TEMPO_TOLERANCE, 6] as const;

const EMPTY = {
  bpm: null,
  key: null,
  scale: null,
  matchTolerance: DEFAULT_TEMPO_TOLERANCE,
  previewInSession: false,
} as const;

export const useSessionContext = create<SessionContextState>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      setBpm: (bpm) => set({ bpm: bpm == null ? null : clampSessionBpm(bpm) }),

      // Setting a key without naming a mode keeps whatever mode was already
      // chosen, so picking a different tonic off the keyboard does not quietly
      // throw away "minor".
      setKey: (key, scale) =>
        set({ key, scale: scale === undefined ? get().scale : scale }),

      setScale: (scale) => set({ scale }),

      makeRelative: () => {
        const { key, scale } = get();
        // Undefined without both: the relative of a bare tonic is not a thing.
        if (key == null || scale == null) return;
        const rel = relativeKey(key, scale);
        set({ key: rel.key, scale: rel.scale });
      },

      scaleTempo: (factor) => {
        const { bpm } = get();
        if (bpm == null) return;
        set({ bpm: clampSessionBpm(bpm * factor) });
      },

      setMatchTolerance: (bpm) => set({ matchTolerance: Math.max(0, Math.round(bpm)) }),
      setPreviewInSession: (on) => set({ previewInSession: on }),

      // Clearing resets the tempo and key but leaves the two preferences
      // alone: "stop matching this session" is not "forget how I like the
      // matching to behave".
      clear: () => set({ bpm: null, key: null, scale: null }),
    }),
    { name: 'antigravity-session-context' },
  ),
);
