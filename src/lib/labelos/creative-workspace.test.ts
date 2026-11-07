import { describe, expect, it } from 'vitest';
import {
  buildArtistCards,
  clip,
  creativeOpen,
  creativeStatusWord,
  directionBrief,
  sortCreativeReleases,
  tallyStages,
  workspaceTotals,
  type ArtistCardInput,
  type CreativeReleaseInput,
} from './creative-workspace';

const card = (over: Partial<ArtistCardInput> & { id: string; name: string }): ArtistCardInput => ({
  avatarUrl: null, direction: null, references: 0, stages: tallyStages([]), waiting: 0, reviewed: null, draftReleases: 0, creativeOpen: 0, ...over,
});
const rel = (over: Partial<CreativeReleaseInput> & { id: string }): CreativeReleaseInput => ({
  title: over.id, state: 'draft', artistId: null, artistName: null, targetDate: null, releaseDate: null, createdAt: '2026-10-01T00:00:00Z', creative: null, ...over,
});

describe('clip', () => {
  it('leaves short text, collapses whitespace and cuts long text on a word with an ellipsis, never past the limit', () => {
    expect(clip('  warm   drums ')).toBe('warm drums');
    const long = 'dusty drums and a lot of air '.repeat(20);
    const out = clip(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});

describe('directionBrief', () => {
  it('is total: anything that is not a direction reads as an empty one', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}]) expect(directionBrief(raw)).toEqual({ sound: null, next: null, keywords: [], filled: 0, total: 6 });
  });
  it('shows the sound, the next move and up to six keywords, and counts the filled fields; unknown keys are dropped', () => {
    const b = directionBrief({ sound: 'Warm', lyrics: 'Night', visual: ' ', next: 'EP', keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], bogus: 'x' });
    expect(b).toMatchObject({ sound: 'Warm', next: 'EP', filled: 3, total: 6 });
    expect(b.keywords).toHaveLength(6);
    expect(JSON.stringify(b)).not.toContain('bogus');
  });
});

describe('tallyStages', () => {
  it('counts known stages only, and null / unknown stages are not songs of the pipeline', () => {
    expect(tallyStages(['inbox', 'inbox', 'selected', null, 'nonsense', undefined])).toEqual({ total: 3, byStage: { inbox: 2, selected: 1 } });
    expect(tallyStages([])).toEqual({ total: 0, byStage: {} });
  });
});

describe('buildArtistCards', () => {
  it('puts creative work first (open approvals, then songs waiting), then artists with no direction, then by name', () => {
    const cards = buildArtistCards([
      card({ id: 'a', name: 'Zed', direction: { sound: 'x' } }),
      card({ id: 'b', name: 'Amy', direction: { sound: 'x' } }),
      card({ id: 'c', name: 'Moe' }),
      card({ id: 'd', name: 'Kay', waiting: 2, direction: { sound: 'x' } }),
      card({ id: 'e', name: 'Lou', creativeOpen: 1, direction: { sound: 'x' } }),
    ]);
    expect(cards.map((c) => c.name)).toEqual(['Lou', 'Kay', 'Moe', 'Amy', 'Zed']);
  });
  it('never carries the stored direction document: only the brief', () => {
    const [c] = buildArtistCards([card({ id: 'a', name: 'A', direction: { sound: 'Warm', secret: 'x' } })]);
    expect('direction' in c).toBe(false);
    expect(JSON.stringify(c)).not.toContain('secret');
    expect(c.brief.sound).toBe('Warm');
  });
  it('is stable for equal cards (ties break on name, then id)', () => {
    const once = buildArtistCards([card({ id: '2', name: 'Same' }), card({ id: '1', name: 'Same' })]).map((c) => c.id);
    expect(once).toEqual(['1', '2']);
  });
});

describe('creative status of a release', () => {
  it('is open unless approved and current; no status (gate off) is never open', () => {
    expect(creativeOpen(null)).toBe(false);
    expect(creativeOpen({ status: 'approved', stale: false })).toBe(false);
    expect(creativeOpen({ status: 'approved', stale: true })).toBe(true);
    for (const status of ['not_started', 'awaiting_approval', 'blocked', 'stale'] as const) expect(creativeOpen({ status, stale: false }), status).toBe(true);
    expect(creativeOpen({ status: 'not_required', stale: false })).toBe(false);
  });
  it('says it in words, and a stale approval says so whatever its status', () => {
    expect(creativeStatusWord({ status: 'awaiting_approval', stale: false })).toBe('Awaiting creative approval');
    expect(creativeStatusWord({ status: 'approved', stale: false })).toBe('Creatively approved');
    expect(creativeStatusWord({ status: 'approved', stale: true })).toBe('Changed since approved');
  });
  it('sorts what needs the creative team first, then by date, undated last, ties newest then id', () => {
    const sorted = sortCreativeReleases([
      rel({ id: 'done', creative: { status: 'approved', stale: false }, targetDate: '2026-11-01' }),
      rel({ id: 'none', creative: null, targetDate: '2026-10-01' }),
      rel({ id: 'asked-late', creative: { status: 'awaiting_approval', stale: false }, targetDate: '2026-12-01' }),
      rel({ id: 'asked-early', creative: { status: 'awaiting_approval', stale: false }, targetDate: '2026-11-15' }),
      rel({ id: 'asked-undated', creative: { status: 'awaiting_approval', stale: false } }),
      rel({ id: 'not-started', creative: { status: 'not_started', stale: false } }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['asked-early', 'asked-late', 'asked-undated', 'not-started', 'done', 'none']);
  });
  it('does not mutate its input', () => {
    const input = [rel({ id: 'b' }), rel({ id: 'a' })];
    sortCreativeReleases(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('workspaceTotals', () => {
  it('counts the artists, the ones with a direction, the songs waiting and the open creative approvals', () => {
    const artists = buildArtistCards([card({ id: 'a', name: 'A', direction: { sound: 'x' }, waiting: 2 }), card({ id: 'b', name: 'B', waiting: 1 })]);
    const releases = sortCreativeReleases([rel({ id: 'r1', creative: { status: 'not_started', stale: false } }), rel({ id: 'r2', creative: { status: 'approved', stale: false } }), rel({ id: 'r3' })]);
    expect(workspaceTotals(artists, releases)).toEqual({ artists: 2, withDirection: 1, songsWaiting: 3, creativeOpen: 1 });
  });
});
