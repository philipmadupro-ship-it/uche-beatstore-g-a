// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { memo, useCallback, useRef, useState } from 'react';
import { TrackCard } from './TrackCard';
import { RowCallbackCache } from '@/lib/ui/stable-row-callbacks';
import type { Track } from '@/lib/types';

/**
 * Render-side scale test for the dashboard library's row component.
 *
 * Nobody had measured list *rendering* in this app before this file — the
 * existing `test:scale` suite (`catalog-scale.test.ts`) only measures API
 * payload size and latency. Meanwhile, per CLAUDE.md: zero components in
 * this codebase were memoised, and `TrackCard` is unmemoised, ~700 lines,
 * and carries per-row store subscriptions (offline status, session-fit
 * markers). Every page that lists tracks (`/library`, `/store`) also rebuilt
 * every row's callback props as fresh arrow functions on every render
 * (`onClickDetails={(t) => setSelectedTrack(t)}`), so a single unrelated
 * state change — selecting a different row, a poll tick — re-rendered every
 * visible row.
 *
 * This file measures the two things that are meaningful and STABLE in
 * jsdom, per the task brief: DOM node count, and number of row re-renders on
 * a state change — never wall-clock, which flakes in CI.
 *
 * Render counting deliberately does NOT use `React.Profiler`: an early
 * version of this test wrapped each row in `<Profiler onRender={...}>` and
 * found `onRender` fires for every row on every commit REGARDLESS of
 * whether the memoised child actually bailed out — Profiler measures "did a
 * commit touch this part of the tree", not "did this component's function
 * body run". A debug harness confirmed a trivially memoised dummy component
 * still reported 100% of rows "re-rendering" under Profiler even with
 * fully stable props. Instead, each row is wrapped in a locally-defined
 * `memo`'d counter component that increments a plain counter IN ITS OWN
 * function body — that body provably does not execute when `memo` bails,
 * because bailing is exactly "React never calls the function again".
 *
 * `ROW_COUNT = 200`: bigger than one page of the library (50) or one "load
 * more" press on the store (80), representative of a producer a few pages/
 * presses into a large catalogue, while staying fast enough in jsdom that
 * this file can live in the default `vitest run` suite as well as
 * `test:scale` — every row here mounts the SAME hook tree TrackCard mounts
 * in production (usePlayer, useRating, useOfflineTrack, useSessionContext),
 * not a lightweight stand-in.
 */
const ROW_COUNT = 200;

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `scale-track-${i}`,
    user_id: 'user-1',
    title: `Scale Beat ${String(i + 1).padStart(3, '0')}`,
    type: 'beat',
    audio_url: `r2://bucket/scale/${i}.wav`,
    duration_seconds: 120 + (i % 180),
    bpm: 80 + (i % 100),
    key: ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7],
    scale: i % 2 ? 'minor' : 'major',
    stems_status: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
  })) as Track[];
}

/**
 * Builds a `memo`'d wrapper around `TrackCard` that increments `counts[id]`
 * in its OWN render body before delegating. Since the wrapper receives
 * exactly the props the list passes through, `memo`'s default shallow
 * comparison bails it under precisely the same conditions it would bail
 * `TrackCard` itself — so "did this wrapper's body run" is a faithful proxy
 * for "did TrackCard re-render", without relying on Profiler's coarser
 * commit-level signal.
 */
function makeCountingTrackCard(counts: Map<string, number>) {
  return memo(function CountingTrackCard({
    rowId,
    ...trackCardProps
  }: { rowId: string } & React.ComponentProps<typeof TrackCard>) {
    counts.set(rowId, (counts.get(rowId) ?? 0) + 1);
    return <TrackCard {...trackCardProps} />;
  });
}

function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Reproduces the library page's PRE-FIX pattern: a fresh arrow function
 * built inline in the `.map()` for every row, every render. Included so the
 * "memoising the child is a no-op without stable props" failure mode
 * (CLAUDE.md, "Be careful with memoisation") is asserted, not assumed.
 */
function UnstableList({ tracks, Row }: { tracks: Track[]; Row: ReturnType<typeof makeCountingTrackCard> }) {
  const [, setBump] = useState(0);
  return (
    <div>
      <button type="button" data-testid="bump" onClick={() => setBump((b) => b + 1)}>
        bump
      </button>
      {tracks.map((t, i) => (
        <Row
          key={t.id}
          rowId={`row-${i}`}
          track={t}
          index={i}
          onClickDetails={() => {}}
          onSelectChange={() => {}}
        />
      ))}
    </div>
  );
}

