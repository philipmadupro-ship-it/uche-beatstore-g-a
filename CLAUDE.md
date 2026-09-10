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
                             cover/ (cover art: geometry, collage, font-embed,
                               document-store, image-generation — pure + Vitest
                               apart from thin IndexedDB/fetch wrappers)
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

**UI** — near-black neutral surfaces, silver-on-black text, colour used only to signal.

*What components actually use* (counts are occurrences across `src/**/*.tsx`, so match these, not the CSS variables):

| Role | Use | Count |
|---|---|---|
| Page background | `#090907` | 369 |
| Card / panel | `#0D0D0A` | 152 |
| Text primary | `text-white/80` | 398 |
| Text secondary | `text-white/60` | 504 |
| Text tertiary / labels | `text-white/40` | 1000 |
| Text faint | `text-white/30` | 211 |
| Border default | `border-white/10` | 808 |
| Border hover / emphasis | `border-white/20` | 459 |
| Mint (free, success, positive) | `#6DC6A4` | 235 |
| Tan accent (sparing) | `#c8a47a` | 87 |
| Star gold | `#c8a84b` | 15 |

**Text and borders are white at alpha, not warm hexes.** `globals.css` does define `--bg-page` / `--bg-card` / `--accent` and a `--dr-*` scale, but components overwhelmingly bypass them, so a value copied from the variables lands off-palette against its neighbours. This table previously listed `#0a0907` / `#14110d` / `#D4BFA0` / `#E8DCC8` / `#6a5d4a` / `#1f1a13` — a warm set that survives almost nowhere in the app, and the cover art editor was built against it and came out visibly brown next to everything else. Verify against neighbouring components before trusting any palette written down here. Type: H1 40px `font-heading`, labels 10px mono uppercase tracking-[0.2em]. Use `Dropdown` over `<select>`. Bulk = `BatchActionBar` + `Set<string>` selection state. Feedback = `toast.*` / `confirmToast` from `useToast`. Fonts: Akira Expanded (body), Synkopy (`.font-heading`), Panchang (`.font-mono`) — all `/public/fonts`, no CDN imports.

**DB** — migrations append-only, idempotent (`IF NOT EXISTS`). End each schema change with `NOTIFY pgrst, 'reload schema';`. RLS on every owned table; owner-or-null SELECT pattern. Apply migrations on Supabase BEFORE merging dependent PRs. Latest on disk = **109** (`109_default_artwork.sql`) — this line previously read 106, which was renumbered; check `ls supabase/migrations/` rather than trusting the number written here. When working in a worktree off a stale base, check `git log --all -- supabase/migrations/` before naming.

**Auth** — Supabase via `@supabase/ssr`, Google OAuth. Refresh in `src/proxy.ts` (must run on `/api/*`). Public-by-design: `/share/*`, `/projects/share/*`, `/store/**`. Service-role key is server-only.

**Players** — two: persistent `PlayerBar` (Zustand `usePlayer`) and DAW `PlayerCanvas` (own ws instance, mounted on project-share). Both via `useWaveSurfer`. Region-pinned comments use `region_start/end` (migration 013).

**Cover Art Studio** (`/cover-art`, `components/cover-art/*`) — layer-based artwork editor. `CoverArtStudio.tsx` owns state; `StudioCanvas` handles pointer input; `LayerView` renders a layer; the panels are presentational. Rules that matter:

