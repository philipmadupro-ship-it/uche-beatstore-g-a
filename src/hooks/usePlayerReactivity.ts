'use client';

import { create } from 'zustand';

/**
 * The playing track's loudness + bass, published once by PlayerBar (which
 * already computes them for the Now Playing art) so any hero can react to the
 * music without starting its own spectral analysis. Two numbers, written only
 * while something plays.
 */
interface PlayerReactivityState {
  level: number;
  bass: number;
  playing: boolean;
  publish: (next: { level: number; bass: number; playing: boolean }) => void;
}

export const usePlayerReactivity = create<PlayerReactivityState>((set) => ({
  level: 0,
  bass: 0,
  playing: false,
  publish: (next) => set(next),
}));
