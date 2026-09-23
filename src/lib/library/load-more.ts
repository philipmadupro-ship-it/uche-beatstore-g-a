/**
 * What the library's load-more footer says.
 *
 * The library pages 50 tracks at a time and filters in the browser over what
 * has loaded. With 633 tracks that meant a star filter silently searched 8%
 * of the catalogue, and reaching the end took a dozen clicks on a button that
 * never said how far there was to go. This decides the footer's copy and
 * whether it must warn that filters only cover the loaded tracks.
 */
export type LoadMoreState = {
  /** "150 of 633 tracks", or "150 tracks" when the total is unknown. */
  countLabel: string;
  /** 0–1 when the total is known, null otherwise. */
  progress: number | null;
  /** Filters are active and more tracks exist that they have not seen. */
  filtersPartial: boolean;
  remaining: number | null;
};

export function loadMoreState(input: {
  loaded: number;
  total: number | null;
  hasMore: boolean;
  filtersActive: boolean;
}): LoadMoreState {
  const { loaded, hasMore, filtersActive } = input;
  // A total smaller than what has loaded is stale (tracks uploaded since the
  // first page); never report "700 of 633".
  const total = input.total != null ? Math.max(input.total, loaded) : null;
  const noun = (n: number) => `track${n === 1 ? '' : 's'}`;
  return {
    countLabel: total != null ? `${loaded} of ${total} ${noun(total)}` : `${loaded} ${noun(loaded)}`,
    progress: total ? Math.min(1, loaded / total) : null,
    filtersPartial: filtersActive && hasMore,
    remaining: total != null ? Math.max(0, total - loaded) : null,
  };
}
