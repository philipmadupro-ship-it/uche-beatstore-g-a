import { describe, it, expect } from 'vitest';
import {
  enqueueToast,
  dismissToast,
  isSameToast,
  defaultDuration,
  MAX_VISIBLE_TOASTS,
  type QueuedToast,
} from './toast-queue';

/**
 * The store previously appended every push unconditionally, with 333 call
 * sites across the app. A batch reporting per-item failures stacked one card
 * per item; a retry loop rendered the same message five times.
 */

const t = (over: Partial<Omit<QueuedToast, 'count'>> = {}): Omit<QueuedToast, 'count'> => ({
  id: Math.random().toString(36).slice(2),
  kind: 'info',
  title: 'Saved',
  duration: 3500,
  ...over,
});

describe('defaultDuration', () => {
  it('gives errors longer, since they usually need reading twice', () => {
    expect(defaultDuration('error')).toBeGreaterThan(defaultDuration('success'));
  });
});

describe('isSameToast', () => {
  it('matches on what a user can actually see', () => {
    expect(isSameToast(
      { kind: 'error', title: 'Failed', description: 'x' },
      { kind: 'error', title: 'Failed', description: 'x' },
    )).toBe(true);
  });

  it('treats a missing description and an empty one as the same', () => {
    expect(isSameToast({ kind: 'info', title: 'A' }, { kind: 'info', title: 'A', description: '' }))
      .toBe(true);
  });

  it('separates different kinds with the same words', () => {
    // "Upload complete" as success and as warning mean different things.
    expect(isSameToast({ kind: 'success', title: 'Done' }, { kind: 'warning', title: 'Done' }))
      .toBe(false);
  });
});

describe('enqueueToast', () => {
  it('appends a new toast', () => {
    const { queue } = enqueueToast([], t({ title: 'One' }));
    expect(queue).toHaveLength(1);
    expect(queue[0].count).toBe(1);
  });

  it('collapses a repeat into a count instead of a second card', () => {
    // Five identical "Could not save" cards convey nothing one card and a
    // count would not.
    let queue: QueuedToast[] = [];
    for (let i = 0; i < 5; i++) {
      queue = enqueueToast(queue, t({ kind: 'error', title: 'Could not save' })).queue;
    }
    expect(queue).toHaveLength(1);
    expect(queue[0].count).toBe(5);
  });

  it('returns the EXISTING id when deduping, so a held id still dismisses', () => {
    const first = enqueueToast([], t({ id: 'first', title: 'Same' }));
    const second = enqueueToast(first.queue, t({ id: 'second', title: 'Same' }));
    expect(second.deduped).toBe(true);
    expect(second.id).toBe('first');
    expect(dismissToast(second.queue, second.id)).toHaveLength(0);
  });

  it('moves a repeat to the end so it reads as the most recent event', () => {
    let queue = enqueueToast([], t({ title: 'Old' })).queue;
    queue = enqueueToast(queue, t({ title: 'Newer' })).queue;
    queue = enqueueToast(queue, t({ title: 'Old' })).queue;
    expect(queue.map((x) => x.title)).toEqual(['Newer', 'Old']);
    expect(queue[1].count).toBe(2);
  });

  it('caps the stack so a batch cannot cover the screen', () => {
    let queue: QueuedToast[] = [];
    for (let i = 0; i < 20; i++) {
      queue = enqueueToast(queue, t({ title: `Failure ${i}` })).queue;
    }
    expect(queue).toHaveLength(MAX_VISIBLE_TOASTS);
  });

  it('drops the oldest, keeping what just happened', () => {
    // The newest card describes the event the user is reacting to; the oldest
    // has already been on screen longest.
    let queue: QueuedToast[] = [];
    for (let i = 0; i < 6; i++) {
      queue = enqueueToast(queue, t({ title: `T${i}` })).queue;
    }
    expect(queue.map((x) => x.title)).toEqual(['T2', 'T3', 'T4', 'T5']);
  });

  it('respects a custom cap', () => {
    let queue: QueuedToast[] = [];
    for (let i = 0; i < 5; i++) {
      queue = enqueueToast(queue, t({ title: `T${i}` }), 2).queue;
    }
    expect(queue).toHaveLength(2);
  });

  it('does not let deduplication push the queue over capacity', () => {
    let queue: QueuedToast[] = [];
    for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) {
      queue = enqueueToast(queue, t({ title: `T${i}` })).queue;
    }
    queue = enqueueToast(queue, t({ title: 'T0' })).queue;
    expect(queue.length).toBeLessThanOrEqual(MAX_VISIBLE_TOASTS);
  });
});

describe('dismissToast', () => {
  it('removes only the named toast', () => {
    const a = enqueueToast([], t({ id: 'a', title: 'A' }));
    const b = enqueueToast(a.queue, t({ id: 'b', title: 'B' }));
    expect(dismissToast(b.queue, 'a').map((x) => x.id)).toEqual(['b']);
  });

  it('is a no-op for an unknown id', () => {
    const { queue } = enqueueToast([], t({ id: 'a' }));
    expect(dismissToast(queue, 'nope')).toHaveLength(1);
  });
});