- **The canvas and the export must agree.** `LayerView` (DOM) and `renderArtworkDocumentSvg` (SVG) draw the same document two different ways, so any new layer property has to be implemented in BOTH. Shared crop maths lives in `imageCropDefaults` / `imageFrameRect` precisely so the two cannot drift. We shipped a canvas that drew every image layer as a grey placeholder while the export drew the real thing; don't recreate that.
- **Exports must embed fonts.** `svgToRasterBlob` rasterises through `new Image()`, and an SVG loaded as an image cannot read the page's `@font-face` rules or fetch `/fonts/*`. Anything leaving the app goes through `embedFontsInSvg` (`lib/cover/font-embed.ts`) or it ships in a fallback system face. Same reason images are inlined as data URIs rather than R2 URLs.
- **Interaction maths is pure and tested.** `lib/cover/geometry.ts` (resize-with-rotation, snapping, group scaling), `lib/cover/collage.ts` (layouts), `lib/cover/waveform.ts` (resampling + bar geometry). Per the "pure-logic extract" rule below — this is exactly the logic that gets silently reverted when it hides inside a component.
- **Persistence is IndexedDB, not localStorage** (`lib/cover/document-store.ts`, DB `antigravity-cover-art`). Image layers carry their bytes inline, so a collage is several megabytes and would blow localStorage's quota at the worst possible moment. Separate DB from `antigravity-offline` so version upgrades can't collide.
- **Undo history is one atomic state** (`{ doc, past, future }`). It was three `useState`s with nested setState calls inside each other's updaters; React may run an updater twice, the stacks desynced, and redo silently did nothing.
- **Waveforms downsample by bucket peak, never by point sampling.** `lib/cover/waveform.ts`. Interpolating between two source samples lands between transients as often as on them, so a kick disappears and the waveform reads as soft noise. There are also no frequency "lanes" — the old builder derived them from `index % 6` / `index % 3`, which is arithmetic on the bar's position and carries no audio information at all; it then painted them in two fixed blues that fought the warm palette. One colour, from the artwork's own palette.
- **The studio uses the app's design tokens, not a parallel palette.** The original lab shipped its own near-miss set — `#EEE8DD` text, `#10100D` panels, `#0D0D0A` fields, `#C7B89D` accent, translucent `#EBE1CC1A` borders, and blue/teal waveform colours — which read as a different, browner product sitting inside the app. Everything now resolves to the documented tokens (`#0a0907`, `#14110d`, `#E8DCC8`, `#a08a6a`, `#6a5d4a`, `#D4BFA0`, borders `#1f1a13` / `#2d2620`). `defaultArtworkPalette` matches them too. Only the four art *directions* deliberately diverge, because differing is what a direction is for.
- **Documents saved before a palette change keep their old palette**, since the palette is stored on the document. That is correct — it is the producer's artwork — but it means a stale saved cover is not evidence the tokens are wrong.
- **The studio's height is `calc(100vh-10.5rem)`, derived from `(dashboard)/layout.tsx`'s `main.pt-14.pb-28`.** A guessed value was 68px too tall, so the page scrolled instead of the panels and the bottom of the inspector was unreachable. Change both together.
- **The studio panels must collapse below ~1180px.** The rail plus both panels are 600px of fixed chrome; as plain grid columns they squeezed the canvas to a sliver and overflowed the container. Below that width they leave the grid and float over the canvas instead.
- **Window pointer listeners attach unconditionally.** Gating the listener effect on a ref means gestures that change no state (resize, rotate) never get listeners at all, because setting a ref doesn't schedule a render.

**Interaction hierarchy** — `direct manipulation → contextual popover → dropdown → modal → deep editor`. Pick the leftmost rung that can do the job. A control that changes exactly one property must not open a screen.

