import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Track } from '@/lib/types';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  history: Track[];
  isPlaying: boolean;
  progress: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /**
   * When non-null, WavePlayer reads this on every render cycle and seeks
   * its WaveSurfer instance to that fraction (0..1), then clears it back
   * to null.  External components (store grid waveform, share page) write
   * here via seekTo() to seek the active audio engine without holding a
   * direct ref to the WaveSurfer instance.
   */
  seekTarget: number | null;
  /**
   * Transient playback gain multiplier (0..1) used to "duck" the beat under
   * the voice-tag overlay on store previews. WavePlayer multiplies it into
   * the engine volume. Default 1 (no ducking). VoiceTagPlayer dips it while
   * the tag fires, then restores it.
   */
  duckGain: number;

  // Core controls
  setTrack: (track: Track) => void;
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  setPlaying: (isPlaying: boolean) => void;
  setProgress: (progress: number) => void;
  setVolume: (volume: number) => void;
  /** Set the transient duck gain (0..1). Used by the voice-tag overlay. */
  setDuckGain: (g: number) => void;
  /** Seek the active audio engine to a fraction 0..1 of the track. */
  seekTo: (fraction: number) => void;

  // Navigation
  next: () => void;
  prev: () => void;

  // Modes
  toggleShuffle: () => void;
  setRepeat: (mode: RepeatMode) => void;
  cycleRepeat: () => void;
}

function pickRandom<T>(arr: T[], exclude: T | null): T | undefined {
  if (arr.length === 0) return undefined;
  if (arr.length === 1) return arr[0];
  let pick = arr[Math.floor(Math.random() * arr.length)];
  let attempts = 0;
  while (pick === exclude && attempts < 5) {
    pick = arr[Math.floor(Math.random() * arr.length)];
    attempts += 1;
  }
  return pick;
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      history: [],
      isPlaying: false,
      progress: 0,
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
      seekTarget: null,
      duckGain: 1,

      setTrack: (track) => {
        const prev = get().currentTrack;
        set((state) => ({
          currentTrack: track,
          isPlaying: true,
          progress: 0,
          // Ensure the new track lives in the queue so the queue drawer reflects
          // what's actually playing. If it's already there we leave order intact.
          queue: state.queue.some((t) => t.id === track.id)
            ? state.queue
            : [...state.queue, track],
          history: prev && prev.id !== track.id ? [...state.history, prev].slice(-50) : state.history,
        }));
      },

      setQueue: (tracks) => set({ queue: tracks }),

      addToQueue: (track) =>
        set((state) =>
          state.queue.some((t) => t.id === track.id) ? state : { queue: [...state.queue, track] }
        ),

      removeFromQueue: (id) =>
        set((state) => ({ queue: state.queue.filter((t) => t.id !== id) })),

      reorderQueue: (from, to) =>
        set((state) => {
          const next = [...state.queue];
          const [moved] = next.splice(from, 1);
          if (!moved) return state;
          next.splice(to, 0, moved);
          return { queue: next };
        }),

      clearQueue: () => set({ queue: [] }),

      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaying: (isPlaying) => set({ isPlaying }),
      setProgress: (progress) => set({ progress }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      setDuckGain: (g) => set({ duckGain: Math.max(0, Math.min(1, g)) }),
      seekTo: (fraction) => set({ seekTarget: Math.max(0, Math.min(1, fraction)) }),

      next: () => {
        const { currentTrack, queue, repeat, shuffle, history } = get();
        if (!currentTrack || queue.length === 0) return;

        // repeat one → restart current
        if (repeat === 'one') {
          set({ progress: 0, isPlaying: true });
          return;
        }

        const index = queue.findIndex((t) => t.id === currentTrack.id);

        if (shuffle) {
          const pool = queue.filter((t) => t.id !== currentTrack.id);
          const pick = pickRandom(pool, null);
          if (!pick) return;
          set({
            currentTrack: pick,
            progress: 0,
            isPlaying: true,
            history: [...history, currentTrack].slice(-50),
          });
          return;
        }

        let nextTrack: Track | undefined = queue[index + 1];
        if (!nextTrack) {
          if (repeat === 'all') nextTrack = queue[0];
          else {
            set({ isPlaying: false, progress: 0 });
            return;
          }
        }
        set({
          currentTrack: nextTrack,
          progress: 0,
          isPlaying: true,
          history: [...history, currentTrack].slice(-50),
        });
      },

      prev: () => {
        const { currentTrack, queue, history, progress } = get();
        if (!currentTrack) return;

        // If >3s into track, restart instead of going back
        if (progress > 3) {
          set({ progress: 0 });
          return;
        }

        // Pop from history first
        if (history.length > 0) {
          const prevTrack = history[history.length - 1];
          set((state) => ({
            currentTrack: prevTrack,
            history: state.history.slice(0, -1),
            progress: 0,
            isPlaying: true,
          }));
          return;
        }

        // Fallback to queue index
        const index = queue.findIndex((t) => t.id === currentTrack.id);
        const prevTrack = queue[index - 1] || queue[queue.length - 1];
        if (prevTrack) set({ currentTrack: prevTrack, progress: 0, isPlaying: true });
      },

      toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
      setRepeat: (mode) => set({ repeat: mode }),
      cycleRepeat: () =>
        set((state) => ({
          repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
        })),
    }),
    {
      name: 'antigravity-player',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : (undefined as any))),
      // Don't persist transient playback state
      partialize: (state) => ({
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
        queue: state.queue,
        currentTrack: state.currentTrack,
      }),
    }
  )
);
