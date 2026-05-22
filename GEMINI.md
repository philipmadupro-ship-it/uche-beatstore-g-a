# GEMINI.md

Working notes for Gemini CLI agent. Full product spec lives in AGENTS.md.

@AGENTS.md

---

## Project

**U2C Beatstore** (codename `antigravity`). Single-user producer beatstore.
Prod: `uche-beatstore-g.vercel.app`.

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe · Wavesurfer · Zustand · Zod · Lucide React · Vitest.
**No UI library — every component is hand-rolled.**

## File Layout
```
src/app/
  (auth)/                    login, invite, reset/update password
  (dashboard)/               library, projects, playlists, studio, contacts,
                             calendar, links, campaigns, settings, offline
  projects/share/[token]/    public share page (variant-driven)
  share/[token]/             legacy listener
  store/                     public beatstore
  api/                       one folder per resource
src/components/{nav,layout,player,projects,tracks,share,crm,studio,activity,ui,offline,store}/
src/lib/{auth,audio,contracts,offline,stripe,supabase,types}/
src/proxy.ts                 Next 16 middleware
supabase/migrations/         001…NNN append-only, idempotent, end with NOTIFY pgrst
public/sw.js                 service worker
```

## Theme (never deviate)
- Background: `#0a0907`
- Card: `#14110d`
- Accent: `#D4BFA0`
- Text primary: `#E8DCC8`
- Text muted: `#a08a6a`
- Text faint: `#6a5d4a`
- Borders: `#1f1a13` / `#2d2620`
- Labels: `10px font-mono uppercase tracking-[0.2em]`

## Conventions

**API routes** — folder per resource, `route.ts` exports `GET/POST/PATCH/DELETE`. All mutations Zod-validated via `lib/contracts/`. Owner gating via `requireRowOwnership(table, id)` or `requireUser()` from `lib/auth/ownership.ts`. Service-role client (`createServiceClient()`) only after ownership verified. Errors: `{ error: string }` + `errorMessage(err)`.

**UI** — Use `Dropdown` over raw `<select>`. Bulk actions = `BatchActionBar` + `Set<string>` selection state. Feedback = `toast.*` / `confirmToast` from `useToast`. Never use `localStorage` or `sessionStorage`. No Radix, no shadcn, no Headless UI.

**DB migrations** — append-only, idempotent (`IF NOT EXISTS`). Always end with `NOTIFY pgrst, 'reload schema';`. Latest migration: check `supabase/migrations/` for the highest numbered file. New migrations start at the next number.

**Auth** — Supabase via `@supabase/ssr`. Refresh in `src/proxy.ts`. Public-by-design: `/share/*`, `/projects/share/*`, `/store`.

**Players** — Two: persistent `PlayerBar` (Zustand `usePlayer`) and DAW `PlayerCanvas`. Both via `useWaveSurfer`. Never instantiate `new Audio()` directly.

**Cart** — `useCart` Zustand store. Cart item key = `${track.id}-${license.id}`. Never deduplicate by `track.id` alone.

**Stripe** — Webhook at `/api/stripe/webhook`, signature-verified via `req.text()` (NOT `req.json()`). Idempotent UPSERT on `license_purchases.stripe_session_id`. Metadata must include `license_id`, `license_type`, `content_id`, `source_surface`.

**Share variants** — `recipient_kind ∈ {client, producer, rapper, friend}` → `components/share/variants/*`.

## Commands
```bash
npm run dev       # next dev
npm run build     # next build — ALWAYS run before finishing a task
npm test          # vitest run
npm run lint      # eslint
```

## Critical Rules
- `npm run build` must pass with zero TypeScript errors before any task is considered done.
- Never install new npm packages without first checking `package.json`.
- Never use `localStorage`/`sessionStorage` — the app runs in sandboxed contexts.
- Never add Radix, shadcn, Headless UI, or any component library.
- New migrations must be idempotent and end with `NOTIFY pgrst, 'reload schema';`.
- Two share routes exist: `/projects/share/[token]` (modern) and `/share/[token]` (legacy). Don't confuse them.
- `"Could not find column X in schema cache"` → run `NOTIFY pgrst, 'reload schema';` in Supabase SQL editor, wait 10s.

## Env vars (never hardcode)
Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*` (×4), `NEXT_PUBLIC_R2_PUBLIC_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`.
