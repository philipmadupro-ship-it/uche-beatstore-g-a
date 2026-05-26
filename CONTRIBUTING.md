# Contributing

Quick reference for working in this repo. Engineering details live in
`CLAUDE.md`; product spec in `AGENTS.md`.

## Before you start

```bash
git config core.hooksPath .githooks   # one-time: enable the local pre-commit
npm install
```

## Adding a feature

1. **Migration first** if you need schema changes — `supabase/migrations/`,
   idempotent, ends with `NOTIFY pgrst, 'reload schema';`. Apply on
   Supabase **before** merging the PR that depends on it. See
   `supabase/migrations/README.md`.
2. **Zod contract** in `lib/contracts/` for any mutation body.
3. **Route handler** — owner-gated via `requireRowOwnership` /
   `requireUser` from `lib/auth/ownership.ts`. Service-role client only
   *after* ownership is verified. Errors via `errorMessage(err)`.
4. **Pure-logic extract.** If the feature has filter / sort / scoring /
   pricing logic, write a pure function in `lib/` first and Vitest it.
   `lib/store/filters.filterAndSortTracks` is the template. Logic
   buried inside React components can't be tested in isolation and has
   silently regressed twice.
5. **UI** with existing design tokens (no new colors, no new font
   imports). Hand-rolled primitives only — no Radix / Headless UI.
6. **Build + test** before pushing:
   ```bash
   npm run build && npm test
   ```

## Commits + PRs

- Open PRs against `main`. CI (`.github/workflows/ci.yml`) runs
  `tsc → vitest → next build` on every push.
- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) — Summary,
  Why, Test plan, Required prod config, Migrations to apply.
- If you change behavior visible to buyers, update `AGENTS.md`. If you
  change engineering conventions or gotchas, update `CLAUDE.md`.

## Things that have bitten us

- Don't mock the database in route tests when ownership logic is in
  scope — mock the Supabase client *queue*, not the data layer.
- Don't bypass `safeSellerId()` when building PostgREST `.or(...)`
  filters with a UUID. Commas in the value break the parser.
- Don't add `as any` to Stripe SDK calls. Use the typed API so the next
  rename fails at compile time (we've eaten two SDK renames already).
- Don't put `window.scrollY` math into fixed-positioned portals.
  Bounding-rect coords are viewport-relative.

## Don'ts

- No CDN font imports — the three faces (Akira Expanded, Synkopy,
  Panchang) ship from `/public/fonts`.
- No new UI libraries. Primitives are hand-rolled by choice.
- No comments that explain WHAT — the code already does that. Only
  comment when the WHY is non-obvious.
