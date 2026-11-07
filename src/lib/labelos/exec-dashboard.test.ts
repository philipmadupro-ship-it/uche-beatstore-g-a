import { describe, expect, it } from 'vitest';
import type { BoardRelease } from './release-board';
import { blockedReleases, departmentOf, execCsv, execFileName, monthOf, pipelineCounts, releasesByMonth, taskLoadByDepartment, topSongsByGross, waitingApprovals, type ExecView } from './exec-dashboard';

const rel = (o: Partial<BoardRelease>): BoardRelease => ({
  id: 'r', title: 'T', type: 'ep', state: 'draft', artistId: 'a', artistName: 'Nova', targetDate: null, releaseDate: null, deliveredAt: null, deliveredTo: null, itemCount: 1, gates: [], readyToDeliver: false, createdAt: '', ...o,
});
const g = (gate: string, status: string) => ({ gate: gate as never, status: status as never, blockerCount: 0 });

describe('pipelineCounts', () => {
  it('counts every known stage (zero included) and treats a null stage as inbox', () => {
    const p = pipelineCounts([{ stage: 'selected' }, { stage: 'selected' }, { stage: null }]);
    expect(p.find((x) => x.stage === 'selected')?.count).toBe(2);
    expect(p.find((x) => x.stage === 'inbox')?.count).toBe(1);
    expect(p.find((x) => x.stage === 'passed')?.count).toBe(0);
  });
  it('keeps an unknown stage instead of dropping it', () => {
    expect(pipelineCounts([{ stage: 'weird' }]).at(-1)).toEqual({ stage: 'weird', count: 1 });
  });
});

describe('releasesByMonth', () => {
  it('buckets by release date, else target date, in month order; undated, cancelled and withdrawn are left out', () => {
    const rows = releasesByMonth([
      rel({ id: '1', targetDate: '2026-05-02' }),
      rel({ id: '2', releaseDate: '2026-04-30', targetDate: '2026-06-01', state: 'delivered' }),
      rel({ id: '3', targetDate: '2026-04-01', readyToDeliver: true }),
      rel({ id: '4' }),
      rel({ id: '5', targetDate: '2026-04-01', state: 'cancelled' }),
      rel({ id: '6', targetDate: '2026-04-01', state: 'withdrawn' }),
    ]);
    expect(rows).toEqual([
      { month: '2026-04', ready: 1, inProgress: 0, delivered: 1, total: 2 },
      { month: '2026-05', ready: 0, inProgress: 1, delivered: 0, total: 1 },
    ]);
  });
  it('monthOf ignores malformed dates', () => {
    expect(monthOf({ releaseDate: 'soon', targetDate: null, deliveredAt: null })).toBeNull();
  });
});

describe('blocked and waiting', () => {
  const list = [
    rel({ id: 'b', title: 'Late', targetDate: '2026-06-01', gates: [g('masters', 'blocked')] }),
    rel({ id: 'a', title: 'Soon', targetDate: '2026-05-01', gates: [g('legal', 'blocked'), g('artwork', 'awaiting_approval')] }),
    rel({ id: 'c', title: 'Out', state: 'delivered', gates: [g('legal', 'blocked')] }),
    rel({ id: 'd', title: 'Fine', gates: [g('legal', 'approved')] }),
  ];
  it('blocked: drafts only, nearest date first, naming the gates', () => {
    expect(blockedReleases(list).map((b) => [b.title, b.gates])).toEqual([['Soon', ['legal']], ['Late', ['masters']]]);
  });
  it('waiting: drafts with a gate awaiting approval', () => {
    expect(waitingApprovals(list).map((w) => [w.title, w.gates])).toEqual([['Soon', ['artwork']]]);
  });
});

