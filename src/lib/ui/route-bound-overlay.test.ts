import { describe, it, expect } from 'vitest';
import { routeBoundOverlay } from './route-bound-overlay';

describe('routeBoundOverlay', () => {
  it('is closed until opened', () => {
    expect(routeBoundOverlay(null, '/store/projects/p1')).toEqual({ open: false, openedOn: null });
  });

  it('is open on the route it was opened on', () => {
    expect(routeBoundOverlay('/store/projects/p1', '/store/projects/p1'))
      .toEqual({ open: true, openedOn: '/store/projects/p1' });
  });

  it('closes and forgets its route when browser Back changes the page', () => {
    expect(routeBoundOverlay('/store/projects/p1', '/store')).toEqual({ open: false, openedOn: null });
  });

  it('does not reappear when Forward returns to the route it was opened on', () => {
    // Back: the route moves, the caller writes back the cleared state.
    const afterBack = routeBoundOverlay('/store/producer/x', '/store/projects/p1');
    // Forward: the original route again, but nothing is remembered.
    expect(routeBoundOverlay(afterBack.openedOn, '/store/producer/x').open).toBe(false);
  });

  it('treats an unknown pathname as a different route', () => {
    expect(routeBoundOverlay('/store', null).open).toBe(false);
  });
});
