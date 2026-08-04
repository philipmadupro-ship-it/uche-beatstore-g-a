/**
 * Discovery terms — turning a catalogue into findable pages.
 *
 * THE PROBLEM THIS SOLVES. Beats here are titled like `151 BPM G# MIN
 * BELLEOMETRY @uche2crazyyy`. That is how a producer finds a file; it is not
 * how a rapper finds a beat. Type-beat sales are search-driven — people search
 * "dark trap type beat", "140 bpm drill beat", "amapiano instrumental" — and
 * the store currently has exactly one indexable page for the whole catalogue.
 * So the only people who ever reach it are people who were sent a link.
 *
 * A discovery term is a search phrase the catalogue can honestly answer,
 * derived from data already stored: genre and mood tags, track type, and BPM.
 * Each becomes a landing page listing the beats that genuinely match.
 *
 * HONESTY IS THE CONSTRAINT. A term is only generated when enough real tracks
 * match it. Pages that promise "drill type beats" and show two unrelated
 * results are worse than no page: they waste the visit, and search engines
 * demote thin pages anyway. `MIN_TRACKS_PER_TERM` is the guard.
 *
 * Pure and dependency-free so the whole thing is unit-testable — per the
 * project rule that logic living inside a component cannot be tested and gets
 * silently reverted.
 */

import { slugify } from '@/lib/slug';

/** Minimum matching tracks before a term earns its own page. */
export const MIN_TRACKS_PER_TERM = 3;

/** BPM buckets people actually search for, rather than exact values. */
const BPM_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: 'slow', min: 60, max: 89 },
  { label: '90 bpm', min: 90, max: 109 },
  { label: '120 bpm', min: 110, max: 129 },
  { label: '140 bpm', min: 130, max: 149 },
  { label: '160 bpm', min: 150, max: 179 },
  { label: 'fast', min: 180, max: 300 },
];

export type DiscoveryKind = 'genre' | 'mood' | 'type' | 'bpm';

export interface DiscoveryTerm {
  /** URL segment, e.g. `dark-trap-type-beat`. */
  slug: string;
  /** Human phrase, e.g. `Dark Trap Type Beat`. */
  label: string;
  kind: DiscoveryKind;
  /** The raw value this was derived from — the tag, type, or bucket label. */
  value: string;
  /** How many catalogue tracks match. */
  count: number;
}

export interface DiscoveryTrack {
  id: string;
  title: string;
  type?: string | null;
  bpm?: number | null;
  tags?: Array<{ tag: string; category?: string | null }> | null;
}

function tagsOf(track: DiscoveryTrack, category: string): string[] {
  return (track.tags ?? [])
    .filter((t) => (t?.category ?? '').toLowerCase() === category)
    .map((t) => (t?.tag ?? '').trim())
    .filter(Boolean);
}

/** The BPM bucket a track falls into, or null when it has no usable BPM. */
export function bpmBucket(bpm: number | null | undefined): string | null {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return null;
  const found = BPM_BUCKETS.find((b) => bpm >= b.min && bpm <= b.max);
  return found ? found.label : null;
}

/**
 * Whether a track matches a term.
 *
 * Kept separate from term generation so the landing page and the term list can
 * never disagree about what belongs on a page — the bug that would otherwise
 * show a "Drill" page containing no drill.
 */
export function trackMatchesTerm(track: DiscoveryTrack, term: DiscoveryTerm): boolean {
  const value = term.value.toLowerCase();
  switch (term.kind) {
    case 'genre':
      return tagsOf(track, 'genre').some((t) => t.toLowerCase() === value);
    case 'mood':
      return tagsOf(track, 'mood').some((t) => t.toLowerCase() === value);
    case 'type':
      return (track.type ?? '').toLowerCase() === value;
    case 'bpm':
      return bpmBucket(track.bpm) === value;
    default:
      return false;
  }
}

/** `Trap` + `genre` → `Trap Type Beat`. Phrasing matches how people search. */
export function labelFor(kind: DiscoveryKind, value: string): string {
  const titled = value
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // BPM is an initialism — title-casing alone yields "140 Bpm".
    .replace(/\bBpm\b/g, 'BPM');
  switch (kind) {
    case 'genre': return `${titled} Type Beat`;
    case 'mood': return `${titled} Type Beat`;
    case 'type': return `${titled}s`;
    case 'bpm': return `${titled} Type Beat`;
    default: return titled;
  }
}

/**
 * Build the set of landing pages this catalogue can honestly support.
 *
 * Sorted by count so the strongest pages are offered first — useful for
 * internal linking, where pointing at your thinnest page first is wasted.
 */
export function buildDiscoveryTerms(
  tracks: DiscoveryTrack[],
  minTracks = MIN_TRACKS_PER_TERM,
): DiscoveryTerm[] {
  const counts = new Map<string, DiscoveryTerm>();

  const bump = (kind: DiscoveryKind, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    const label = labelFor(kind, value);
    const slug = slugify(label);
    if (!slug) return;
    const existing = counts.get(slug);
    if (existing) {
      existing.count += 1;
      return;
    }
    counts.set(slug, { slug, label, kind, value, count: 1 });
  };

  for (const track of tracks) {
    for (const genre of new Set(tagsOf(track, 'genre'))) bump('genre', genre);
    for (const mood of new Set(tagsOf(track, 'mood'))) bump('mood', mood);
    if (track.type) bump('type', track.type);
    const bucket = bpmBucket(track.bpm);
    if (bucket) bump('bpm', bucket);
  }

  return [...counts.values()]
    .filter((t) => t.count >= minTracks)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Find a term by slug. Returns null rather than throwing so the page can 404. */
export function findTermBySlug(terms: DiscoveryTerm[], slug: string): DiscoveryTerm | null {
  const target = slug.trim().toLowerCase();
  return terms.find((t) => t.slug === target) ?? null;
}

/**
 * Page metadata.
 *
 * The count goes in the description because a searcher scanning results wants
 * to know there is something here, and because it is true — these strings are
 * generated from the same match logic the page renders.
 */
export function discoveryMetadata(term: DiscoveryTerm, producerName: string): {
  title: string;
  description: string;
} {
  // Pluralise the LABEL, never append a noun: the label already ends in "Beat",
  // so appending one produced "trap type beat beat".
  const plural = term.count === 1 || term.label.endsWith('s')
    ? term.label
    : `${term.label}s`;
  return {
    title: `${term.label} — ${producerName}`,
    description: `${term.count} ${plural.toLowerCase()} by ${producerName}. `
      + 'Stream free, then license instantly for streaming, video and commercial release.',
  };
}
