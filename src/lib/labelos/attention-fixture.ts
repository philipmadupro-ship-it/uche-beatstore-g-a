/**
 * The canonical scenario for Needs attention (03 "Monday morning", 04 W8,
 * 07 §2.1 wireframe): the owner opens the Overview and sees exactly three
 * lines —
 *
 *   EP 2027 · Artist A · blocked: Legal (Dana), Artwork (Maya) · 23d
 *   Track 04 · in development 41 days
 *   2 overdue tasks
 *
 * Everything else here is noise that must NOT be listed: a release that is
 * ready, one blocked but a month out, a delivered one, songs one day short of
 * the threshold or in stages that cannot stall, tasks not yet due.
 * attention.test.ts holds the three; the store and route tests build the same
 * world in the in-memory database.
 */
import { parseAttentionSettings } from '@/lib/contracts';
import type { AttentionInput, AttentionRelease, AttentionSong, AttentionTask } from './attention';

export const CANONICAL_NOW = new Date('2026-10-13T09:00:00Z');

export const P = {
  dana: { id: '20000000-0000-4000-8000-0000000000d1', name: 'Dana' },
  maya: { id: '20000000-0000-4000-8000-0000000000d2', name: 'Maya' },
  sam: { id: '20000000-0000-4000-8000-0000000000d3', name: 'Sam' },
  pm: { id: '20000000-0000-4000-8000-0000000000d4', name: 'Pat' },
} as const;

export const ARTIST_A = '30000000-0000-4000-8000-0000000000a1';
export const ARTIST_B = '30000000-0000-4000-8000-0000000000b1';

const gates = (blocked: Record<string, { id: string; name: string }>): AttentionRelease['gates'] =>
  (['tracklist', 'masters', 'credits_splits', 'legal', 'artwork', 'metadata', 'marketing'] as const).map((gate) => ({
    gate,
    blocked: gate in blocked,
    person: blocked[gate] ?? null,
  }));

export const CANONICAL_RELEASES: AttentionRelease[] = [
  // 1 — the EP: target 2026-11-05 is 23 days out; Legal waits on Dana, Artwork on Maya.
  { id: '60000000-0000-4000-8000-000000000001', title: 'EP 2027', artistIds: [ARTIST_A], artistName: 'Artist A', state: 'draft', targetDate: '2026-11-05', gates: gates({ legal: P.dana, artwork: P.maya }), owner: P.pm },
  // Single 01 is ready to deliver: no gate holds a blocker.
  { id: '60000000-0000-4000-8000-000000000002', title: 'Single 01', artistIds: [ARTIST_A], artistName: 'Artist A', state: 'draft', targetDate: '2026-10-20', gates: gates({}), owner: P.pm },
  // Blocked, but 31 days out (the threshold is 30).
  { id: '60000000-0000-4000-8000-000000000003', title: 'Album 2028', artistIds: [ARTIST_B], artistName: 'Artist B', state: 'draft', targetDate: '2026-11-13', gates: gates({ metadata: P.maya }), owner: P.pm },
  // Blocked and no date: nothing to be "near".
  { id: '60000000-0000-4000-8000-000000000004', title: 'Undated EP', artistIds: [ARTIST_B], artistName: 'Artist B', state: 'draft', targetDate: null, gates: gates({ legal: P.dana }), owner: P.pm },
  // Already out.
  { id: '60000000-0000-4000-8000-000000000005', title: 'Delivered EP', artistIds: [ARTIST_A], artistName: 'Artist A', state: 'delivered', targetDate: '2026-10-01', gates: gates({ legal: P.dana }), owner: P.pm },
];

export const CANONICAL_SONGS: AttentionSong[] = [
  // 2 — Track 04: in development since 2026-09-02, 41 days.
  { id: '50000000-0000-4000-8000-000000000004', title: 'Track 04', artistIds: [ARTIST_A], artistName: 'Artist A', stage: 'in_development', since: '2026-09-02T08:00:00Z', person: P.sam, readable: true },
  // 30 days exactly: not MORE than 30.
  { id: '50000000-0000-4000-8000-000000000005', title: 'Track 05', artistIds: [ARTIST_A], artistName: 'Artist A', stage: 'in_development', since: '2026-09-13T09:00:00Z', person: P.sam, readable: true },
  // The A&R queue, a parked song and a song waiting for its release slot cannot stall.
  { id: '50000000-0000-4000-8000-000000000006', title: 'Old demo', artistIds: [ARTIST_B], artistName: 'Artist B', stage: 'inbox', since: '2026-06-01T00:00:00Z', person: null, readable: true },
  { id: '50000000-0000-4000-8000-000000000007', title: 'Waiting', artistIds: [ARTIST_A], artistName: 'Artist A', stage: 'selected', since: '2026-05-01T00:00:00Z', person: null, readable: true },
  { id: '50000000-0000-4000-8000-000000000008', title: 'On hold', artistIds: [ARTIST_B], artistName: 'Artist B', stage: 'on_hold', since: '2026-05-01T00:00:00Z', person: null, readable: true },
];

export const CANONICAL_TASKS: AttentionTask[] = [
  // 3 — two overdue tasks, both Sam's.
  { id: '70000000-0000-4000-8000-000000000001', title: 'Get Producer X IPI', dueAt: '2026-10-08T00:00:00Z', assignee: P.sam, creator: P.pm, target: { kind: 'song', id: '50000000-0000-4000-8000-000000000004' } },
  { id: '70000000-0000-4000-8000-000000000002', title: 'Chase the artwork', dueAt: '2026-10-10T00:00:00Z', assignee: P.sam, creator: P.pm, target: null },
  // Due later today and in the future: not overdue.
  { id: '70000000-0000-4000-8000-000000000003', title: 'Send the EP', dueAt: '2026-10-13T20:00:00Z', assignee: P.sam, creator: P.pm, target: null },
  { id: '70000000-0000-4000-8000-000000000004', title: 'Plan the rollout', dueAt: '2026-10-30T00:00:00Z', assignee: P.maya, creator: P.pm, target: null },
  { id: '70000000-0000-4000-8000-000000000005', title: 'Whenever', dueAt: null, assignee: P.maya, creator: P.pm, target: null },
];

export function canonicalInput(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    orgSlug: 'north-star',
    now: CANONICAL_NOW,
    settings: parseAttentionSettings({}),
    artistScope: null,
    releases: CANONICAL_RELEASES,
    songs: CANONICAL_SONGS,
    tasks: CANONICAL_TASKS,
    ...over,
  };
}
