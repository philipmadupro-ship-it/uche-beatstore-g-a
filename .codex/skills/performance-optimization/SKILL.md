---
name: performance-optimization
description: Use for Beatstor performance work involving bundle size, image loading, audio preload, route splitting, rerenders, search debounce/cancellation, database query count, indexes, hydration, animation cost, layout shifts, memory, and player events.
---

# Performance Optimization

## Activation

Use when pages feel slow, lists grow, audio/artwork loading changes, search/filtering changes, player rerenders, dashboard queries, or public store scale work.

## Workflow

1. Identify the bottleneck class: network, database, render, hydration, bundle, media, animation, or memory.
2. Measure or inspect before optimizing.
3. Prefer debouncing, cancellation, cache, indexes, lazy loading, and code splitting before heavier refactors.
4. Avoid preloading full audio files unnecessarily.
5. Re-test UX states after optimization.

## Checklist

- Images use appropriate sizing/loading strategy.
- Audio preview strategy does not waste bandwidth.
- Search requests are debounced and stale responses handled.
- Large lists use efficient filtering and pagination/virtualization only when justified.
- Player event handling avoids memory leaks and excessive rerenders.
- Layout shifts and animation costs are controlled.

## Expected Output

Performance finding, optimization applied, verification method, and residual tradeoffs.
