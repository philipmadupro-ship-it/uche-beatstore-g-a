#!/usr/bin/env node
/**
 * Writes the storefront scale fixture: 96 listed beats with covers, previews,
 * tags and a spread of BPM / key / price, on top of the base e2e fixture.
 *
 *   node e2e/fixtures/generate-scale-db.mjs > data/db.json
 *
 * Deterministic (no Math.random) so two runs measure the same catalogue.
 * Audio points at `http://127.0.0.1:3458/…`, a tiny server started by
 * `e2e/storefront-scale.spec.ts` with real cache headers; covers at an
 * https host that does not resolve. Nothing leaves the machine.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// More than one /api/store page (80), so anything that treats the first page
// as the whole catalogue shows up.
export const SCALE_BEATS = 96;
// A local server the spec starts (e2e/storefront-scale.spec.ts), not page.route:
// routing disables Chromium's HTTP cache, which would count cache hits as fetches.
export const MEDIA_HOST = process.env.SCALE_MEDIA_HOST ?? 'http://127.0.0.1:3458';
// Covers are forced to https:// by the store (components/store/helpers
// sanitizeUrl), so they use a host that does not resolve. The spec counts the
// requests the page issues (lazy loading); the store shows fallback artwork.
export const COVER_HOST = 'https://scale-fixture.test';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(path.join(here, 'store-db.json'), 'utf-8'));

const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'F#', 'Bb'];
const GENRES = ['Trap', 'Drill', 'Afrobeats', 'Amapiano', 'R&B', 'Lo-fi'];
const MOODS = ['Dark', 'Melodic', 'Aggressive', 'Chill'];

const tracks = Array.from({ length: SCALE_BEATS }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return {
    id: `scale-beat-${n}`,
    created_at: new Date(Date.UTC(2026, 5, 1 + (i % 28), i % 24)).toISOString(),
    title: `SCALE BEAT ${n}`,
    type: i % 9 === 0 ? 'remix' : 'beat',
    audio_url: `${MEDIA_HOST}/audio/${n}.wav`,
    preview_url: `${MEDIA_HOST}/audio/${n}.wav`,
    cover_url: `${COVER_HOST}/covers/${n}.svg`,
    duration_seconds: 120 + (i * 7) % 120,
    bpm: 70 + (i * 13) % 100,
    key: KEYS[i % KEYS.length],
    scale: i % 3 === 0 ? 'major' : 'minor',
    rating: (i % 5) + 1,
    user_id: 'local-user',
    stems_status: null,
    notes: '',
    store_listed: true,
    store_sort_order: i,
    lease_price_usd: 20 + (i % 8) * 10,
    exclusive_price_usd: 250 + i * 5,
    free_download_enabled: i % 12 === 0,
    exclusive_sold: false,
  };
});

const trackTags = tracks.flatMap((t, i) => [
  { track_id: t.id, tag: GENRES[i % GENRES.length], category: 'genre' },
  { track_id: t.id, tag: MOODS[i % MOODS.length], category: 'mood' },
]);

const db = {
  ...base,
  tracks: [...base.tracks, ...tracks],
  track_tags: [...(base.track_tags ?? []), ...trackTags],
};

process.stdout.write(`${JSON.stringify(db, null, 2)}\n`);
