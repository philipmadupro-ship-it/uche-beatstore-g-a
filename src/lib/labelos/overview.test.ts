import { describe, expect, it } from 'vitest';
import { nextRelease, summarizeRoster, type OverviewInput } from './overview';

const a = (id: string, name = id) => ({ id, name, avatar_url: null });
const song = (id: string, stage: string | null) => ({ id, stage });

function input(over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    artists: [a('A'), a('B')],
    projectArtists: new Map([
      ['P1', ['A']],
      ['P2', ['B']],
      ['P3', ['A', 'B']],
    ]),
    placements: [
      { projectId: 'P1', trackId: 's1' },
      { projectId: 'P1', trackId: 's2' },
      { projectId: 'P2', trackId: 's3' },
      { projectId: 'P3', trackId: 's4' },
      { projectId: 'P1', trackId: 'loop1' },
    ],
    songs: [song('s1', 'inbox'), song('s2', 'in_development'), song('s3', 'selected'), song('s4', 'in_review'), song('s5', 'selected')],
    visibleSongIds: new Set(['s1', 's2', 's3', 's4']),
    releases: [],
    ...over,
  };
}

describe('summarizeRoster', () => {
  it('counts each artist\'s visible songs by stage and column', () => {
    const { artists } = summarizeRoster(input());
    const A = artists.find((x) => x.id === 'A')!;
    const B = artists.find((x) => x.id === 'B')!;
    // A: s1 inbox, s2 in_development, s4 (shared project) in_review
    expect(A.songs).toBe(3);
    expect(A.columns).toEqual({ demos: 2, development: 1, selected: 0 });
    // B: s3 selected, s4 shared
    expect(B.songs).toBe(2);
    expect(B.columns).toEqual({ demos: 1, development: 0, selected: 1 });
    expect(A.stages.map((s) => [s.stage, s.count])).toEqual([['inbox', 1], ['in_review', 1], ['in_development', 1]]);
  });

  it('ignores tracks that are not candidate songs (loops) and songs placed nowhere', () => {
    const { artists, totals } = summarizeRoster(input());
    expect(artists.reduce((n, x) => n + x.songs, 0)).toBe(5); // s4 counted for both
    expect(totals.songs).toBe(4); // distinct: s1..s4; s5 is placed in no project
  });

  it('counts a song the member may not see as restricted, never in the stage counts', () => {
    const { artists, totals } = summarizeRoster(input({ visibleSongIds: new Set(['s1', 's3', 's4']) }));
    const A = artists.find((x) => x.id === 'A')!;
    expect(A.songs).toBe(2);
    expect(A.restricted).toBe(1); // s2
    expect(A.columns.development).toBe(0);
    expect(totals.restricted).toBe(1);
    expect(JSON.stringify(artists)).not.toContain('s2');
  });

  it('shows only the artists it is given (scope is applied before, never after)', () => {
    const { artists, totals } = summarizeRoster(input({ artists: [a('A')] }));
    expect(artists.map((x) => x.id)).toEqual(['A']);
    // B's song s3 and B's out-of-scope count are nowhere in totals
    expect(totals.songs).toBe(3);
    expect(totals.stages.find((s) => s.stage === 'selected')).toBeUndefined();
  });

  it('totals: artists, distinct songs, stage counts', () => {
    const { totals } = summarizeRoster(input());
    expect(totals.artists).toBe(2);
    expect(totals.stages.map((s) => [s.stage, s.count])).toEqual([['inbox', 1], ['in_review', 1], ['in_development', 1], ['selected', 1]]);
  });

  it('an artist with nothing reads zero, not missing', () => {
    const { artists } = summarizeRoster(input({ artists: [a('Z')] }));
    expect(artists[0]).toMatchObject({ songs: 0, restricted: 0, columns: { demos: 0, development: 0, selected: 0 }, nextRelease: null });
  });

  it('a song with no known stage is in no count, so the headline equals the columns and stages', () => {
    const { artists, totals } = summarizeRoster(input({ songs: [song('s1', 'inbox'), song('s2', null), song('s3', 'bogus'), song('s4', 'selected')], visibleSongIds: new Set(['s1', 's2', 's3', 's4']) }));
    const A = artists.find((x) => x.id === 'A')!;
    expect(A.songs).toBe(A.stages.reduce((n, s) => n + s.count, 0));
    expect(totals.songs).toBe(totals.stages.reduce((n, s) => n + s.count, 0));
  });

  it('keeps the given artist order', () => {
    const { artists } = summarizeRoster(input({ artists: [a('B'), a('A')] }));
    expect(artists.map((x) => x.id)).toEqual(['B', 'A']);
  });

  it('attaches each artist\'s next release', () => {
    const { artists } = summarizeRoster(
      input({
        releases: [
          { id: 'r1', contactId: 'A', projectId: 'P1', title: 'EP', type: 'ep', state: 'draft', targetDate: '2027-03-01', createdAt: '2026-01-01' },
          { id: 'r2', contactId: 'B', projectId: 'P2', title: 'Old', type: 'single', state: 'delivered', targetDate: null, createdAt: '2026-01-01' },
        ],
      }),
    );
    expect(artists.find((x) => x.id === 'A')!.nextRelease).toMatchObject({ id: 'r1', title: 'EP', targetDate: '2027-03-01' });
    expect(artists.find((x) => x.id === 'B')!.nextRelease).toBeNull();
  });
});

describe('nextRelease', () => {
  const r = (id: string, state: string, targetDate: string | null, createdAt = '2026-01-01') => ({
    id, contactId: 'A', projectId: 'P', title: id, type: 'single', state, targetDate, createdAt,
  });
  it('is the earliest dated draft', () => {
    expect(nextRelease([r('late', 'draft', '2027-06-01'), r('soon', 'draft', '2027-01-01')])?.id).toBe('soon');
  });
  it('puts an undated draft after dated ones, oldest first', () => {
    expect(nextRelease([r('u2', 'draft', null, '2026-02-01'), r('u1', 'draft', null, '2026-01-01'), r('d', 'draft', '2027-01-01')])?.id).toBe('d');
    expect(nextRelease([r('u2', 'draft', null, '2026-02-01'), r('u1', 'draft', null, '2026-01-01')])?.id).toBe('u1');
  });
  it('skips delivered and cancelled', () => {
    expect(nextRelease([r('x', 'delivered', '2026-01-01'), r('y', 'cancelled', '2026-01-02')])).toBeNull();
  });
  it('is null with none', () => {
    expect(nextRelease([])).toBeNull();
  });
});
