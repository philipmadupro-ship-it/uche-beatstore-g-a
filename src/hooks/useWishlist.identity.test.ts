// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/buyer-session', () => ({ toggleFavorite: vi.fn() }));

import { useWishlist, useWishlistStore } from './useWishlist';

/**
 * `/store` keys its catalogue filter on `wishlist.ids`, and preview prefetch
 * on that filter's output. A new Set per render meant both re-ran on EVERY
 * render, which at 60+ beats prefetched the whole catalogue during ordinary
 * playback (e2e/storefront-scale.spec.ts measured 64 audio fetches for 5 plays).
 */
describe('useWishlist identity', () => {
  beforeEach(() => { useWishlistStore.setState({ ids: [] }); });

  it('returns the same ids Set and has() across renders while nothing changes', () => {
    const { result, rerender } = renderHook(() => useWishlist());
    const first = result.current;
    rerender();
    expect(result.current.ids).toBe(first.ids);
    expect(result.current.has).toBe(first.has);
  });

  it('returns a new Set when the saved list changes', () => {
    const { result } = renderHook(() => useWishlist());
    const before = result.current.ids;
    act(() => { result.current.toggle('beat-1'); });
    expect(result.current.ids).not.toBe(before);
    expect(result.current.has('beat-1')).toBe(true);
  });
});
