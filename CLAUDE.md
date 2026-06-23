# CLAUDE.md

Working notes for LLM agents. Product spec lives in AGENTS.md.

@AGENTS.md
@.claude/README.md

## Claude agent setup

Project-specific Claude orchestration and specialist guidance live in `.claude/agents/` and `.claude/skills/`.
Default to `orchestrator` for autonomous routing, then let it delegate to `planner`, `app-router`, `ui-system`, `supabase-data`, `commerce-storefront`, and `qa-test` as needed while loading the matching skill files before implementation.


---

**U2C Beatstore** (internal name `antigravity`). Single-producer beatstore: a private dashboard for managing tracks and a public storefront for selling them. Prod: `uche-beatstore-g.vercel.app`.

## Stack
Next.js 16 (App Router, Turbopack) · TS strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe (embedded checkout) · Wavesurfer · Essentia · React Query · Zustand · Zod · Vitest · lucide-react · GSAP (portfolio view only). No UI library — primitives are hand-rolled.

## Layout
```
src/app/
  (auth)/                    login, invite, reset-password, update-password
  (dashboard)/               library, projects, playlists, studio, contacts,
                             calendar, links, campaigns, settings, offline,
                             store-editor, sales, analytics, profile
  auth/callback/             OAuth callback
  store/                     PUBLIC storefront
    page.tsx                 grid + list + sidebar facets
    [id]/                    track detail
    checkout/                cart-mode + project-mode Stripe embedded
    download/                post-purchase delivery
    producer/[slug]/         producer profile page
    projects/[id]/           project bundle detail
    projects/access/[token]/ post-purchase project delivery
  projects/share/[token]/    public project share (variant-driven)
  share/[token]/             legacy track share
  api/                       one folder per resource (see "API map" below)
src/components/{nav,layout,player,projects,tracks,share,crm,studio,
                activity,ui,offline,store,library,events,lyrics,system,
                upload,stems,providers}/
src/hooks/                   useCart, useWishlist, usePlayer, useWaveSurfer,
                             useAuth, useTags, useRating, useTracks,
                             useToast, useRealtimeTable, useOfflineCache,
                             useResolvedAudioSrc, useCommandPalette
src/lib/                     auth/ contracts/ db.ts errors.ts log.ts
                             local-store.ts naming.ts validate.ts env.ts
                             clipboard.ts slug.ts utils.ts dnd.ts
                             store/filters.ts (pure filter+sort helper)
                             audio/ stems/ storage/ upload/ stripe/ supabase/
                             contacts/ offline/ types/ actions/
src/proxy.ts                 Next 16 middleware (token refresh + protected paths)
supabase/migrations/         001…047, idempotent, ending NOTIFY pgrst, 'reload schema';
public/sw.js                 service worker (app shell only — audio uses IndexedDB)
.github/workflows/ci.yml     tsc → vitest → next build on push + PR
.githooks/pre-commit         opt-in via `git config core.hooksPath .githooks`
```

## Conventions

**API** — folder per resource, `route.ts` exports `GET/POST/PATCH/DELETE`. All mutations Zod-validated via `lib/contracts/`. Owner gating via `requireRowOwnership(table, id)` or `requireUser()` from `lib/auth/ownership.ts`. Service-role client (`createServiceClient()`) only after ownership verified. Errors: `{ error: string }` + `errorMessage(err)`. Logging: `createLogger('api.x.y')`.

**UI** — dark warm theme. `--bg-page #0a0907`, `--bg-card #14110d`, `--accent #D4BFA0` (burnt amber), text `#E8DCC8/#a08a6a/#6a5d4a`, borders `#1f1a13/#2d2620`. Type: H1 40px `font-heading`, labels 10px mono uppercase tracking-[0.2em]. Use `Dropdown` over `<select>`. Bulk = `BatchActionBar` + `Set<string>` selection state. Feedback = `toast.*` / `confirmToast` from `useToast`. Fonts: Akira Expanded (body), Synkopy (`.font-heading`), Panchang (`.font-mono`) — all `/public/fonts`, no CDN imports.

