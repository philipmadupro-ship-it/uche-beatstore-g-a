# repo-conventions

## Stack

Next.js 16 App Router · TypeScript strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe embedded checkout · Wavesurfer · Essentia · React Query · Zustand · Zod · Vitest · lucide-react · GSAP (portfolio only).

## Project layout (critical paths)

```
src/app/
  (auth)/          login, invite, reset, update-password
  (dashboard)/     library, projects, playlists, contacts, store-editor, sales, analytics…
  store/           PUBLIC storefront (no auth)
  api/             one folder per resource
src/components/    domain-grouped
src/hooks/         usePlayer, useCart, useWishlist, useTags, useContactTags, usePlaylistTags…
src/lib/
  actions/         server actions (profile)
  audio/           format, similarity, cover-color
  contacts/        filters.ts (pure, tested)
  playlists/       filters.ts (pure, tested)
  projects/        filters.ts (pure, tested), templates.ts
  store/           filters.ts (pure, tested)
  contracts/       Zod schemas — single source of truth for all API bodies
  db.ts            facade (scopedList, insertOwned, updateOwned, getOwned, deleteOwned)
  types/           index.ts, tags.ts, Track, Contact, BeatSend, CreatorProfile…
  ui/              cover-gradient.ts (seededGradient)
  email/           templates.ts, beat-send-template.ts
supabase/migrations/  001…092, append-only, idempotent
```

## API conventions

- One `route.ts` per resource folder.
- Zod validation via `lib/contracts/` (`.strict()` schemas).
- Ownership: `requireRowOwnership(table, id)` or `requireUser()` before any write.
- Service-role client (`createServiceClient()`) only after ownership verified.
- Errors: `{ error: string }` + `errorMessage(err)`.
- Logging: `createLogger('api.x.y')`.

## DB facade (`lib/db.ts`)

```ts
scopedList(table, opts)          // owner-scoped list
insertOwned(table, data)         // stamp user_id
updateOwned(table, id, data)     // owner check + update
getOwned(table, id)              // owner check + fetch
deleteOwned(table, id)           // owner check + delete
requireRowOwnership(table, id)   // returns { ok, admin, userId } or error response
requireUser()                    // auth guard only
```

`OwnedTable` union type — add new owned tables here when creating migrations.
`local-store.ts` schema type — must mirror OwnedTable with `[]` defaults.

## Pure filter helpers — REQUIRED pattern

Any filter/sort/scoring logic goes in `lib/<domain>/filters.ts` as a pure function.
New filter logic inside React components will be silently reverted. Write a test file first.

## Migration conventions

- Append-only, idempotent (`IF NOT EXISTS`).
- End with `NOTIFY pgrst, 'reload schema';`.
- Current ceiling: **092** (`contacts.crm_status`).
- Name: `NNN_descriptor.sql` — check `git log --all -- supabase/migrations/` before numbering.

## Engineering style

- No new dependencies without a clear reason.
- Prefer editing existing files to creating new ones.
- No `window.scrollY` on fixed portals; use `createPortal` to escape overflow clipping.
- Test the pure helper first, then build the UI that calls it.

## Skill integrations

- `/supabase-postgres-best-practices` — before writing complex queries, indexes, or RLS policies. Critical for performance at 500+ contacts and 100+ tracks.
- `/fewer-permission-prompts` — run periodically to reduce friction in day-to-day sessions.
