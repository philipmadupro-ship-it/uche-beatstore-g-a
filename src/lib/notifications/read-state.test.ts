import { describe, expect, it } from 'vitest';
import { planMarkAllRead, planMarkRead, type ReadableNotification } from './read-state';

const list = (): ReadableNotification[] => [
  { id: 'a', read: false },
  { id: 'b', read: true },
  { id: 'c', read: false },
];

describe('planMarkRead', () => {
  it('flips only the row asked for', () => {
    const p = planMarkRead(list(), 2, ['a']);
    expect(p.next.map((n) => n.read)).toEqual([true, true, false]);
    expect(p.ids).toEqual(['a']);
  });

  it('decrements the badge by what was actually unread, not by ids passed', () => {
    // 'b' is already read — counting it would drop the badge to 0 while 'c'
    // is still unread.
    const p = planMarkRead(list(), 2, ['a', 'b']);
    expect(p.unread).toBe(1);
    expect(p.ids).toEqual(['a']);
  });

  it('is a no-op on an already-read row, so no request is made', () => {
    const p = planMarkRead(list(), 2, ['b']);
    expect(p.changed).toBe(false);
    expect(p.ids).toEqual([]);
    expect(p.unread).toBe(2);
  });

  it('returns the same array reference when nothing changed', () => {
    const l = list();
    expect(planMarkRead(l, 2, ['b']).next).toBe(l);
  });

  it('never drives the badge negative when the same row is clicked twice', () => {
    const first = planMarkRead(list(), 1, ['a']);
    const second = planMarkRead(first.next, first.unread, ['a']);
    expect(first.unread).toBe(0);
    expect(second.unread).toBe(0);
    expect(second.changed).toBe(false);
  });

  it('ignores ids that are not in the list at all', () => {
    const p = planMarkRead(list(), 2, ['nope']);
    expect(p.changed).toBe(false);
  });

  it('treats a null read column as unread', () => {
    const p = planMarkRead([{ id: 'a', read: null }], 1, ['a']);
    expect(p.changed).toBe(true);
    expect(p.unread).toBe(0);
  });

  it('does not mutate the input', () => {
    const l = list();
    planMarkRead(l, 2, ['a']);
    expect(l[0].read).toBe(false);
  });
});

describe('planMarkAllRead', () => {
  it('clears the badge and flips every unread row', () => {
    const p = planMarkAllRead(list(), 2);
    expect(p.unread).toBe(0);
    expect(p.next.every((n) => n.read)).toBe(true);
    expect(p.ids).toEqual(['a', 'c']);
  });

  it('is a no-op when everything is already read', () => {
    const p = planMarkAllRead([{ id: 'b', read: true }], 0);
    expect(p.changed).toBe(false);
  });
});