- **One editor per property.** `ui/InlineText` is the click-to-edit field (Enter saves, ⌘/Ctrl+Enter in multiline, Escape cancels, **blur saves** — discarding on blur throws away typing whenever the user clicks away). A ⋯ menu never grows its own copy of an editor the page can already show; it takes an `onEditX` prop and focuses the real one. `ProjectOptionsMenu` and `PlaylistOptionsMenu` used to render a rename `<input>` *inside the menu*, so rename existed twice and the menu version was the only discoverable one.
- **Menus are `ui/ActionMenu`, never hand-rolled.** Grouping/ordering is the pure model in `lib/ui/action-menu.ts` (Vitest-covered): sections render in declaration order **except** `danger: true`, which is always pinned last; hidden items are dropped before keyboard indices are assigned; a menu with zero visible items renders no trigger at all. Items support `shortcutKey` (single-letter accelerator while open), `checked`, `busy`, `hint`, and `'keep-open'` returns. Positioning mirrors `ui/Dropdown` — portaled, `position: fixed` with raw rect coords (never add `window.scrollY`), flips up near the viewport bottom. Focus is **not** trapped: `role="menu"` must let Tab out.
- **`role="menu"` is a promise.** It tells a screen reader the thing is arrow-navigable, so declaring it without implementing arrow keys is worse than not declaring it. Only two components own that role: `ui/ActionMenu` and `cover-art/ContextMenu` (pointer-positioned, so it can't be trigger-anchored — it borrows the same `nextEnabledIndex` / `firstEnabledIndex` maths rather than copying the rules). Everything else that needs a menu uses `ActionMenu`. A popover of **navigation links** is not a menu: TopBar's hub popover is a labelled `<nav>`, because the ARIA menu pattern is for application commands and `<a>` elements already answer Tab.
- **A menu item that opens an inline editor must not have its focus stolen back.** `ActionMenu.invoke` awaits `onSelect`, so React has already mounted and focused whatever the item opened by the time the menu closes. Restoring focus to the trigger there blurs the new field — and because `InlineText` saves on blur and a no-op save closes the editor, "Edit title" opened and shut in the same frame and looked like a dead menu item. The menu now only reclaims focus when the item left it unclaimed (still on the panel, or on `<body>`). Unit tests could not catch this: it needs a real focus stack.
- **Tags are `ui/InlineTagStrip`.** Pills remove in one click; adding opens a popover. The name→category lookup is in `lib/ui/tag-groups.ts` because both POST and DELETE need the category and the strip only holds the tag name — sending the wrong one succeeds and changes nothing.
- **The uploads tray owns post-upload metadata.** `components/upload/UploadsTray` renames and tags the created track in place, using the `track` the manager stores from `/complete`. Guard both with `canEditUploadedTrack` (`lib/upload/row-actions.ts`): `/complete` can succeed without returning a track, and an editor bound to `undefined` PATCHes `/api/tracks/undefined`. Which buttons a row shows comes from `uploadRowActions(status)` — one source, not five inline conditionals plus a parent-computed `isActive` flag beside the status it was derived from. A row never offers both Cancel and Dismiss; they render the same X and mean opposite things.
- **`/links` rows are the interaction surface; the popup is the detail view.** Copying a share URL is the most frequent action on the page and used to need the popup; renaming needed the popup *and* an edit-mode toggle inside it. The row title is the rename field and the row ⋯ menu holds copy / share / downloads / delete; the popup keeps the full URL, the track list, and the two properties that want a deliberate save (expiry, password) — and shows the same ⋯ menu so nothing is reachable from only one surface. The single-link delete had no confirmation while the bulk delete did, which made the one-click path the destructive one; both confirm now.
- **The two share tables are one branch, in `lib/links/share-link.ts`.** `share_links` is addressed by token, `project_shares` by row id and stores the display name in `label`. That branch was copy-pasted four times on the page. Sending a project share `{ title }` does not fail — the request succeeds, changes nothing, and the optimistic render shows the new title until the next refetch reverts it. `shareLinkEndpoint` / `toSharePatchBody` / `fromSharePatchResponse` / `filterShareLinks` are the single copies, Vitest-covered.
- **Reading a notification is an action, not a side effect of opening the panel.** The bell used to PATCH `action=read_all` on open, so glancing at it cleared everything — check one sale and the other nineteen rows were marked read and gone from the badge. An unread row is now the button that reads it (`?action=read` with ids, Zod-validated, filtered by `user_id` as well as id), and clearing the lot is an explicit "Mark all read". The arithmetic is `lib/notifications/read-state.ts`: decrementing the badge by the ids *passed* rather than the ids that were actually unread drives the count negative on a second click.
- **A clickable list row must not WRAP its slots.** `ui/ListRow` rendered the whole row as a `<button>`/`<Link>`, so every control inside it was nested in one — the trailing "open in new tab" anchor always was, and an inline rename field plus a ⋯ menu made it three. `<button>` inside `<button>` is invalid HTML: React reports a hydration error and the inner control's behaviour is the browser's guess. The row is now a plain element with a **stretched activator** (`absolute inset-0`, `z-0`) beneath `pointer-events-none` content; `leading`/`trailing` and an opt-in `titleInteractive` take pointer events back. The activator has no text, so a clickable row needs a `label`. Only the layout on screen misbehaves, so this hid in the mobile list while the desktop grid (a `div`) was fine — it surfaced in the dev server's log, not in a test or a screenshot.
- **The notification badge is not bounded by the page.** `unread` used to be derived from the same 20 rows the panel fetches, so past 20 it undercounted — the badge could read "9+" against a much larger real number, and "Mark all read" (unbounded server-side) then cleared rows the producer was never shown. It is a separate `head: true, count: 'exact'` query, run in parallel, and falls back to counting the page if only the count fails. The response carries `hasMore` so the panel can say it is showing a page.
- **Every overlay portals to `<body>`.** TopBar's notification panel was `absolute`, alone among them, so it clipped inside any ancestor with overflow or a backdrop-blur stacking context. It uses `ui/Popover`, which already portals, positions from viewport rect coords, clamps to the screen and closes on Escape and outside click — the same rules `ui/Dropdown` and `ui/ActionMenu` follow.
- **Settings is thin on purpose, but it must not send you through a tombstone.** Its License Builder card links to `/store-editor#licenses` — the canonical builder — not to `/settings/licenses`, whose entire content is a notice saying the builder moved. `/store-editor` reads the URL hash on mount and expands + scrolls to the matching section (`section-<id>` anchors), so any part of the app can deep-link a section instead of dropping the producer at the top of a fourteen-section accordion.
- **Price semantics: blank ≠ free.** `lib/store-editor/beat-row.ts` — `parsePriceInput` returns `null` for an empty field, meaning "inherit the producer's profile default" (mig 021). Storing `0` there publishes a catalogue for nothing. `hasSellablePrice` is the single rule for "does this beat have a price a buyer could pay", shared by the Needs-attention counter and the row filter so the two cannot disagree; it was a closure declared ~800 lines below its first use, which put it in the temporal dead zone the moment anything above it needed the rule.
- Component behaviour of this kind is covered by jsdom tests (`// @vitest-environment jsdom` pragma, `@testing-library/react`). A menu that renders perfectly can still be unusable by keyboard and put Delete next to Rename; neither `tsc` nor `next build` sees it.

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

**Optional:** `OPENAI_API_KEY` / `GEMINI_API_KEY` (either one enables AI image generation in the Cover Art Studio; read server-side only — `/api/cover/generate` reports which are configured and never accepts a key from the browser), `MOISES_API_KEY` (legacy stems), `DEMUCS_SERVICE_URL` (current stems service), `NEXT_PUBLIC_AUDD_API_TOKEN`, `ENABLE_LOCAL_STORE=true`, `RESEND_WEBHOOK_SECRET` (`whsec_…`; enables `/api/resend/webhook` open/click tracking → `beat_sends.opened_at/link_clicked_at`. Unset = route accepts events without signature verification, dev only), `NEXT_PUBLIC_R2_CDN_URL` (Cloudflare-cached custom domain in front of the R2 bucket, e.g. `https://cdn.uche-beatstore.com`; when set, the bottom player's `SimpleAudioEngine` streams previews from it instead of `r2.dev`. Unset = direct `r2.dev` public URL — still bypasses the `/api/audio` proxy, just not edge-cached. See `lib/audio/cdn.ts`).

**Player audio path** — `tracks.audio_url`, `wav_url`, and stem URLs may be opaque `r2://bucket/key` references. Dashboard playback resolves those through authenticated `/api/audio`; public store playback uses `tracks.preview_url` through `/api/store/preview/[id]`. Never expose or rewrite a private `r2://` reference into public JSON. Public derivatives can still use `NEXT_PUBLIC_R2_CDN_URL`.

## Dashboard config (prod)
- **R2 CORS** must include `https://uche-beatstore-g.vercel.app` for `GET/PUT/POST/HEAD` — else "waveform unavailable."
- Direct multipart upload also requires the private bucket CORS policy to allow `PUT` from the production origin and expose the `ETag` response header.
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
- **SVG-as-image is a sandbox.** Anything rasterised via `new Image()` — cover art export, share cards — cannot fetch *any* external resource: no fonts, no stylesheets, no cross-origin images. Inline it as a data URI or it will silently render wrong while the on-screen version looks right.
- **Panchang has no glyph for the shift (U+21E7) or option (U+2325) symbols.** They render as tofu. Spell out "Shift" and "Alt" in keyboard hints; the command symbol is fine.
- **`coverArtExportPresets` is a Record keyed by id, not an array.** `Object.values()` it before mapping.
- **A centred overflowing scroll container clips its own start edge.** `place-items: center` makes the top/left of a zoomed-in artboard unreachable; use `place-items: safe center`.
- **`tailwindcss-animate` is not installed, and 54 classes were pretending otherwise.** `animate-in`, `fade-in`, `slide-in-from-*`, `zoom-in-*` across 34 files emitted no CSS at all — Tailwind v4 here, a bare `@import "tailwindcss"`, no `@plugin`. Every popover, dropdown, menu, toast and modal hard-cut into existence while the markup claimed a considered entrance. The real utilities live in `globals.css` and use the app's own `--dur-*`/`--ease-*` tokens: `ui-pop` (panel below its trigger), `ui-pop-up` (above it, or rising from the bottom), `ui-fade-in`, `ui-toast`, plus the existing `ui-modal-panel` / `ui-scrim` / `ui-drawer-*`. All are switched off under `prefers-reduced-motion` — the plugin classes never were, so this was also a motion-sensitivity gap. `lib/ui/tailwind-classes.test.ts` guards it; the scan strips comments first, because the words appear in prose too and the first version reported five comments as violations.
- **A doubled opacity modifier paints nothing** — `bg-white/[0.04]/70`, `hover:bg-white/90/[0.04]`, `ring-white/30/40`, `bg-white/[0.02]/[0.98]`. Either half can be plain or arbitrary; Tailwind parses none of them and the class computes to `rgba(0,0,0,0)`. All four permutations were live at once: 52 of the `[…]/70` form across 30 files, then 6 more of the `90/[…]` form on the white close buttons in the links page, both share modals, the store list row and the store sidebar. `lib/ui/tailwind-classes.test.ts` missed each new shape until its pattern was widened to cover every permutation in one regex — narrow it again and a fresh population will hide behind it. They are residue of the scripted colour migration (3fe5698), which rewrote `bg-[#171511]/70` → `bg-white/[0.04]/70`; the fix is to DROP the leftover modifier, not multiply the two — multiplying makes the surface darker than every sibling the migration handled correctly. Watch for a rest state that ends up identical to its `hover:`, and for a second contradictory `hover:bg-*` left on the same element.
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
