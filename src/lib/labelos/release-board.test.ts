import { describe, expect, it } from 'vitest';
import { boardGates, boardStage, countByFilter, filterBoard, gateSummary, sortBoard, type BoardRelease } from './release-board';
import { RELEASE_GATES } from './release-readiness';

const r = (id: string, over: Partial<BoardRelease> = {}): BoardRelease => ({
  id, title: id, type: 'single', state: 'draft', artistId: 'a', artistName: 'Nova', targetDate: null, releaseDate: null,
  deliveredAt: null, deliveredTo: null, itemCount: 1, gates: [], readyToDeliver: false, createdAt: '2026-10-01T00:00:00Z', ...over,
});

describe('board stage', () => {
  it('is derived from state and readiness only', () => {
    expect(boardStage(r('a'))).toBe('in_progress');
    expect(boardStage(r('a', { readyToDeliver: true }))).toBe('ready');
    expect(boardStage(r('a', { state: 'delivered', readyToDeliver: true }))).toBe('delivered');
    expect(boardStage(r('a', { state: 'cancelled' }))).toBe('cancelled');
    expect(boardStage(r('a', { state: 'withdrawn' }))).toBe('withdrawn');
  });

  it('filters and counts by it', () => {
    const rows = [r('1'), r('2', { readyToDeliver: true }), r('3', { state: 'delivered' }), r('4', { state: 'cancelled' }), r('5'), r('6', { state: 'withdrawn' })];
    expect(countByFilter(rows)).toEqual({ all: 6, ready: 1, in_progress: 2, delivered: 1, withdrawn: 1, cancelled: 1 });
    expect(filterBoard(rows, 'in_progress').map((x) => x.id)).toEqual(['1', '5']);
    expect(filterBoard(rows, 'all')).toHaveLength(6);
  });
});

describe('sortBoard', () => {
  it('puts ready first, then in progress by nearest date (undated last), then delivered latest first, then withdrawn, then cancelled', () => {
    const rows = [
      r('cancelled', { state: 'cancelled' }),
      r('withdrawn', { state: 'withdrawn' }),
      r('delivered-old', { state: 'delivered', deliveredAt: '2026-09-01T00:00:00Z' }),
      r('later', { targetDate: '2026-12-01' }),
      r('undated'),
      r('soon', { targetDate: '2026-11-01' }),
      r('delivered-new', { state: 'delivered', deliveredAt: '2026-10-01T00:00:00Z' }),
      r('ready', { readyToDeliver: true, targetDate: '2026-12-31' }),
    ];
    expect(sortBoard(rows).map((x) => x.id)).toEqual(['ready', 'soon', 'later', 'undated', 'delivered-new', 'delivered-old', 'withdrawn', 'cancelled']);
  });

  it('does not mutate its input', () => {
    const rows = [r('b'), r('a', { readyToDeliver: true })];
    sortBoard(rows);
    expect(rows.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('gates', () => {
  it('summarises the open ones in words', () => {
    const view = Object.fromEntries(RELEASE_GATES.map((g, i) => [g, { status: i < 2 ? 'satisfied' : 'blocked', blockerCount: i < 2 ? 0 : 1 }])) as Parameters<typeof boardGates>[0];
    const gates = boardGates(view);
    expect(gates.map((g) => g.gate)).toEqual([...RELEASE_GATES]);
    expect(gateSummary(gates)).toBe('5 of 7 gates open');
    expect(gateSummary(gates.map((g) => ({ ...g, status: 'approved' as const })))).toBe('All gates satisfied');
    expect(gateSummary([])).toBe('');
  });
});