/**
 * The library page's ACTUAL pattern after this task's fix: `onClickDetails`
 * / `onSelectChange` hoisted once with an empty dependency array (they only
 * call a `useState` setter), and `onPlayClick` — which can't drop its
 * per-row track closure without changing a prop signature shared with pages
 * outside this task's scope — kept stable per row via `RowCallbackCache`.
 */
function StableList({ tracks, Row }: { tracks: Track[]; Row: ReturnType<typeof makeCountingTrackCard> }) {
  const [, setBump] = useState(0);
    // Lazy `useState` rather than `useRef`: the cache must be READ during
  // render to build the rows, which the React Compiler rule forbids for a
  // ref, and `useRef(new X())` also constructs a fresh cache on every
  // render only to discard it. The initialiser runs once.
  const [cache] = useState(() => new RowCallbackCache<Track>());
  const handleClickDetails = useCallback(() => {}, []);
  const handleSelectChange = useCallback(() => {}, []);
  const getPlayClick = useCallback(
    (t: Track) => cache.get(t.id, 'play', t, () => () => {}),
    [cache],
  );
  return (
    <div>
      <button type="button" data-testid="bump" onClick={() => setBump((b) => b + 1)}>
        bump
      </button>
      {tracks.map((t, i) => (
        <Row
          key={t.id}
          rowId={`row-${i}`}
          track={t}
          index={i}
          onClickDetails={handleClickDetails}
          onSelectChange={handleSelectChange}
          onPlayClick={getPlayClick(t)}
        />
      ))}
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) } as Response)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackCard list — render scale', () => {
  it(
    'DOM node count for a realistic large list stays within budget',
    () => {
      const tracks = makeTracks(ROW_COUNT);
      const Row = makeCountingTrackCard(new Map());
      const { container } = render(
        <Providers>
          <StableList tracks={tracks} Row={Row} />
        </Providers>,
      );

      const nodeCount = container.querySelectorAll('*').length;
      // Measured empirically at ~54 DOM nodes/row (10,802 nodes for 200
      // rows) for the full desktop row (cover/play button, title + metadata
      // line, mobile-only continuation line, tags/commerce cell, time cell,
      // 5 rating-star buttons, row menu trigger). Budget set at 70/row:
      // enough headroom that a single incidental wrapper div doesn't fail
      // the build, tight enough that a scripted class/markup change that
      // doubles row weight does.
      const PER_ROW_BUDGET = 70;
      expect(nodeCount).toBeLessThan(ROW_COUNT * PER_ROW_BUDGET);
    },
    20_000,
  );

  it(
    'without stabilised callback props, an unrelated re-render re-renders every row (the pitfall CLAUDE.md warns about)',
    async () => {
      const tracks = makeTracks(ROW_COUNT);
      const counts = new Map<string, number>();
      const Row = makeCountingTrackCard(counts);
      const { getByTestId } = render(
        <Providers>
          <UnstableList tracks={tracks} Row={Row} />
        </Providers>,
      );
      // Flush each row's mount-time async effects (offline-cache lookup,
      // rating query) before taking the baseline, so an unrelated promise
      // settling doesn't get misattributed to the click below.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      counts.clear();

      fireEvent.click(getByTestId('bump'));

      const reRenderedRows = [...counts.values()].filter((n) => n > 0).length;
      // `TrackCard` is memoised (see TrackCard.tsx), but every prop rebuilt
      // inline still fails `memo`'s shallow comparison, so memoisation alone
      // buys nothing here — all 200 rows re-render for a click that touched
      // none of their data. This assertion documents the failure mode; it
      // is not the fix.
      expect(reRenderedRows).toBe(ROW_COUNT);
    },
    20_000,
  );

  it(
    'with stabilised callback props, an unrelated re-render leaves every row untouched',
    async () => {
      const tracks = makeTracks(ROW_COUNT);
      const counts = new Map<string, number>();
      const Row = makeCountingTrackCard(counts);
      const { getByTestId } = render(
        <Providers>
          <StableList tracks={tracks} Row={Row} />
        </Providers>,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      counts.clear();

      fireEvent.click(getByTestId('bump'));

      const reRenderedRows = [...counts.values()].filter((n) => n > 0).length;
      // Budget: 0. The `bump` click changes no row's track object and no
      // row's callback identity (every callback is either hoisted with an
      // empty dependency array or served from `RowCallbackCache` keyed on
      // the track's own object identity), so `memo` should bail out of
      // every row's subtree.
      expect(reRenderedRows).toBe(0);
    },
    20_000,
  );
});
