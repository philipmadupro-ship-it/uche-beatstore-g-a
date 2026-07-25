---
name: beat-discovery-experience
description: Use for Beatstor discovery, search, filters, sorting, active chips, URL state, recent searches, suggestions, mobile filter drawers, beat cards, beat rows, result counts, skeletons, empty states, and catalogue browsing performance.
---

# Beat Discovery Experience

## Activation

Use for `/store`, search results, genre/mood browsing, producer catalogue, related beats, cards, rows, filters, facets, and discovery APIs.

## Workflow

1. Inspect `src/app/store/page.tsx`, `src/components/store`, `src/lib/store/filters.ts`, and store API routes.
2. Keep filter and sort behavior in pure helpers with tests.
3. Reflect search/filter state in the URL when results should be shareable.
4. Preserve useful metadata on cards and rows: title, artwork, producer, genre/mood, BPM, key, duration, price, plays/favorites where available.
5. Add loading, empty, and error states shaped like the final layout.

## Checklist

- Filters include relevant genre, mood, BPM, key, price, duration, tag, newest/trending/most played signals where data exists.
- Applied filters are visible and clearable.
- Mobile drawer and desktop panel are usable.
- Stale search responses cannot replace newer results.
- No duplicate inline filter logic in React components.

## Expected Output

Discovery behavior change, helper/test update when needed, and clear notes on URL state, mobile behavior, and empty states.
