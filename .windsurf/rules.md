# Windsurf Cascade Rules — antigravity

You are working on **U2C Beatstore** (codename `antigravity`). Always read `AGENTS.md` for the full product spec before making any changes.

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe · Wavesurfer · Zustand · Zod · Lucide React · Vitest.
**No UI library — every component is hand-rolled. Never install Radix, shadcn, or Headless UI.**

## Theme (never deviate)
- Background: `#0a0907`
- Card: `#14110d`
- Accent: `#D4BFA0`
- Text primary: `#E8DCC8`, muted: `#a08a6a`, faint: `#6a5d4a`
- Borders: `#1f1a13` / `#2d2620`
- Labels: `10px font-mono uppercase tracking-[0.2em]`

## File Layout
```
src/app/
  (auth)/                    login, invite, reset/update password
  (dashboard)/               library, projects, playlists, studio, contacts,
                             calendar, links, campaigns, settings, offline
  projects/share/[token]/    public share page (variant-driven)
  store/                     public beatstore
  api/                       one folder per resource
src/components/{nav,layout,player,projects,tracks,share,crm,studio,activity,ui,offline,store}/
src/lib/{auth,audio,contracts,offline,stripe,supabase,types}/
supabase/migrations/         001…NNN append-only, idempotent, end with NOTIFY pgrst
```

## Conventions

**API routes** — folder per resource, `route.ts` exports `GET/POST/PATCH/DELETE`. All mutations Zod-validated via `lib/contracts/`. Owner gating via `requireRowOwnership(table, id)` or `requireUser()` from `lib/auth/ownership.ts`. Service-role client (`createServiceClient()`) only after ownership verified. Errors: `{ error: string }` + `errorMessage(err)`.

**UI** — Use `Dropdown` over raw `<select>`. Bulk = `BatchActionBar` + `Set<string>`. Feedback = `toast.*` / `confirmToast` from `useToast`. No `localStorage` or `sessionStorage`.

**DB** — Migrations append-only, idempotent (`IF NOT EXISTS`). Always end with `NOTIFY pgrst, 'reload schema';`. Apply migrations on Supabase BEFORE merging dependent PRs.

**Players** — Two: persistent `PlayerBar` (Zustand `usePlayer`) and DAW `PlayerCanvas`. Both via `useWaveSurfer`. Never use `new Audio()` directly.

**Stripe** — Webhook at `/api/stripe/webhook`, signature-verified via `req.text()` (NOT `req.json()`). Idempotent UPSERT on `license_purchases.stripe_session_id`.

**Share variants** — `recipient_kind ∈ {client, producer, rapper, friend}` → `components/share/variants/*`.

## Critical Rules
1. `npm run build` must pass (zero TypeScript errors) before any task is complete.
2. Never install new packages without checking `package.json` first.
3. Never use `localStorage` / `sessionStorage`.
4. Migrations must be idempotent and end with `NOTIFY pgrst, 'reload schema';`.
5. Two share routes: `/projects/share/[token]` (modern) and `/share/[token]` (legacy) — never confuse them.
6. `"Could not find column X"` → run `NOTIFY pgrst, 'reload schema';` in Supabase, wait 10s.

## Commands
```bash
npm run dev       # start dev server
npm run build     # ALWAYS run before finishing
npm test          # vitest
npm run lint      # eslint
```