**DB** — migrations append-only, idempotent (`IF NOT EXISTS`). End each schema change with `NOTIFY pgrst, 'reload schema';`. RLS on every owned table; owner-or-null SELECT pattern. Apply migrations on Supabase BEFORE merging dependent PRs. Latest applied = 065. When working in a worktree off a stale base, check `git log --all -- supabase/migrations/` before naming.

**Auth** — Supabase via `@supabase/ssr`, Google OAuth. Refresh in `src/proxy.ts` (must run on `/api/*`). Public-by-design: `/share/*`, `/projects/share/*`, `/store/**`. Service-role key is server-only.

**Players** — two: persistent `PlayerBar` (Zustand `usePlayer`) and DAW `PlayerCanvas` (own ws instance, mounted on project-share). Both via `useWaveSurfer`. Region-pinned comments use `region_start/end` (migration 013).

**Share variants** — `recipient_kind ∈ {client, producer, rapper, friend}` drives which `components/share/variants/*` renders.

**Storefront** — `/store` is public-by-design. Tracks listed when `tracks.store_listed = true`; projects featured when `projects.store_featured = true`. Buying:
- **Track licenses** — `BeatCard` / `BandcampRemixCard` (type=remix) / `MusicPortfolio` row → preview drawer → cart (`useCart`) → `/store/checkout` → embedded Stripe (`createEmbeddedCheckoutPage`) → webhook (`purchase_kind: 'track_license'`) → `license_purchases` row + Resend delivery email pointing at `/store/download?session_id=…`.
- **Project bundles** — `/store/projects/[id]` → "Buy bundle" → `/store/checkout?project_id=…` → embedded Stripe (`purchase_kind: 'project'`) → webhook writes `project_access_links` (token + frozen `amount_usd` from `session.amount_total`) → delivery email points at `/store/projects/access/<token>`.
- **Promo codes** — `promo_codes` table; `/api/store/promo` validates; checkout server distributes discount across line items (percent → uniform per-line; flat → proportional split; min unit_amount = $0.01).
- **Filter + sort logic lives in `lib/store/filters.ts`** (`filterAndSortTracks`) — pure function, Vitest-covered. Page useMemo delegates to it. Don't re-inline; the test suite is what catches AI revert wipes.
- **Wishlist** — `useWishlist` (Zustand + localStorage, key `antigravity-wishlist`). Optional `isWishlisted` / `onToggleWishlist` props on `BeatCard` / `BandcampRemixCard` / `MusicPortfolio` rows.
- **Cart** — `useCart` (Zustand + localStorage). `CartDrawer` stays mounted (`open` prop) instead of unmounting on close — preserves email + promo input across navigation.
- **Exclusive stems-pending flow** — exclusive purchases of tracks without `wav_url` or ready `stems_status` are NOT rejected at checkout (changed from the old gate-the-sale policy). Checkout writes `metadata.stems_pending_track_ids` (CSV of affected track ids); the webhook flips `license_purchases.needs_stems_upload = true` (mig 052) and emails the producer to upload. `/sales` shows an "Awaiting stems" badge on those rows.

**Stripe** — Two checkout surfaces:
- Share-page checkout — `/api/share/[token]/checkout`, buy gated on `share.sales_enabled === true`.
- Store checkout — `/api/store/checkout`, cart-mode and project-mode in one route.

Common: `ui_mode: 'embedded_page'` (server); `stripe.createEmbeddedCheckoutPage({ clientSecret })` (client). Webhook (`/api/stripe/webhook`) signature-verified via `req.text()` (NOT `req.json()`); idempotent on `processed_stripe_events` (event-level) and `license_purchases.stripe_session_id` / `project_access_links.stripe_session_id` (purchase-level). Branches on `metadata.purchase_kind ∈ {track_license, project}`. Health check: `GET /api/stripe/diagnostics`.

