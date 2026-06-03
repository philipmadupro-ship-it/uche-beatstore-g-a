# testing-release

## Current test state (June 2026)

- **Vitest**: 191 tests passing across 25 test files.
- **Migration ceiling**: 092 (`contacts.crm_status`).
- **Build**: `npm run build` must pass (runs `tsc --noEmit` + Next.js build).
- **CI**: `.github/workflows/ci.yml` — tsc → vitest → next build on push + PR.

## Pure helper mandate (CLAUDE.md rule)

Business logic MUST live in `lib/` as pure functions, not inside components.
These are already tested — do not regress them:
- `lib/store/filters.ts` — `filterAndSortTracks`
- `lib/projects/filters.ts` — `filterAndSortProjects` (17 cases)
- `lib/playlists/filters.ts` — `filterAndSortPlaylists` (6 cases)
- `lib/contacts/filters.ts` — `filterAndSortContacts`, `paginate`, `pageCount` (12 cases)

Any new filter/sort/scoring/pricing logic must live here first with a test file.

## Verification gate before any commit

```bash
npx tsc --noEmit   # 0 errors
npm test           # 191+ tests
npm run build      # compiles cleanly
```

## Test priorities

1. Auth and protected dashboard access.
2. Public storefront browse, filter, purchase flows.
3. Checkout, promo codes, post-purchase delivery.
4. Share links and variant rendering.
5. Library/projects/playlists/contacts producer flows.
6. CRM: contact tags, segments, batch edits, send-modal templates.

## Release checklist

- Happy path + at least one edge case.
- Auth boundary (public vs protected).
- Mobile if storefront-impacting.
- Migration applied before dependent code ships.
- No regression in checkout, share, playback, or send flows.

## Skill integrations

- `/verify` — drive the running app to confirm UI changes work (contacts CRM, store checkout, send modal).
- `/code-review medium` — before merging auth, checkout, migration, or public API changes.
- `/simplify` — after large refactors to catch redundant code.
