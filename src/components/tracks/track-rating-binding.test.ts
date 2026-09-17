import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guards what the star rating RENDERS from.
 *
 * `TrackCard` calls `useRating(track.id, track.rating || 0)` to get the
 * mutation, but for a long time it drew the stars from the `track.rating`
 * PROP. That is only correct for a parent whose data goes through React
 * Query, because the hook's `onSettled` invalidates `['tracks']` and the
 * parent re-renders with a fresh prop.
 *
 * The project and playlist pages fetch with plain `useState` + `fetch`. They
 * never observe that invalidate, so their `track` prop stayed stale forever:
 * clicking a star fired a POST that succeeded, the row did not change, and
 * the only reasonable conclusion for the user was "the stars don't work on
 * the project". Nothing catches this — the request is a 200, `tsc` is happy,
 * the build is green, and the library page (React Query) looks fine.
 *
 * The fix is to render from the hook's returned value, which carries the
 * optimistic write and falls back to the prop. This test pins that binding.
 *
 * Related: `useRating`'s own docstring records the same class of bug being
 * fixed twice already, which is why it is worth a guard rather than a comment.
 */

const FILE = 'src/components/tracks/TrackCard.tsx';

/** Source with comments removed, so prose about `track.rating` isn't a hit. */
function code(): string {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('TrackCard rating binding', () => {
  it('reads track.rating only to seed the hook', () => {
    const lines = code()
      .split('\n')
      .filter((l) => l.includes('track.rating'))
      .map((l) => l.trim());

    // The single legitimate use is the hook's `initial` argument.
    const strays = lines.filter((l) => !/useRating\(/.test(l));

    expect(
      strays,
      'These lines render or branch on the stale `track.rating` prop instead of '
      + 'the value returned by useRating(). Parents that fetch without React '
      + 'Query (the project and playlist pages) never refresh that prop, so the '
      + `stars will appear to do nothing there:\n${strays.join('\n')}`,
    ).toEqual([]);
  });

  it('destructures the hook value it renders from', () => {
    expect(code()).toMatch(/useRating\([^)]*\)/);
    expect(code()).toMatch(/rating:\s*currentRating/);
  });
});
