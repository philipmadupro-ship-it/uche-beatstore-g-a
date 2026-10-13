import { describe, expect, it } from 'vitest';
import { ATTENTION_DEFAULTS, parseAttentionSettings } from '@/lib/contracts';
import { attentionHref, compareAttention, computeAttention, daysSince, daysUntil, isStallableStage, type AttentionItem } from './attention';
import { ARTIST_A, ARTIST_B, CANONICAL_NOW, CANONICAL_RELEASES, CANONICAL_SONGS, CANONICAL_TASKS, P, canonicalInput } from './attention-fixture';

const run = (over = {}) => computeAttention(canonicalInput(over));
const ids = (items: AttentionItem[]) => items.map((i) => i.id);

describe('canonical scenario (03 Monday morning, 07 §2.1)', () => {
  it('yields exactly the three expected items, in order', () => {
    const { items, restricted } = run();
    expect(restricted).toBe(0);
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['release', 'EP 2027'],
      ['song', 'Track 04'],
      ['tasks', '2 overdue tasks'],
    ]);
  });

  it('the EP names its blocked gates with who clears them, and how far the date is', () => {
    const ep = run().items[0];
    expect(ep.artistName).toBe('Artist A');
    expect(ep.detail).toBe('Blocked: Legal (Dana), Artwork (Maya) · target in 23 days');
    expect(ep.person).toEqual(P.dana);
    expect(ep.people).toEqual([P.dana, P.maya]);
    expect(ep.action).toEqual({ verb: 'Unblock 2 gates', href: '/o/north-star/releases/60000000-0000-4000-8000-000000000001' });
  });

  it('Track 04 names the stage, the days and who last moved it', () => {
    const song = run().items[1];
    expect(song.detail).toBe('In development for 41 days');
    expect(song.person).toEqual(P.sam);
    expect(song.action).toEqual({ verb: 'Move it on', href: '/o/north-star/songs/50000000-0000-4000-8000-000000000004' });
  });

  it('the overdue tasks are one item for the person who holds them, opening the oldest', () => {
    const tasks = run().items[2];
    expect(tasks.person).toEqual(P.sam);
    expect(tasks.detail).toBe('Sam · oldest: Get Producer X IPI (5 days late)');
    expect(tasks.action).toEqual({ verb: 'Open the oldest', href: '/o/north-star/songs/50000000-0000-4000-8000-000000000004' });
  });

  it('every item names a person and one next action', () => {
    for (const i of run().items) {
      expect(i.person.name.trim()).not.toBe('');
      expect(i.action.verb.trim()).not.toBe('');
      expect(i.action.href).toMatch(/^\/o\/north-star(\/|$)/);
    }
  });
});

