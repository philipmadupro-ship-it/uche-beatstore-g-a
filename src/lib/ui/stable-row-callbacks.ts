/**
 * Stable per-row callback cache.
 *
 * Every list row in this app (`TrackCard`, `TrackGridCard`, `BeatCard`,
 * `BeatListRow`) is invoked from a `.map()` in its parent page with callback
 * props built as fresh arrow functions on every render —
 * `onPlayClick={() => playTrack(t)}`, `onPreview={() => setPreviewTrack(...)}`.
 * `React.memo` on the row does nothing against that: a new function
 * reference fails the shallow prop comparison every time, so every row still
 * re-renders on any unrelated parent state change (selecting a different
 * row, toggling one wishlist heart, a poll tick). See CLAUDE.md "Be careful
 * with memoisation" for the exact failure mode this closes.
 *
 * `RowCallbackCache` hands back the SAME function for the SAME row/slot pair
 * across renders, as long as the row's own data object hasn't changed
 * identity — the common case, since the underlying array element keeps its
 * reference across an unrelated re-render unless that row was actually
 * refetched or edited. When the row's data object DOES change, the cache
 * rebuilds just that row's closure, so a stale row never fires a callback
 * with outdated data.
 *
 * Kept generic and framework-free (no React import) so it is Vitest-testable
 * in the default `node` environment, per the "pure logic in lib/" rule.
 */
export class RowCallbackCache<T> {
  private rows = new Map<string, Map<string, { input: T; fn: (...args: never[]) => void }>>();

  /**
   * Returns a stable callback for `id`/`slot`, rebuilding it only when
   * `input` is a different object than the one last used to build it for
   * that slot. `slot` distinguishes multiple callback families built from
   * one cache instance for the same row (e.g. "play" vs "preview").
   */
  get<Fn extends (...args: never[]) => void>(
    id: string,
    slot: string,
    input: T,
    make: (input: T) => Fn,
  ): Fn {
    let slots = this.rows.get(id);
    if (!slots) {
      slots = new Map();
      this.rows.set(id, slots);
    }
    const existing = slots.get(slot);
    if (existing && existing.input === input) return existing.fn as Fn;
    const fn = make(input);
    slots.set(slot, { input, fn: fn as (...args: never[]) => void });
    return fn;
  }

  /**
   * Drops cached closures for ids no longer present, so the cache doesn't
   * grow forever across refetches on a long-lived page (the store's
   * unbounded "load more" append is exactly this kind of long-lived list).
   */
  prune(liveIds: Iterable<string>): void {
    const live = new Set(liveIds);
    for (const id of this.rows.keys()) {
      if (!live.has(id)) this.rows.delete(id);
    }
  }

  /** Number of rows currently holding cached closures. Test/diagnostic hook. */
  get size(): number {
    return this.rows.size;
  }
}
