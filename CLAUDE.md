# CLAUDE.md

Working notes for LLM agents. Product spec lives in AGENTS.md.

@AGENTS.md

---

**U2C Beatstore** (internal name `antigravity`). Single-user producer/beatstore. Prod: `uche-beatstore-g.vercel.app`.

## Stack
Next.js 16 (App Router, Turbopack) · TS strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe · Wavesurfer · Essentia · React Query · Zustand · Zod · Vitest · lucide-react. No UI library — hand-rolled primitives.

## Layout
```
src/app/
  (auth)/                    login, invite, reset/update password
  (dashboard)/               library, projects, playlists, studio, contacts,
                             calendar, links, campaigns, settings, offline
  projects/share/[token]/    modern public share page (variant-driven)
  share/[token]/             legacy listener
  api/                       one folder per resource
src/components/{nav,layout,player,projects,tracks,share,crm,studio,activity,ui,offline}/
src/lib/{auth,audio,contracts,offline,stripe,supabase,types}/
src/proxy.ts                 Next 16 middleware (token refresh + protected paths)
supabase/migrations/         001…NNN, idempotent, ending NOTIFY pgrst, 'reload schema';
public/sw.js                 service worker (app shell only — audio uses IndexedDB)
```

## Conventions

**API** — folder per resource, `route.ts` exports `GET/POST/PATCH/DELETE`. All mutations Zod-validated via `lib/contracts/`. Owner gating via `requireRowOwnership(table, id)` or `requireUser()` from `lib/auth/ownership.ts`. Service-role client (`createServiceClient()`) only after ownership verified. Errors: `{ error: string }` + `errorMessage(err)`. Logging: `createLogger('api.x.y')`.

**UI** — dark warm theme. `--bg-page #0a0907`, `--bg-card #14110d`, `--accent #D4BFA0`, text `#E8DCC8/#a08a6a/#6a5d4a`, borders `#1f1a13/#2d2620`. Type: H1 40px `font-heading`, labels 10px mono uppercase tracking-[0.2em]. Use `Dropdown` over `<select>`. Bulk = `BatchActionBar` + `Set<string>` selection state. Feedback = `toast.*` / `confirmToast` from `useToast`.

**DB** — migrations append-only, idempotent (`IF NOT EXISTS`). End each schema change with `NOTIFY pgrst, 'reload schema';`. RLS on every owned table; owner-or-null SELECT pattern. Apply migrations on Supabase BEFORE merging dependent PRs.

**Auth** — Supabase via `@supabase/ssr`, Google OAuth. Refresh in `src/proxy.ts` (must run on `/api/*`). Public-by-design: `/share/*`, `/projects/share/*`. Service-role key is server-only.

**Players** — two: persistent `PlayerBar` (Zustand `usePlayer`) and DAW `PlayerCanvas` (own ws instance, mounted on project-share). Both via `useWaveSurfer`. Region-pinned comments use `region_start/end` (migration 013).

**Share variants** — `recipient_kind ∈ {client, producer, rapper, friend}` drives which `components/share/variants/*` renders.

**Stripe** — Buy buttons gated on `share.sales_enabled === true`. Checkout resolves prices server-side from `tracks.{lease,exclusive}_price_usd` → falls back to `creator_profiles.license_*_price_usd`. Webhook signature-verified via `req.text()` (NOT `req.json()`), idempotent UPSERT on `license_purchases.stripe_session_id`. Health check: `GET /api/stripe/diagnostics`.

**Cron** — `vercel.json` schedule, route validates `Authorization: Bearer ${CRON_SECRET}` before any work.

## Commands
```bash
npm run dev          # next dev
npm run build        # next build (includes tsc --noEmit)
npm test             # vitest run
npm run lint         # eslint
```

## Env vars
Required prod: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*` (×4), `NEXT_PUBLIC_R2_PUBLIC_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL=https://uche-beatstore-g.vercel.app`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`. Optional: `MOISES_API_KEY`, `NEXT_PUBLIC_AUDD_API_TOKEN`, `ENABLE_LOCAL_STORE=true`.

## Dashboard config (prod)
- **R2 CORS** must include `https://uche-beatstore-g.vercel.app` for `GET/PUT/POST/HEAD` — else "waveform unavailable."
- **Supabase Auth URL config**: Site URL = prod domain; Redirect URLs include `/auth/callback` and `/**`.
- **Google OAuth**: authorized redirect URI is the SUPABASE callback (`https://<ref>.supabase.co/auth/v1/callback`), not your domain.
- **Stripe webhook**: `/api/stripe/webhook` subscribed to `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`.

## Gotchas
- `"Could not find column X in schema cache"` → run `NOTIFY pgrst, 'reload schema';`, wait 10s.
- Don't add `window.scrollY` to fixed-positioned portals. Bounding-rect coords are viewport-relative.
- `npm run dev` is permissive about imports; `npm run build` catches them. Always build before PR.
- Two share routes: legacy `/share/[token]`, modern `/projects/share/[token]`. New work in the latter.
- If new code depends on an open PR, branch off that PR — not `main`.
- No Radix/Headless UI — primitives are hand-rolled by choice.
- IndexedDB owns audio blobs; service worker owns app shell. Keep them separate.

## Adding a feature
Migration (if schema) → Zod in `lib/contracts/` → route handler (owner-gated, logged) → UI with existing tokens → wire on page → update `lib/types/` → `npm run build && npm test` → PR with Summary / Why / Test plan / Required prod config.