describe('thresholds', () => {
  const releaseOn = (date: string | null, state = 'draft') => [{ ...CANONICAL_RELEASES[0], targetDate: date, state }];
  const only = (over: object) => run({ releases: [], songs: [], tasks: [], ...over }).items;

  it('a blocked release is listed from exactly N days out and not one day earlier', () => {
    expect(only({ releases: releaseOn('2026-11-12') })).toHaveLength(1); // 30 days
    expect(only({ releases: releaseOn('2026-11-13') })).toHaveLength(0); // 31 days
  });

  it('a blocked release whose date is today or past is listed, and says so', () => {
    expect(only({ releases: releaseOn('2026-10-13') })[0].detail).toMatch(/target is today$/);
    const past = only({ releases: releaseOn('2026-10-10') })[0];
    expect(past.detail).toMatch(/target passed 3 days ago$/);
    expect(past.severity).toBeGreaterThan(only({ releases: releaseOn('2026-10-20') })[0].severity);
  });

  it('an undated, delivered or cancelled release is never listed', () => {
    expect(only({ releases: releaseOn(null) })).toHaveLength(0);
    expect(only({ releases: releaseOn('2026-10-20', 'delivered') })).toHaveLength(0);
    expect(only({ releases: releaseOn('2026-10-20', 'cancelled') })).toHaveLength(0);
  });

  it('a release with no blocker is not listed however close the date is', () => {
    expect(only({ releases: [{ ...CANONICAL_RELEASES[1], targetDate: '2026-10-13' }] })).toHaveLength(0);
  });

  it('a song is listed after MORE than N days, not at N', () => {
    const song = (since: string) => [{ ...CANONICAL_SONGS[0], since }];
    expect(only({ songs: song('2026-09-13T09:00:00Z') })).toHaveLength(0); // exactly 30 days
    expect(only({ songs: song('2026-09-12T09:00:01Z') })).toHaveLength(0); // 30 whole days and 23 h
    expect(only({ songs: song('2026-09-12T09:00:00Z') })).toHaveLength(1); // 31 days
  });

  it('only working stages can stall', () => {
    expect(['in_review', 'shortlisted', 'in_development'].every(isStallableStage)).toBe(true);
    expect(['inbox', 'selected', 'on_hold', 'passed', 'archived', null, 'x'].some(isStallableStage)).toBe(false);
  });

  it('a task is overdue once its day has passed, not while it is due today', () => {
    const t = (dueAt: string | null) => [{ ...CANONICAL_TASKS[0], dueAt }];
    expect(only({ tasks: t('2026-10-12T23:00:00Z') })).toHaveLength(1);
    expect(only({ tasks: t('2026-10-13T20:00:00Z') })).toHaveLength(0);
    expect(only({ tasks: t(null) })).toHaveLength(0);
  });

  it('thresholds come from the settings', () => {
    const tight = parseAttentionSettings({ attention_release_days: 22, attention_stalled_days: 45 });
    expect(ids(run({ settings: tight }).items)).toEqual(['tasks:' + P.sam.id]);
    const wide = parseAttentionSettings({ attention_release_days: 31, attention_stalled_days: 29 });
    const items = run({ settings: wide }).items;
    expect(items.filter((i) => i.kind === 'release').map((i) => i.title)).toEqual(['EP 2027', 'Album 2028']);
    expect(items.filter((i) => i.kind === 'song').map((i) => i.title)).toEqual(['Track 04', 'Track 05']);
  });
});

describe('who is accountable', () => {
  it('a gate nobody was asked for falls back to whoever runs the release', () => {
    const r = { ...CANONICAL_RELEASES[0], gates: CANONICAL_RELEASES[0].gates.map((g) => (g.gate === 'legal' ? { ...g, person: null } : g)) };
    const item = run({ releases: [r], songs: [], tasks: [] }).items[0];
    expect(item.detail).toContain('Legal (Pat)');
    expect(item.people.map((p) => p.name)).toEqual(['Maya', 'Pat']); // the one actually asked first
  });

  it('the artist is the last resort, never an empty name', () => {
    const r = { ...CANONICAL_RELEASES[0], owner: null, gates: CANONICAL_RELEASES[0].gates.map((g) => ({ ...g, person: null })) };
    const song = { ...CANONICAL_SONGS[0], person: null };
    const task = { ...CANONICAL_TASKS[0], assignee: null, creator: null };
    const { items } = run({ releases: [r], songs: [song], tasks: [task] });
    expect(items.map((i) => i.person.name)).toEqual(['Artist A', 'Artist A', 'Nobody']);
  });

  it('tasks group per person, so two people are two items', () => {
    const t = [CANONICAL_TASKS[0], { ...CANONICAL_TASKS[1], assignee: P.maya }];
    const items = run({ releases: [], songs: [], tasks: t }).items;
    expect(items.map((i) => [i.person.name, i.title]).sort()).toEqual([
      ['Maya', '1 overdue task'],
      ['Sam', '1 overdue task'],
    ]);
  });
});

