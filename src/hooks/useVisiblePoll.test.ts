// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisiblePoll } from './useVisiblePoll';

let state: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  state = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
});
afterEach(() => vi.useRealTimers());

function setVisibility(v: DocumentVisibilityState) {
  state = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisiblePoll', () => {
  it('polls only while visible and catches up on return', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useVisiblePoll(fn, 1000));
    vi.advanceTimersByTime(2500);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(3);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does nothing when disabled', () => {
    const fn = vi.fn();
    renderHook(() => useVisiblePoll(fn, 1000, false));
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
