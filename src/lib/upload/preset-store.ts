'use client';

import { create } from 'zustand';
import type { TrackStatus, TrackType } from '@/lib/types';
import { readUploadTypeDraft, writeUploadTypeDraft } from '@/lib/upload/dropzone-draft';
import {
  EMPTY_PRESET,
  toggleUploadTag,
  type UploadDestination,
  type UploadPreset,
  type UploadTag,
} from '@/lib/upload/preset';

/**
 * The options for the next upload, shared by the Upload options popover (a
 * button next to "Upload beat") and the drop zone that reads them.
 *
 * Only `type` is remembered across visits (it always was). Status, tags and the
 * destination are deliberately NOT persisted: a producer who tagged one session
 * "Dark" must not have every later upload silently tagged Dark.
 */
interface UploadPresetState extends UploadPreset {
  type: TrackType;
  setType: (t: TrackType) => void;
  setStatus: (s: TrackStatus | null) => void;
  toggleTag: (t: UploadTag) => void;
  setDestination: (d: UploadDestination | null) => void;
  reset: () => void;
}

export const useUploadPreset = create<UploadPresetState>((set) => ({
  type: readUploadTypeDraft('instrumental'),
  ...EMPTY_PRESET,
  setType: (type) => { writeUploadTypeDraft(type); set({ type }); },
  setStatus: (status) => set({ status }),
  toggleTag: (t) => set((s) => ({ tags: toggleUploadTag(s.tags, t) })),
  setDestination: (destination) => set({ destination }),
  reset: () => set({ ...EMPTY_PRESET }),
}));