describe('order', () => {
  it('is severity, then due date, then id, and does not depend on input order', () => {
    const a = run();
    const b = computeAttention(canonicalInput({ releases: [...CANONICAL_RELEASES].reverse(), songs: [...CANONICAL_SONGS].reverse(), tasks: [...CANONICAL_TASKS].reverse() }));
    expect(ids(b.items)).toEqual(ids(a.items));
  });

  it('a release past its date comes first, then by date, undated last, ties by id', () => {
    const mk = (id: string, severity: number, dueDate: string | null) => ({ id, severity, dueDate }) as AttentionItem;
    const sorted = [mk('b', 2, '2026-11-01'), mk('a', 2, '2026-11-01'), mk('z', 2, null), mk('c', 3, '2026-12-01'), mk('d', 2, '2026-10-30')].sort(compareAttention);
    expect(sorted.map((i) => i.id)).toEqual(['c', 'd', 'a', 'b', 'z']);
  });
});

describe('scope and D4', () => {
  it('a member scoped to Artist B sees only Artist B’s items', () => {
    const items = run({ artistScope: new Set([ARTIST_B]), tasks: [] }).items;
    expect(items).toEqual([]); // B has nothing inside both thresholds
    const wide = run({ artistScope: new Set([ARTIST_B]), tasks: [], settings: parseAttentionSettings({ attention_release_days: 31 }) }).items;
    expect(wide.map((i) => i.title)).toEqual(['Album 2028']);
  });

  it('a member scoped to Artist A sees the EP and Track 04, not another artist’s', () => {
    expect(run({ artistScope: new Set([ARTIST_A]) }).items.map((i) => i.title)).toEqual(['EP 2027', 'Track 04', '2 overdue tasks']);
    expect(run({ artistScope: new Set() }).items.filter((i) => i.kind !== 'tasks')).toEqual([]);
  });

  it('a stalled song the member may not read is a number, never a title', () => {
    const { items, restricted } = run({ songs: [{ ...CANONICAL_SONGS[0], readable: false }] });
    expect(restricted).toBe(1);
    expect(JSON.stringify(items)).not.toContain('Track 04');
    expect(items.some((i) => i.kind === 'song')).toBe(false);
  });

  it('a restricted song outside the member’s scope is not even counted', () => {
    expect(run({ songs: [{ ...CANONICAL_SONGS[0], readable: false }], artistScope: new Set([ARTIST_B]) }).restricted).toBe(0);
  });
});

describe('settings', () => {
  it('defaults are total', () => {
    expect(parseAttentionSettings(undefined)).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings(null)).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings('x')).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings([1, 2])).toEqual(ATTENTION_DEFAULTS);
  });

  it('malformed values read as the default, valid ones are kept, unknown keys dropped', () => {
    expect(parseAttentionSettings({ attention_release_days: '7', attention_stalled_days: 0 })).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings({ attention_release_days: 1.5, attention_stalled_days: 400 })).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings({ attention_release_days: -3, attention_stalled_days: null })).toEqual(ATTENTION_DEFAULTS);
    expect(parseAttentionSettings({ attention_release_days: 7, attention_stalled_days: 365, legal_gate: 'off' })).toEqual({ attention_release_days: 7, attention_stalled_days: 365 });
  });
});

describe('date helpers', () => {
  it('count whole UTC days', () => {
    expect(daysUntil('2026-11-05', CANONICAL_NOW)).toBe(23);
    expect(daysUntil('2026-10-12', CANONICAL_NOW)).toBe(-1);
    expect(daysUntil('nope', CANONICAL_NOW)).toBeNaN();
    expect(daysUntil(null, CANONICAL_NOW)).toBeNaN();
    expect(daysSince('2026-09-02T08:00:00Z', CANONICAL_NOW)).toBe(41);
    expect(daysSince('garbage', CANONICAL_NOW)).toBeNaN();
    expect(daysSince('2027-01-01T00:00:00Z', CANONICAL_NOW)).toBe(0);
  });

  it('links', () => {
    expect(attentionHref('a b', { kind: 'tasks', id: 'x' })).toBe('/o/a%20b');
  });
});