**Cron** — `vercel.json` schedule, route validates `Authorization: Bearer ${CRON_SECRET}` before any work.

## Commands
```bash
npm run dev          # next dev (Turbopack)
npm run build        # next build (includes tsc --noEmit)
npm test             # vitest run
npm run lint         # eslint
git config core.hooksPath .githooks    # one-time: enable local pre-commit
```

CI: `.github/workflows/ci.yml` runs `tsc --noEmit` → `vitest` → `next build` on push to `main` and on every PR.

## Env vars
**Required prod:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (public derivatives/assets), `R2_PRIVATE_BUCKET_NAME` (masters/WAV/stems), `NEXT_PUBLIC_R2_PUBLIC_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL=https://uche-beatstore-g.vercel.app`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `CRON_SECRET`.

**Optional:** `MOISES_API_KEY` (legacy stems), `DEMUCS_SERVICE_URL` (current stems service), `NEXT_PUBLIC_AUDD_API_TOKEN`, `ENABLE_LOCAL_STORE=true`, `RESEND_WEBHOOK_SECRET` (`whsec_…`; enables `/api/resend/webhook` open/click tracking → `beat_sends.opened_at/link_clicked_at`. Unset = route accepts events without signature verification, dev only), `NEXT_PUBLIC_R2_CDN_URL` (Cloudflare-cached custom domain in front of the R2 bucket, e.g. `https://cdn.uche-beatstore.com`; when set, the bottom player's `SimpleAudioEngine` streams previews from it instead of `r2.dev`. Unset = direct `r2.dev` public URL — still bypasses the `/api/audio` proxy, just not edge-cached. See `lib/audio/cdn.ts`).

**Player audio path** — `tracks.audio_url`, `wav_url`, and stem URLs may be opaque `r2://bucket/key` references. Dashboard playback resolves those through authenticated `/api/audio`; public store playback uses `tracks.preview_url` through `/api/store/preview/[id]`. Never expose or rewrite a private `r2://` reference into public JSON. Public derivatives can still use `NEXT_PUBLIC_R2_CDN_URL`.

## Dashboard config (prod)
- **R2 CORS** must include `https://uche-beatstore-g.vercel.app` for `GET/PUT/POST/HEAD` — else "waveform unavailable."
- **R2 buckets:** `R2_BUCKET_NAME` is public and contains previews/covers/peaks/voice tags. `R2_PRIVATE_BUCKET_NAME` must have no public development URL and contains masters/WAV/stems. Any cloud-backed audio upload fails closed when the private bucket variable is missing; local filesystem fallback is only used when R2 itself is not configured.
- **Supabase Auth URL config:** Site URL = prod domain; Redirect URLs include `/auth/callback` and `/**`.
- **Google OAuth:** authorized redirect URI is the SUPABASE callback (`https://<ref>.supabase.co/auth/v1/callback`), not your domain.
- **Stripe webhook:** `/api/stripe/webhook` subscribed to `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`.

## Gotchas
- `"Could not find column X in schema cache"` → run `NOTIFY pgrst, 'reload schema';`, wait 10s.
- **PostgREST `.or()` interpolation footgun** — commas inside a value break the filter because PostgREST treats them as condition separators. Validate any interpolated id (e.g. `safeSellerId()` in `/api/store/route.ts` for UUIDs) before building the filter string.
- **Stripe SDK renames have bitten us twice.** Server: `ui_mode: 'embedded'` is removed → use `'embedded_page'`; `automatic_payment_methods` is rejected for embedded sessions, drop it. Client: `initEmbeddedCheckout` was removed in `@stripe/stripe-js@9.x` → use `stripe.createEmbeddedCheckoutPage({ clientSecret })`. Use the typed call (no `as any`) so the next rename fails at compile time.
- **The `(dashboard)` group requires auth via `src/proxy.ts`**; `(auth)` and `store/*` do not. Easy to put a new page in the wrong group and either expose private data or 401 a public visitor.
- **`prefers-reduced-motion` matters** — `MusicArtwork`, `ParticleText`, `MusicPortfolio`, the cosmos `.track-masonry` fade, and the vinyl spin all gate animation on it. Respect that pattern in new visual components.
- Don't add `window.scrollY` to fixed-positioned portals. Bounding-rect coords are viewport-relative.
- `npm run dev` is permissive about imports; `npm run build` (and CI) catches them. Always build before PR.
- Two share routes: legacy `/share/[token]`, modern `/projects/share/[token]`. New work in the latter.
- If new code depends on an open PR, branch off that PR — not `main`.
- No Radix/Headless UI — primitives are hand-rolled by choice.
- IndexedDB owns audio blobs; service worker owns app shell. Keep them separate.
- **Worktree contamination** — sub-agents have created `.claude/worktrees/agent-*` that get locked on crash. Cleanup: `git worktree unlock <path>` → `git worktree remove --force <path>` → `git branch -D worktree-<id>`.
- **Migration numbering races** — when two parallel branches both add migrations, both will claim the next number. Check `git log --all -- supabase/migrations/` before naming. We renumbered 040/041 → 046/047 once already.
- **AGENTS.md is the product spec, not a build-order prompt.** Update it when you change the product, not when you change the code.

## Adding a feature
1. **Migration first** (if schema change): `supabase/migrations/NNN_descriptor.sql`, idempotent, ends with `NOTIFY pgrst, 'reload schema';`. Apply on Supabase before merging dependent code.
2. **Zod contract** in `lib/contracts/` for any mutation body.
3. **Route handler** — owner-gated (`requireRowOwnership` / `requireUser`), Zod-validated, `errorMessage(err)` on failure, `createLogger('api.x.y')` for diagnostics.
4. **Pure-logic extract** — when the feature has filter / sort / scoring / pricing logic, write it as a pure function in `lib/` first (`filterAndSortTracks` is the template). Vitest the helper. **Logic inside React components can't be tested in isolation and gets silently reverted** — we've shipped this regression twice.
5. **UI** with existing tokens (no new colors, no new font imports).
6. **Wire on the page**; update `lib/types/` if a public shape changed.
7. **`npm run build && npm test`** locally; pre-commit hook (if enabled) double-checks staged TS.
8. **PR** with Summary / Why / Test plan / Required prod config / Migrations to apply. CI (`.github/workflows/ci.yml`) will gate the merge.

## API map (high-level, public + dashboard)
- **Public storefront** — `/api/store` (catalogue), `/api/store/[id]` (track detail w/ licenses), `/api/store/projects/[id]` (project bundle), `/api/store/projects/access/[token]` (post-purchase delivery), `/api/store/producer/[slug]` (producer page), `/api/store/checkout`, `/api/store/promo`, `/api/store/contact`, `/api/store/delivery`, `/api/store/download-file`, `/api/store/free-download`.
- **Public share** — `/api/share/[token]/{route,play,download,checkout,analytics}`, `/api/projects/share/[token]/{route,tracks,comments}`.
- **Producer (auth)** — `/api/tracks`, `/api/projects`, `/api/playlists`, `/api/contacts`, `/api/beat_sends`, `/api/campaigns`, `/api/calendar`, `/api/events`, `/api/profile`, `/api/licenses`, `/api/track-licenses`, `/api/sales`, `/api/analytics`, `/api/upload/*`, `/api/stems/*`, `/api/tracks/[id]/{analyze,arrangement,heatmap,lyrics,peaks,rate,similar,tags,shares,versions}`, `/api/search`, `/api/activity`, `/api/whoami`, `/api/invite`, `/api/email`, `/api/words`.
- **Webhook + diagnostics** — `/api/stripe/webhook`, `/api/resend/webhook` (email open/click → `beat_sends`), `/api/stripe/diagnostics`, `/api/audio/diagnostics`, `/api/stems/health`, `/api/cron/nudge-stale`.
