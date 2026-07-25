# Beatstor Prompt Acceptance Map

Use this reference when continuing the full Beatstor product prompt or auditing whether the active goal can be considered complete. Treat every item as unproven until current repository state, tests, browser checks, or documented external limits prove it.

## Operating Rules

- Inspect the repository before implementation; do not rebuild working features.
- Preserve existing stack and patterns unless a strong reason is documented.
- Use project-local skills during implementation, not just when writing docs.
- Append `docs/codex-execution-log.md` after each major pass.
- Prefer focused, working increments that move one prompt requirement measurably closer to release.

## Required Skill Coverage

- `repository-audit`: full repo map, risks, reusable components, missing infrastructure.
- `beatstor-design-system`: typography, spacing, grid, radii, elevation, motion, states, themes.
- `responsive-ui-engineering`: 320 through 1728 px behavior, overflow, tap targets, player/nav safe areas.
- `audio-player-engineering`: persistent global player, queue, seek, volume, Media Session, buffering/error states.
- `beat-discovery-experience`: search, filters, suggestions, URL state, chips, skeletons, empty states.
- `marketplace-and-licensing`: license tiers, cart, discounts, terms, orders, downloads, exclusives.
- `producer-dashboard`: catalogue, upload/edit/publish, licenses, analytics, sales, operational views.
- `upload-and-file-management`: drag/drop, validation, progress, retry/cancel, metadata, secure storage paths.
- `authentication-and-permissions`: public/private routes, producer auth, buyer access, server-side checks.
- `database-and-api-architecture`: schema, indexes, RLS, Zod contracts, privileged operations.
- `performance-optimization`: bundle, images, audio preload, rerenders, queries, animation cost, memory.
- `accessibility-and-keyboard-navigation`: semantics, labels, focus, Escape, keyboard controls, contrast, reduced motion.
- `qa-and-regression-testing`: tests, browser automation, console inspection, remaining gaps.
- `ui-polish-review`: final visual consistency, state polish, mobile behavior, player overlap.

## Product Deliverables

1. Repository audit.
2. Codex skill system.
3. Beatstor design system.
4. Persistent streaming player.
5. Responsive desktop and mobile navigation.
6. Beat discovery interface.
7. Search and filters.
8. Beat cards and beat rows.
9. Beat details page.
10. License selector.
11. Cart architecture.
12. Buyer library.
13. Favorites.
14. Playlists.
15. Producer dashboard.
16. Upload workflow.
17. Authentication integration.
18. Database or schema improvements.
19. Secure storage architecture.
20. Error states.
21. Loading states.
22. Accessibility pass.
23. Performance pass.
24. Test suite.
25. Browser verification.
26. Build verification.
27. Technical documentation.
28. Execution log showing which skills were used.

## Public Experience Checklist

- Landing/home entry, discover/store, search results, genre/mood exploration, producer profile, beat detail, licensing explanation, sign-in, and sign-up/reset surfaces.
- Beat cards communicate artwork, title, producer, genre/mood, BPM/key, duration, price, play/favorite/cart affordances without overcrowding.
- Search and filters are fast, shareable, recoverable after refresh, and have useful no-results recovery.

## Buyer Experience Checklist

- Library, favorites, playlists, recently played, cart, purchases, downloads, orders, and account/settings access.
- Cart separates save, playlist, license selection, purchase, and download states.
- Exclusive/unavailable beats are represented accurately and cannot be bought through stale client state.

## Producer Experience Checklist

- Overview, beat catalogue, upload, edit metadata, license templates, sales, analytics, orders, payouts or documented limitation, profile editor, and settings.
- Upload flow handles preview MP3, WAV master, stems/archive, artwork, validation, progress, metadata extraction, draft recovery, publish/private/schedule states, and unsaved-change protection.
- Dashboard emphasizes operational decisions over decorative charts.

## Security And Data Checklist

- Server verifies ownership, role, price, license availability, purchase status, and download permission.
- Public JSON never leaks private R2 references or predictable purchased-file URLs.
- Sensitive operations use service role only after ownership or entitlement is verified.
- Inputs are schema validated; errors are safe and user-facing states avoid raw exceptions.

## Verification Gates

- Commands: use the repository's real scripts. If `npm run typecheck` or `npm run lint` do not exist, run the actual equivalents such as `npx tsc --noEmit` and `npx eslint ...`.
- Minimum final gate: typecheck, lint, tests, production build.
- Browser/manual flows: landing/store navigation, search, filters, playback start/switch/seek/volume, route navigation during playback, mobile mini/expanded player, favorite, playlist, license selection, cart, producer upload, draft recovery, protected route behavior, auth sign-in/out, empty states, error states, responsive layouts, and console inspection.

## Final Review Loop

Run these passes before considering the broad prompt complete:

1. Functional review.
2. Audio review.
3. Responsive review.
4. Accessibility review.
5. Performance review.
6. Visual polish.
7. Regression review.

Document external blockers honestly: payment credentials, storage credentials, email credentials, analytics providers, deployment config, and legal license language.