describe('task load by department', () => {
  const members = [
    { userId: 'U1', role: 'member', functions: ['finance'] },
    { userId: 'U2', role: 'owner', functions: [] },
    { userId: 'U3', role: 'member', functions: ['marketing', 'a_and_r'] },
  ];
  it('maps people to one department, counts open and overdue, and sorts by load', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const rows = taskLoadByDepartment(
      [
        { assigneeId: 'u1', dueAt: '2026-01-01T00:00:00Z' },
        { assigneeId: 'U1', dueAt: null },
        { assigneeId: 'U2', dueAt: null },
        { assigneeId: 'U3', dueAt: '2999-01-01T00:00:00Z' },
        { assigneeId: null, dueAt: null },
        { assigneeId: 'gone', dueAt: null },
      ],
      members,
      now,
    );
    expect(rows).toEqual([
      { department: 'Finance', open: 2, overdue: 1 },
      { department: 'Unassigned', open: 2, overdue: 0 },
      { department: 'A&R', open: 1, overdue: 0 }, // first in the canonical function order
      { department: 'Management', open: 1, overdue: 0 },
    ]);
  });
  it('departmentOf', () => {
    expect(departmentOf({ role: 'admin', functions: [] })).toBe('Management');
    expect(departmentOf({ role: 'member', functions: [] })).toBe('No department');
    expect(departmentOf(undefined)).toBe('Unassigned');
  });
});

describe('topSongsByGross', () => {
  const songs = new Map([['s1', { title: 'One', artistName: 'Nova' }], ['s2', { title: 'Two', artistName: null }]]);
  it('sums per song and currency, ranks, and leaves out songs the viewer cannot open', () => {
    const top = topSongsByGross(
      [
        { song_track_id: 's1', gross_minor: BigInt(100), currency: 'USD' },
        { song_track_id: 's1', gross_minor: BigInt(50), currency: 'USD' },
        { song_track_id: 's2', gross_minor: BigInt(120), currency: 'USD' },
        { song_track_id: 'hidden', gross_minor: BigInt(9999), currency: 'USD' },
        { song_track_id: null, gross_minor: BigInt(9999), currency: 'USD' },
      ],
      songs,
    );
    expect(top.map((s) => [s.id, s.gross])).toEqual([['s1', '150'], ['s2', '120']]);
  });
  it('honours the limit', () => {
    const lines = ['s1', 's2'].map((id, i) => ({ song_track_id: id, gross_minor: BigInt(i + 1), currency: 'USD' }));
    expect(topSongsByGross(lines, songs, 1)).toHaveLength(1);
  });
});

describe('execCsv', () => {
  const view: ExecView = {
    schemaReady: true, scoped: false, withheld: [],
    pipeline: [{ stage: 'inbox', count: 2 }],
    months: [{ month: '2026-04', ready: 0, inProgress: 1, delivered: 0, total: 1 }],
    blocked: [{ id: 'r', title: '=cmd|"x"', artistName: '+evil', date: '2026-04-01', gates: ['masters'] }],
    waiting: [],
    tasks: [{ department: '@Finance', open: 2, overdue: 1 }],
    money: [{ currency: 'USD', income: '1000', royalties: '10', spent: '300', margin: '-50', unrecouped: '0' }],
    topSongs: [{ id: 's', title: '-1+1', artistName: null, currency: 'USD', gross: '700' }],
  };
  it('guards every text cell against formulas, doubles quotes, and leaves amounts numeric (a negative margin included)', () => {
    const csv = execCsv(view);
    expect(csv).toContain(`"'=cmd|""x"""`);
    expect(csv).toContain(`"'@Finance"`);
    expect(csv).toContain(`"'-1+1"`);
    expect(csv).toContain(`"margin","Margin","","","-50","USD"`);
    for (const line of csv.trim().split('\r\n')) expect(line).not.toMatch(/(^|,)"[=+@]/);
  });
  it('omits the withheld sections', () => {
    const csv = execCsv({ ...view, tasks: null, money: null, topSongs: null });
    expect(csv).not.toContain('income');
    expect(csv).not.toContain('Finance');
    expect(csv).not.toContain('top_song');
  });
  it('file name is safe', () => {
    expect(execFileName('a/b c', new Date('2026-06-01T10:00:00Z'))).toBe('a-b-c-executive-2026-06-01.csv');
  });
});
