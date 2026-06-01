import { nanoid } from 'nanoid';
import type { ChecklistItem } from '@/components/projects/ProjectChecklist';

export interface ProjectTemplate {
  slug: string;
  label: string;
  emoji: string;
  description: string;
  defaultTracks: number;
  checklist: Omit<ChecklistItem, 'id'>[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    slug: 'album',
    label: 'Album',
    emoji: '💿',
    description: '10–16 tracks, full release cycle',
    defaultTracks: 12,
    checklist: [
      { label: 'Lock tracklist', done: false },
      { label: 'Cover art', done: false },
      { label: 'Mix all tracks', done: false },
      { label: 'Master all tracks', done: false },
      { label: 'Upload WAV/stems', done: false },
      { label: 'Set prices + descriptions', done: false },
      { label: 'Publish to store', done: false },
    ],
  },
  {
    slug: 'ep',
    label: 'EP',
    emoji: '🎵',
    description: '3–6 tracks',
    defaultTracks: 5,
    checklist: [
      { label: 'Finalise track selection', done: false },
      { label: 'Cover art', done: false },
      { label: 'Mix', done: false },
      { label: 'Master', done: false },
      { label: 'Publish to store', done: false },
    ],
  },
  {
    slug: 'single',
    label: 'Single',
    emoji: '🎸',
    description: '1–2 tracks',
    defaultTracks: 1,
    checklist: [
      { label: 'Final mix', done: false },
      { label: 'Cover art', done: false },
      { label: 'Upload stems', done: false },
      { label: 'Publish to store', done: false },
    ],
  },
  {
    slug: 'beat_tape',
    label: 'Beat tape',
    emoji: '🥁',
    description: 'Instrumental compilation',
    defaultTracks: 10,
    checklist: [
      { label: 'Sequence tracks', done: false },
      { label: 'Cover art', done: false },
      { label: 'Export all stems', done: false },
      { label: 'Set bundle price', done: false },
      { label: 'Publish', done: false },
    ],
  },
  {
    slug: 'loop_kit',
    label: 'Loop kit',
    emoji: '🔁',
    description: 'Packaged loop/sample collection',
    defaultTracks: 20,
    checklist: [
      { label: 'Organise by key + BPM', done: false },
      { label: 'Render all loops as WAV', done: false },
      { label: 'Cover art', done: false },
      { label: 'Write description + credits', done: false },
      { label: 'Publish to store', done: false },
    ],
  },
  {
    slug: 'client',
    label: 'Client project',
    emoji: '🤝',
    description: 'Private delivery for an artist',
    defaultTracks: 0,
    checklist: [
      { label: 'Send preview share link', done: false },
      { label: 'Collect feedback', done: false },
      { label: 'Upload final stems', done: false },
      { label: 'Invoice + close deal', done: false },
    ],
  },
];

/** Seed a fresh checklist from a template (assigns real ids). */
export function seedChecklist(template: ProjectTemplate): ChecklistItem[] {
  return template.checklist.map((it) => ({ ...it, id: nanoid(8) }));
}
