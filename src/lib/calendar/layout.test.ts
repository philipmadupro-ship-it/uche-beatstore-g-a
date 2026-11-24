import { describe, expect, it } from 'vitest';
import { dayKey, eventsOnDay, layoutWeek, laneCap, type LayoutEvent } from './layout';

// Sun 2026-11-15 … Sat 2026-11-21
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 15 + i));
const ev = (id: string, day: number, end?: number, hour = 9): LayoutEvent => ({
  id, title: `Event ${id}`, date: new Date(2026, 10, day, hour).toISOString(), end_date: end ? new Date(2026, 10, end, hour).toISOString() : null,
});

describe('layoutWeek', () => {
  it('puts same-day events in separate lanes in a stable order', () => {
    const a = layoutWeek(week, [ev('b', 16), ev('a', 16), ev('c', 16)], 5);
    expect(a.bars.map((b) => [b.event.id, b.lane])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    const b = layoutWeek(week, [ev('c', 16), ev('a', 16), ev('b', 16)], 5);
    expect(b.bars.map((x) => [x.event.id, x.lane])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('keeps a multi-day bar in one lane across the week and clips it at the week edge', () => {
    const w = layoutWeek(week, [ev('m', 13, 17), ev('x', 16)], 3);
    const m = w.bars.find((b) => b.event.id === 'm')!;
    expect([m.startCol, m.endCol, m.lane, m.continuesBefore, m.continuesAfter]).toEqual([0, 2, 0, true, false]);
    expect(w.bars.find((b) => b.event.id === 'x')!.lane).toBe(1);
  });

  it('ignores an end date before the start', () => {
    const w = layoutWeek(week, [ev('r', 18, 16)], 3);
    expect(w.bars).toHaveLength(1);
    expect([w.bars[0].startCol, w.bars[0].endCol]).toEqual([3, 3]);
  });

  it('has no overflow when everything fits', () => {
    const w = layoutWeek(week, [ev('a', 16), ev('b', 16), ev('c', 16)], 3);
    expect(w.overflow.every((n) => n === 0)).toBe(true);
    expect(w.bars).toHaveLength(3);
  });

  it('reserves the last row for the pill and counts what it hides', () => {
    const events = Array.from({ length: 15 }, (_, i) => ev(`e${String(i).padStart(2, '0')}`, 21));
    const w = layoutWeek(week, events, 3);
    expect(w.counts[6]).toBe(15);
    expect(w.visibleLanes[6]).toBe(2);
    expect(w.bars.filter((b) => b.startCol === 6)).toHaveLength(2);
    expect(w.overflow[6]).toBe(13); // 15 - 2 shown
    expect(w.overflow.slice(0, 6).every((n) => n === 0)).toBe(true);
  });

  it('counts a hidden multi-day event once on each day it covers', () => {
    const events = [ev('a', 16, 18), ev('b', 16, 18), ev('c', 16, 18)];
    const w = layoutWeek(week, events, 2);
    expect(w.overflow.slice(1, 4)).toEqual([2, 2, 2]);
    expect(w.bars.map((b) => b.event.id)).toEqual(['a']);
  });

  it('phone cap of 1: a lone event shows, a busy day shows only the pill', () => {
    const w = layoutWeek(week, [ev('solo', 15), ev('a', 17), ev('b', 17)], laneCap(true));
    expect(w.bars.map((b) => b.event.id)).toEqual(['solo']);
    expect(w.overflow[0]).toBe(0);
    expect(w.overflow[2]).toBe(2);
  });

  it('cuts a bar where a day needs the pill and marks the pieces as continuing', () => {
    const events = [ev('w', 15, 17), ev('long', 16, 21), ev('p', 17), ev('q', 17)];
    const w = layoutWeek(week, events, 2);
    const long = w.bars.filter((b) => b.event.id === 'long');
    expect(long.map((b) => [b.startCol, b.endCol])).toEqual([[1, 1], [3, 6]]);
    expect(long[0].continuesAfter).toBe(true);
    expect(long[1].continuesBefore).toBe(true);
    expect(w.overflow[2]).toBe(3);
  });
});

describe('eventsOnDay', () => {
  it('lists every event that covers the day, multi-day included', () => {
    const events = [ev('m', 14, 17), ev('a', 16, undefined, 10), ev('z', 20)];
    expect(eventsOnDay(events, new Date(2026, 10, 16)).map((e) => e.id)).toEqual(['m', 'a']);
    expect(eventsOnDay(events, new Date(2026, 10, 19))).toEqual([]);
  });
  it('dayKey is local and zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
