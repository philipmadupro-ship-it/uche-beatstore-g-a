# CLAUDE.md

Working notes for LLM agents. Product spec lives in AGENTS.md.

**Before a UI pass** read `docs/design-direction.md` (binding visual spec) — the colour section below summarises it, but the doc wins.
**Before a schema change** read `supabase/MIGRATIONS.md` (applied-status ledger + numbering).
**Before a large pass** skim the tail of `docs/codex-execution-log.md` — it records what was just changed and why.

@AGENTS.md
@.claude/README.md

## Claude agent setup

Project-specific Claude orchestration and specialist guidance live in `.claude/agents/` and `.claude/skills/`.
Default to `orchestrator` for autonomous routing, then let it delegate to `planner`, `app-router`, `ui-system`, `supabase-data`, `commerce-storefront`, and `qa-test` as needed while loading the matching skill files before implementation.


---

**U2C Beatstore** (internal name `antigravity`). Single-producer beatstore: a private dashboard for managing tracks and a public storefront for selling them. Prod: `uche-beatstore-g.vercel.app`.

## Stack
Next.js 16 (App Router, Turbopack) · TS strict · Tailwind · Supabase (Auth + Postgres + RLS) · Cloudflare R2 · Resend · Stripe (embedded checkout) · Wavesurfer · Essentia · React Query · Zustand · Zod · Vitest (unit) + Playwright (e2e) · Sentry · lucide-react · GSAP (portfolio view only). No UI library — primitives are hand-rolled.

## Layout
```
src/app/
  page.tsx                   redirects to /library
  (auth)/                    login, invite/[token], reset-password, update-password
  (dashboard)/               library, projects, playlists, studio, contacts,
                             calendar, links, campaigns, settings(+/licenses),
                             offline, store-editor, cover-art, sales, analytics,
                             profile
  auth/callback/             OAuth callback
  embed/[id]/                framable distribution widget (CSP frame-ancestors *)
  dev/design-system/         token + component gallery (dev surface)
  store/                     PUBLIC storefront
    page.tsx                 grid + list + sidebar facets
    [id]/                    track detail (+ /share)
    type/[slug]/             browse by track type
    checkout/                cart-mode + project-mode Stripe embedded
    download/                post-purchase delivery
    orders/                  order lookup by email
    account/                 buyer sign-in; /me persistent account; /[token] legacy 24h link
    playlists/[id]/          public playlist
    producer/[slug]/         producer profile page
    projects/[id]/           project bundle detail
    projects/access/[token]/ post-purchase project delivery
    privacy/                 privacy + erasure
  projects/share/[token]/    public project share (variant-driven)
  share/[token]/             legacy track share
  api/                       one folder per resource (see "API map" below)
src/components/{nav,layout,player,projects,tracks,share,crm,studio,settings,
                activity,ui,offline,store,library,events,lyrics,system,
                cover-art,calendar,playlists,upload,stems,providers}/
src/hooks/                   useCart, useWishlist, usePlayer, useWaveSurfer,
                             useAuth, useTags, useTagColors, useRating,
                             useTracks, useToast, useRealtimeTable,
                             useOfflineCache, useResolvedAudioSrc,
                             useCommandPalette, useDialogBehavior,
                             useReducedMotion, useLibraryColumns,
                             useBrandArtwork, usePlayerKeyboardShortcuts,
                             useSpectralPeaks, usePreviewPrefetch
src/lib/                     auth/ contracts/ db/ errors.ts log.ts env.ts
                             local-store.ts naming.ts validate.ts slug.ts
                             clipboard.ts utils.ts dnd.ts observability.ts
                             sentry.ts api-error.ts client-cache.ts
                             buyer-session.ts buyer-tokens.ts
                             share-media-token.ts
                             artwork/ (gradient, palette, tag-colors, crop)
                             cover/ (cover art studio: geometry, collage,
                                     font-embed, document-store, waveform)
                             library/ (triage, columns, track-stats)
                             dashboard/ (action-digest, home-config)
                             store/ (filters, discovery, discount, funnel,
                                     readiness, momentum, public-media, …)
                             ui/ (toast-queue + source-guard tests)
                             theme/ audio/ stems/ storage/ upload/ stripe/
                             supabase/ contacts/ crm/ offline/ fulfillment/
                             security/ privacy/ share/ tags/ types/ actions/
src/proxy.ts                 Next 16 middleware — Supabase token refresh + CSP
supabase/migrations/         001…113, idempotent, ending NOTIFY pgrst, 'reload schema';
supabase/MIGRATIONS.md       applied-status ledger + numbering rules — read it
docs/design-direction.md     "Quiet Luxury" visual spec — binding for UI work
docs/codex-execution-log.md  running change log; read the tail before a big pass
e2e/                         Playwright specs (storefront, project-and-playlist)
public/sw.js                 service worker (app shell only — audio uses IndexedDB)
.github/workflows/ci.yml     tsc → vitest → next build on push + PR
.githooks/pre-commit         opt-in via `git config core.hooksPath .githooks`
```

## Conventions

**API** — folder per resource, `route.ts` exports `GET/POST/PATCH/DELETE`. All mutations Zod-validated via `lib/contracts/`. Owner gating via `requireRowOwnership(table, id)` or `requireUser()` from `lib/auth/ownership.ts`. Service-role client (`createServiceClient()`) only after ownership verified. Errors: `{ error: string }` + `errorMessage(err)`. Logging: `createLogger('api.x.y')`.

**UI** — near-black neutral surfaces, silver-on-black text, colour used only to signal. Type: H1 40px `font-heading`, labels 10px mono uppercase tracking-[0.2em]. Use `Dropdown` over `<select>`. Bulk = `BatchActionBar` + `Set<string>` selection state. Feedback = `toast.*` / `confirmToast` from `useToast` (queue policy — cap 4, dedupe, hover-pause — lives in `lib/ui/toast-queue.ts`, not in the store setter). Overlays use `useDialogBehavior` (dialogs: full focus trap; menus/popovers: `trapFocus: false`, Escape only). Fonts: Akira Expanded (body), Synkopy (`.font-heading`), Panchang (`.font-mono`) — all `/public/fonts`, no CDN imports.

## Colour + design tokens

**Read this before styling anything. The old `#D4BFA0` burnt-amber palette documented here is GONE and following it has already produced wrong-looking work.**

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

**Text and borders are white at alpha, not warm hexes.** `globals.css` does define `--bg-page` / `--bg-card` / `--accent` and a `--dr-*` scale, and components overwhelmingly bypass them. **The three surface tokens now match this table exactly** (`--bg-page` `#090907`, `--bg-card` `#0D0D0A`, `--bg-hover` `#11110F`) — until 2026-09-20 they did not, and `--bg-card` resolved to `#181815`, a full shade lighter, so every `ui/Card`, `Modal` and `Drawer` rendered a paler panel than the hand-rolled ones beside it. Surfaces are safe to take from the variables. **Text, border and accent tokens are still off** — `--text-primary` is `#E6DED1` where components write `text-white/80`, and `--border-default` is a warm `#282722` — so a value copied from those still lands off-palette against its neighbours. This table previously listed `#0a0907` / `#14110d` / `#D4BFA0` / `#E8DCC8` / `#6a5d4a` / `#1f1a13` — a warm set that survives almost nowhere in the app, and the cover art editor was built against it and came out visibly brown next to everything else. Verify against neighbouring components before trusting any palette written down here.

Underneath the table there is a real token layer, defined in `src/app/globals.css` (`:root`) and specified in `docs/design-direction.md`. Reach for a variable rather than a literal when you have the choice — `[data-theme="de-roche-archive"]` only re-themes what goes through the tokens. For **surfaces** that is now a safe swap in either direction, because the token and the literal are the same colour. For **text, borders and accent** it is not yet, so do not "fix" a neighbouring hardcoded hex on that basis: a lone variable in a screen full of `#090907` is the thing that looks wrong.

One trap before migrating literals in bulk: a lot of them carry an opacity modifier on the hex (`bg-[#090907]/90`, `bg-[#0D0D0A]/60`). Check how `bg-[var(--bg-page)]/90` actually compiles in this Tailwind version *before* converting those — the plain ones are the safe population.

Two layers coexist, deliberately:

- **De Roche primitives** — `--dr-black-950 #0B0B0A` … `--dr-paper-100 #EEE8DD`. Source values. Don't reach for these in components.
- **Semantic aliases** — what components use: `--background-primary/secondary/elevated`, `--surface-primary/secondary/hover/active/selected`, `--text-primary/secondary/tertiary/disabled`, `--border-subtle/default/strong/focus`, `--brand-primary #C4B49C` (+ `-hover`, `-active`), `--success #6FA58A`, `--warning #C88B46`, `--information #71A4B5`, waveform band colours `--wave-low` … `--wave-air`.

Legacy app tokens are now **aliases onto the semantic layer** — `--bg-page` → `--background-primary`, `--bg-card` → `--surface-primary`, `--bg-hover` → `--surface-hover`, `--accent` → `--brand-primary`, `--border` → `--border-default`. They still work; they no longer hold the old hexes.

**The accent trap.** `--accent` (the *token*) is champagne `#C4B49C`. But `docs/design-direction.md` principle 3 says the *interface* accent is **white and its alpha steps**, and it marks STATE (active / playing / selected / focused) — not every button. `lib/theme/colors.ts` (`CHAMPAGNE_ACCENT = '#FFFFFF'`) maps legacy beige values onto white. Both are true at once: champagne governs surfaces and brand chrome, white/alpha governs control state. When in doubt, follow `design-direction.md`.

**Control language** — translucent is the default: rest `bg-white/[0.06]` + `border-white/10`, hover `bg-white/[0.10]` + `border-white/20`, active `bg-white/[0.14]` + `border-white/30`, disabled `opacity-40`. Solid-white fills are a rare single-primary-action exception (floating cart pill, empty-cart CTA, checkout Pay). Icon-only controls carry **no fill at rest** — prominence comes from size and spacing.

**Radii vocabulary:** 8px controls · 12px cards · 20px modals/heroes. Nothing else.

**Other canonical tokens:** `--text-readable #AAA294` (WCAG-AA floor for text a user must actually read — the decorative tertiary fades fail AA), `--text-muted #706B61`, `--error #8d3a2f` / `--error-strong #ff8b73` / `--error-text #ffb7a8`, `--star #FFFFFF`, z-layers `--z-popover 200` / `--z-drawer 220` / `--z-modal 240`, motion `--dur-fast 160ms` / `--dur-med 260ms` / `--ease-spring` / `--ease-decelerate`.

**Alternate theme:** `[data-theme="de-roche-archive"]` is a light inversion of the semantic layer. Anything hardcoded breaks it.

**Generated artwork** — tracks without a cover get a deterministic brand gradient (`lib/artwork/gradient.ts`, seeded by track id — never `Math.random()`, which shimmers on scroll and desyncs library vs storefront). Tag colours in `lib/artwork/tag-colors.ts` (migration 107); per-kind default artwork + producer logo in migrations 108/109.

**DB** — migrations append-only, idempotent (`IF NOT EXISTS`). End each schema change with `NOTIFY pgrst, 'reload schema';`. RLS on every owned table. **Owner-only, not owner-or-null** — mig 097 retired the legacy `user_id IS NULL` allowance and mig 111 adopts remaining orphan contacts onto the owner. Service-role routes bypass RLS, so they must apply the owner filter themselves and must not re-add `,user_id.is.null`. Apply migrations on Supabase BEFORE merging dependent PRs. Highest number on disk = **114**; confirmed-applied baseline = **106** (full clean replay, 2026-08-05). A read-only production check on 2026-09-17 found 107–111 in effect and 112/113 not applied; `supabase/MIGRATIONS.md` has the table, so check it rather than assuming. Number the next new migration **115**. `096/097/098/099` each have two files sharing a number from a past parallel-branch collision — both sides are legitimate and applied; don't renumber them. Always check `git log --all -- supabase/migrations/` before naming, especially from a worktree off a stale base.

**Auth** — Supabase via `@supabase/ssr`, Google OAuth (producer) + magic-link OTP (buyers). Refresh in `src/proxy.ts` (must run on `/api/*`). Public-by-design: `/share/*`, `/projects/share/*`, `/store/**`, `/embed/*`. Service-role key is server-only. Buyer identity is **email**, not a `user_id` — writes go only through `/api/store/me` (RLS blocks direct PostgREST; migration 060).

**CSP** — `src/proxy.ts` applies the strict nonce-based policy from `lib/security/csp.ts`. It is **enforced on `/store` and `/store/*` in production** and **Report-Only everywhere else** (and everywhere in dev, where HMR needs eval). Violations POST to `/api/csp-report`. The split exists because enforcing white-screens prerendered pages: Next's build-time inline bootstrap can't take a per-request nonce, and the whole dashboard plus the auth pages are prerendered. Every /store route is dynamic, and `scripts/ci/check-store-dynamic.mjs` fails CI if one becomes static. Any new external script/frame/connect origin used on a store page must be added to `buildCsp()` or it **breaks in production now**, not just reports. `'wasm-unsafe-eval'` is there for Essentia/audio-decode; dev-mode HMR trips `'unsafe-eval'` — that's a dev-only false positive, do NOT add it.

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
- **A popover opened from somewhere other than its own trigger must take focus.** The project page's ⋯ "Edit tags" opened the tag popover, but the popover never took focus, so `ActionMenu` handed it back to the ⋯ button and a keyboard user was left there while the panel sat portaled at the end of the document. `ui/Popover`'s opt-in `initialFocus` moves focus to the panel's first control on open and returns it to the trigger on close, but only if focus was left in the panel or dropped to `<body>`. `label` makes the panel a named `role="dialog"`. `InlineTagStrip` uses both. The other popovers are opened only by their own trigger and are deliberately unchanged. `cover-art/ContextMenu` had the reverse bug: it took focus on open and never gave it back, so every close left focus on `<body>`. The studio's shortcuts listen on `window` and kept working, which is how this went unnoticed. It now restores focus to what had it before, under the same "only if unclaimed" rule, since a Delete can remove the very layer it was opened on.
- **Tags are `ui/InlineTagStrip`.** Pills remove in one click; adding opens a popover. The name→category lookup is in `lib/ui/tag-groups.ts` because both POST and DELETE need the category and the strip only holds the tag name — sending the wrong one succeeds and changes nothing.
- **The filename is metadata, not just a title.** `lib/upload/title-metadata.ts` reads BPM and key out of a name (`Night Shift 140 Fm.wav`, `beat_142bpm_Gmin.mp3`, `COLD FRONT (Bb maj) 92 BPM.wav`), strips them from the title and feeds them to `mergeFeatures` as the **highest-precedence source**, above client Essentia and server heuristics: a detector halves or doubles a tempo and picks the relative major, while the producer wrote what they meant. All three upload paths use it, and `lib/upload/processing.ts` re-reads the name so the later analysis pass can't overwrite it. It is deliberately conservative — a bare number counts only inside a plausible tempo range and never as a year/`v2`/`808`, and a key needs an accidental or a spelled-out quality. The `Fm` shorthand is matched **case-sensitively** (uppercase note, lowercase `m`), or `FM radio.wav` becomes F major.
- **The uploads tray owns post-upload metadata.** `components/upload/UploadsTray` renames and tags the created track in place, using the `track` the manager stores from `/complete`. Guard both with `canEditUploadedTrack` (`lib/upload/row-actions.ts`): `/complete` can succeed without returning a track, and an editor bound to `undefined` PATCHes `/api/tracks/undefined`. Which buttons a row shows comes from `uploadRowActions(status)` — one source, not five inline conditionals plus a parent-computed `isActive` flag beside the status it was derived from. A row never offers both Cancel and Dismiss; they render the same X and mean opposite things.
- **`/links` rows are the interaction surface; the popup is the detail view.** Copying a share URL is the most frequent action on the page and used to need the popup; renaming needed the popup *and* an edit-mode toggle inside it. The row title is the rename field and the row ⋯ menu holds copy / share / downloads / delete; the popup keeps the full URL, the track list, and the two properties that want a deliberate save (expiry, password) — and shows the same ⋯ menu so nothing is reachable from only one surface. The single-link delete had no confirmation while the bulk delete did, which made the one-click path the destructive one; both confirm now.
- **The two share tables are one branch, in `lib/links/share-link.ts`.** `share_links` is addressed by token, `project_shares` by row id and stores the display name in `label`. That branch was copy-pasted four times on the page. Sending a project share `{ title }` does not fail — the request succeeds, changes nothing, and the optimistic render shows the new title until the next refetch reverts it. `shareLinkEndpoint` / `toSharePatchBody` / `fromSharePatchResponse` / `filterShareLinks` are the single copies, Vitest-covered.
- **Reading a notification is an action, not a side effect of opening the panel.** The bell used to PATCH `action=read_all` on open, so glancing at it cleared everything — check one sale and the other nineteen rows were marked read and gone from the badge. An unread row is now the button that reads it (`?action=read` with ids, Zod-validated, filtered by `user_id` as well as id), and clearing the lot is an explicit "Mark all read". The arithmetic is `lib/notifications/read-state.ts`: decrementing the badge by the ids *passed* rather than the ids that were actually unread drives the count negative on a second click.
- **A clickable list row must not WRAP its slots.** `ui/ListRow` rendered the whole row as a `<button>`/`<Link>`, so every control inside it was nested in one — the trailing "open in new tab" anchor always was, and an inline rename field plus a ⋯ menu made it three. `<button>` inside `<button>` is invalid HTML: React reports a hydration error and the inner control's behaviour is the browser's guess. The row is now a plain element with a **stretched activator** (`absolute inset-0`, `z-0`) beneath `pointer-events-none` content; `leading`/`trailing` and an opt-in `titleInteractive` take pointer events back. The activator has no text, so a clickable row needs a `label`. Only the layout on screen misbehaves, so this hid in the mobile list while the desktop grid (a `div`) was fine — it surfaced in the dev server's log, not in a test or a screenshot.
- **The notification badge is not bounded by the page.** `unread` used to be derived from the same 20 rows the panel fetches, so past 20 it undercounted — the badge could read "9+" against a much larger real number, and "Mark all read" (unbounded server-side) then cleared rows the producer was never shown. It is a separate `head: true, count: 'exact'` query, run in parallel, and falls back to counting the page if only the count fails. The response carries `hasMore` so the panel can say it is showing a page.
- **OS notifications fire only while a tab is open, and that is the whole feature.** `lib/notifications/desktop.ts` + `settings/DesktopNotificationsRow` reuse the existing 60s poll and realtime subscription — no new backend. That realtime subscription was **inert until migration 116**: `TopBar` subscribed to `notifications`, but the table was never in the `supabase_realtime` publication, so nothing was ever broadcast and the bell only updated on the poll. It degraded quietly instead of breaking, which is why it went unnoticed for so long — everything still arrived, just up to 60s late. Rows are written by exactly three things: a completed purchase, a buyer offer, and a fulfilment alert. Real Web Push (alerting a *closed* browser) needs a VAPID key pair, a stored `PushSubscription` per device and a server that signs and sends; do not describe this as push. Two conditions gate it and the settings row names whichever is missing: OS permission granted AND the producer switched it on — permission alone is not consent to keep interrupting. The pref is `localStorage`, deliberately: permission is per-browser, so an account-level flag would claim the studio Mac's answer covers the laptop. The selection rule is pure and tested — the first fetch after load only *primes* (records what exists without firing, or opening the app detonates the whole table), ids already fired are skipped so polling is idempotent, already-read rows are skipped, and a burst over 3 collapses into one summary.
- **Every overlay portals to `<body>`.** TopBar's notification panel was `absolute`, alone among them, so it clipped inside any ancestor with overflow or a backdrop-blur stacking context. It uses `ui/Popover`, which already portals, positions from viewport rect coords, clamps to the screen and closes on Escape and outside click — the same rules `ui/Dropdown` and `ui/ActionMenu` follow.
- **Settings is thin on purpose, but it must not send you through a tombstone.** Its License Builder card links to `/store-editor#licenses` — the canonical builder — not to `/settings/licenses`, whose entire content is a notice saying the builder moved. `/store-editor` reads the URL hash on mount and expands + scrolls to the matching section (`section-<id>` anchors), so any part of the app can deep-link a section instead of dropping the producer at the top of a fourteen-section accordion.
- **Price semantics: blank ≠ free.** `lib/store-editor/beat-row.ts` — `parsePriceInput` returns `null` for an empty field, meaning "inherit the producer's profile default" (mig 021). Storing `0` there publishes a catalogue for nothing. `hasSellablePrice` is the single rule for "does this beat have a price a buyer could pay", shared by the Needs-attention counter and the row filter so the two cannot disagree; it was a closure declared ~800 lines below its first use, which put it in the temporal dead zone the moment anything above it needed the rule.
- Component behaviour of this kind is covered by jsdom tests (`// @vitest-environment jsdom` pragma, `@testing-library/react`). A menu that renders perfectly can still be unusable by keyboard and put Delete next to Rename; neither `tsc` nor `next build` sees it.

**Cover Art effects + type** — two shared modules the studio's two renderers both read:

- **`lib/cover/effects.ts` emits ONE `<filter>` def that both surfaces use.** The canvas inlines it in a hidden `<svg><defs>` and references it with CSS `filter: url(#fx-canvas-ID)`; the exporter inlines the same def and uses `filter="url(#fx-ID)"`. There is deliberately no parallel CSS-filter string to drift. The only legitimate difference is the `scale` argument — `zoom` on the canvas, `1` in the export — because a blur is in document units. `baseFrequency` (grain) DIVIDES by scale where every other length multiplies; getting that backwards makes grain coarsen as you zoom and the export come back finer than what was approved.
- **The filter nests INSIDE the transform, and vignette sits outside the filter.** Filter+clip-path on one element clips the drop shadow away with the crop. Filter outside the transform gives document-space shadows in the export and layer-space on the canvas — two pictures of one layer. Vignette is painted, not filtered, so a blur cannot smear it.
- **`lib/cover/fonts.ts` is the single type registry.** Font handling used to live in four places that disagreed: the exporter hardcoded `font-weight:700` while the canvas set none, `globals.css` maps Synkopy's 700 onto the *Flipside* cut, and only one Panchang weight was ever embedded. `nearestFace` snaps a requested weight to one the family actually ships **before** either renderer sees it, so neither is asked to synthesise. All 11 shipped `.otf` files are reachable; La Bruja is now registered in `globals.css`.
- **Artboard resizing scales effects too** (`lib/cover/artboard.ts`). Blur/shadow/glow/chromatic are document units — a 24-unit blur is a haze at 3000px and a smear at 1080px.
- **Export settings resolve honestly** (`lib/cover/export-settings.ts`). A transparent JPEG gives you a BLACK plate, so `resolveExport` drops the request and reports it in `notes` for the UI to surface rather than silently doing something else.

**Cover Art moods** (`lib/cover/restyle.ts`) — `restyleDocument` changes how existing work FEELS without replacing it: typography, effects and palette move together, while positions, sizes, text and image sources stay put. Distinct from `coverArtDirections`, which call `createArtworkDocument` and throw the layer stack away. Deliberately NOT a model call: a mood is a curated set of parameter choices, so this is instant, free, offline, identical every time and one undo step, where an LLM emitting layer JSON would be slower, cost per press and occasionally fail to parse. Tracking is SCALED not set, `fx` is merged with the mood winning on keys it names, and locked layers and groups are skipped (a group holds no pixels; restyling its wrapper would double the effect on its contents).

**Cover Art grid + safe areas** (`lib/cover/overlay.ts`) — both are VIEW state held by `CoverArtStudio`, never on the document, which is why the exporter cannot draw them by mistake (ruler guides need a test for that; these need none). The grid DIVIDES the artboard rather than stepping in fixed units, because `resizeArtboard` moves a cover between 1400 and 3000 while it is being designed and a 100-unit grid means something different either side of that. Grid snap lines ride the same `guides` argument of `collectSnapTargets` as ruler guides rather than getting a pass of their own — a separate pass would let a layer snap to a grid line on x and a guide on y and land on neither. Safe-area insets are a fraction of the SHORTER side so a non-square artboard gets an even margin; `crop` presets show the largest centred rect of a target aspect, i.e. what survives being re-cropped for a feed post or a thumbnail. The grid paints UNDER the layers (a scaffold you place work against) and the safe area OVER them (the whole point is seeing what falls outside it).

**Cover Art groups + rulers**:

- **Nesting is a `parentId` pointer on the flat `layers` array, not a `children` tree.** Every existing consumer that walks `document.layers` still sees every layer. Children keep ABSOLUTE document coordinates — a group is a wrapper for opacity/blend/organisation, NOT a coordinate space, which is the only reason `lib/cover/geometry.ts` needs no knowledge of groups.
- **`expandToLeaves` is the load-bearing function.** Move, resize, align and snapping all run on it, so a selected group contributes no rect of its own and its stored rect never has to be kept in sync. `beginMove` also keeps a group selected when the press lands on one of its descendants — without that, grabbing a group's contents replaced the selection with the child under the cursor and a group could never be dragged.
- **Both renderers recurse.** A group emits a wrapper with opacity+blend and NO transform (children are absolute; transforming the wrapper would move them twice). On the canvas the wrapper is `pointer-events:none` and every leaf sets `auto`, or a group blankets the artboard and swallows clicks.
- **Deleting a group deletes its descendants**, and `moveLayer`/`reorderLayer` operate within a sibling set — both merge back into the full array. Returning just the sibling set drops every other layer from the document. `descendantIds`/`isDescendantOf`/`layerRows` all carry cycle guards.
- **Guides live on the document but the exporter never reads them** — that is enforced by a test asserting the SVG is byte-identical with and without guides. Collapsing a group goes through `setDocumentQuietly`, since folding a panel is not an undo step.
- **A guide drag is computed from a snapshot taken at drag start.** Reading the live document mid-drag is a race: two pointermoves can fire before React flushes, so the second reads the pre-move list, fails to find the guide at its updated origin, and leaves a duplicate at every position the pointer passed.

**Cover Art text-on-path** (`lib/cover/text-path.ts`) — `<textPath>` has no DOM equivalent, so the canvas renders curved text as an inline `<svg>` in document units (the same trick the waveform layers use) and both surfaces run the IDENTICAL `d` string through an identical `<textPath>`. A test asserts the exported `d` equals `textPathD(...)` for every shape; that equality is the whole "no approximation to drift" claim. A path is a single run — `flattenForPath` joins lines with spaces rather than silently dropping all but the first, and the inspector says so when the text contains a break. `startOffset` and `text-anchor` must agree or the string runs off the end of the path.

**Store Editor — the storefront layout document** (`lib/store-editor/layout.ts`, `components/store-editor/*`, migration 113):

- **`/store` renders its sections from the layout.** `defaultStoreLayout()` reproduces the page's original hardcoded order exactly, and `normalizeLayout` turns null/older/malformed documents into it — so a producer who never opens the builder sees no change. There is a test asserting that order; if it drifts, every un-arranged storefront silently rearranges.
- **Overrides are sparse and desktop writes the base.** `resolveSection` layers `defaults → base → breakpoint`. Editing on desktop writes `base` so it flows down; tablet/mobile write only the keys they change. Replacing the object wholesale resets everything the breakpoint did not name.
- **`sectionCapabilities` keeps controls honest.** The storefront components own their own padding and responsive grids, so spacing/columns are offered only for sections this feature actually lays out. A control the preview obeys and the live page ignores is worse than no control.
- **Visibility is CSS, not a JS branch** (`visibilityClasses`) — `/store` is SSR'd and edge-cached, so branching would bake one device's layout into the cached HTML. `useStoreBreakpoint` exists only for the hero, where the two variants are different *components* (the particle canvas must not run on a phone at all).
- **`catalog` and `trust` are pinned** (`isPinnedSection`). The catalogue owns the sticky filter toolbar directly above it. The document itself refuses to move them rather than accepting a drag the storefront would ignore.
- **Free-form blocks are percentages of their section frame** (`lib/store-editor/canvas-blocks.ts`), never pixels — that is what stops a hand-composed panel hanging off a phone, and it means the drag maths needs no zoom argument: a scaled element's `getBoundingClientRect()` is already in screen pixels, so a ratio against it is correct at any zoom. Clamping is against the block's own size, so a wide block stops when its RIGHT edge reaches the frame. `SectionRenderer` takes editing as an OPTIONAL `editBlocks` prop the storefront never passes, so the capability is absent on the live page rather than switched off.
- **One module opens the Store Editor's IndexedDB** (`lib/store-editor/db.ts`). Versions are per-DATABASE, not per-store, so history opening at v1 while the saved-section library opened at v2 would throw `VersionError` — and which feature the producer touched first would decide whether the other worked. Adding a store means bumping the version there once and extending the one upgrade handler, which creates only what is missing.
- **A saved section stores everything EXCEPT its id and lock** (`lib/store-editor/library.ts`). Reusing an id would put two sections in one layout under one key: the second insert shadows the first in every lookup and `updateSection` edits both. The id is minted on insert, which is what makes "insert twice" ordinary.
- **Copying a style never copies visibility** (`lib/store-editor/section-style.ts`), and paste is filtered through `sectionCapabilities` so a style from a text block lands on a hero as only what the hero honours. Pasting also merges into existing overrides rather than replacing them, or a style mentioning only spacing would wipe a tablet alignment the target had.
- **Version history is IndexedDB, per-browser** (`lib/store-editor/history.ts`, DB `antigravity-store-editor`). Snapshots are taken AFTER the server accepts a save, so history never offers a version that was never stored, and `shouldSnapshot` declines both unchanged layouts and anything within `SNAPSHOT_MIN_GAP_MS` — without that, autosave during a slider drag fills the history with near-identical entries and evicts everything worth restoring. `sameLayout` ignores `updatedAt` deliberately, since it changes on every keystroke. Restoring goes through `commit`, so it lands on the undo stack rather than needing a confirmation dialog. The panel degrades to a notice when IndexedDB is denied (private browsing) rather than taking the builder with it.
- **Multi-select is an ordered id list whose LAST entry is the primary** (`lib/store-editor/bulk.ts`). The inspector edits the primary and shift-click extends from it, so both follow the pointer rather than staying pinned to wherever the selection started. A bulk setting write goes through `applySettingToSections`, which skips kinds that would ignore the key — writing a setting the live storefront does not honour is the defect `sectionCapabilities` exists to prevent, and doing it to six sections at once does not improve it. `describeScope` is why the inspector says "4 of 6 sections": a control that silently applies to half of what is highlighted is worse than one that admits it. `duplicateSections` runs bottom-up because each copy is inserted directly after its source, so a top-down pass would keep re-encountering fresh copies and interleave the result. The canvas and the section stack share one selection and one set of modifiers.
- **`store_layout` is fetched in its own query** in `/api/store`. Folding it into the existing newer-columns select would fail that whole select — and silently drop accent colour, socials and voice tags from every storefront — on any deploy where migration 113 has not been applied.

**Library paging** — the library filters in the browser over the tracks loaded so far (pages of 100). `/api/tracks` returns `pageInfo.total` on the first page only, and `lib/library/load-more.ts` drives a footer that says "N of M", auto-loads on scroll, offers "Load all", and warns when active filters have only seen part of the catalogue. Rating filters (`lib/library/rating.ts`) support at-least / exactly / unrated.

**Share variants** — `recipient_kind ∈ {client, producer, rapper, friend}` drives which `components/share/variants/*` renders.

**Storefront** — `/store` is public-by-design. Tracks listed when `tracks.store_listed = true`; projects featured when `projects.store_featured = true`. Buying:
- **Track licenses** — `BeatCard` / `BandcampRemixCard` (type=remix) / `MusicPortfolio` row → preview drawer → cart (`useCart`) → `/store/checkout` → embedded Stripe (`createEmbeddedCheckoutPage`) → webhook (`purchase_kind: 'track_license'`) → `license_purchases` row + Resend delivery email pointing at `/store/download?session_id=…`.
- **Project bundles** — `/store/projects/[id]` → "Buy bundle" → `/store/checkout?project_id=…` → embedded Stripe (`purchase_kind: 'project'`) → webhook writes `project_access_links` (token + frozen `amount_usd` from `session.amount_total`) → delivery email points at `/store/projects/access/<token>`.
- **Promo codes** — `promo_codes` table; `/api/store/promo` validates; checkout server distributes discount across line items (percent → uniform per-line; flat → proportional split; min unit_amount = $0.01).
- **Filter + sort logic lives in `lib/store/filters.ts`** (`filterAndSortTracks`) — pure function, Vitest-covered. Page useMemo delegates to it. Don't re-inline; the test suite is what catches AI revert wipes.
- **Wishlist** — `useWishlist` (Zustand + localStorage, key `antigravity-wishlist`). Optional `isWishlisted` / `onToggleWishlist` props on `BeatCard` / `BandcampRemixCard` / `MusicPortfolio` rows.
- **Cart** — `useCart` (Zustand + localStorage). `CartDrawer` stays mounted (`open` prop) instead of unmounting on close — preserves email + promo input across navigation.
- **Buyer accounts (opt-in)** — magic-link OTP or Google at `/store/account`; favourites, listening history and playlists keyed on **email**, written only via `/api/store/me` (migration 060). The legacy 24h `/store/account/[token]` delivery link reads the same email-keyed rows (`/api/store/account/[token]`, `/api/store/me?token=`), so a signed-in buyer and a token holder with the same email see the same purchases and library; no merge step is needed.
- **Funnel telemetry** — `/api/store/event` + `/api/store/play` feed `store_events` (migration 097); aggregation logic is pure in `lib/store/funnel.ts`. Social proof ("N sold this week") comes from `lib/store/momentum.ts`.
- **Store readiness** — `lib/store/readiness.ts` splits HARD blockers (not listed, no price — literally unpurchasable) from conversion issues (no cover/tags/metadata). Keep that split; a diagnostic that overstates gets ignored.
- **Exclusive sale race** — the webhook claims exclusivity with an atomic conditional `UPDATE … WHERE exclusive_sold = false … RETURNING` and flags the losing buyer via `license_purchases.needs_refund_review` (migration 106), surfaced on `/sales` with "Mark reviewed" (`POST /api/sales/resolve-refund-review`). **No Stripe refund API call exists anywhere in this repo** — refunding stays a manual producer action in the Stripe dashboard.
- **Exclusive delivery gate** — both checkouts (`/api/store/checkout` and `/api/share/[token]/checkout`) run `licenseAvailability` (`lib/store/license-availability.ts`) per line item and 409 when exclusive rights already sold, or when an exclusive / stems-included tier targets a beat with neither `wav_url` nor ready stems. The share route skipped this until 2026-09; a share link sold what the store refused. So buyer checkouts always send `stems_pending_track_ids: ''`. The one path that still sets it is an **accepted offer** (`/api/store/offer/[id]`), where the producer agrees to the sale knowingly; the webhook then flips `license_purchases.needs_stems_upload = true` (mig 052), emails the producer, and `/sales` shows "Awaiting stems".

**Stripe** — Two checkout surfaces:
- Share-page checkout — `/api/share/[token]/checkout`, buy gated on `share.sales_enabled === true`.
- Store checkout — `/api/store/checkout`, cart-mode and project-mode in one route.

Common: `ui_mode: 'embedded_page'` (server); `stripe.createEmbeddedCheckoutPage({ clientSecret })` (client). Webhook (`/api/stripe/webhook`) signature-verified via `req.text()` (NOT `req.json()`); idempotent on `processed_stripe_events` (event-level) and `license_purchases.stripe_session_id` / `project_access_links.stripe_session_id` (purchase-level). Branches on `metadata.purchase_kind ∈ {track_license, project}`. Health check: `GET /api/stripe/diagnostics`.

**Cron** — `vercel.json` schedule, route validates `Authorization: Bearer ${CRON_SECRET}` before any work. All twelve routes in `api/cron/` are scheduled in `vercel.json`, and **all run once a day** because the Vercel Hobby plan allows nothing more frequent. Time-sensitive ones are also hit every 15 minutes by `.github/workflows/frequent-crons.yml` (`publish-scheduled`, `process-uploads`); it needs `CRON_SECRET` and `APP_URL` repo secrets and exits quietly without them. Every cron route must therefore stay idempotent. New uploads don't wait for any cron: `/api/upload/complete` processes the queued job in `after()`, and `process-uploads` is the retry path, reclaiming jobs whose `processing` lock is older than 15 minutes. Region is `cdg1`.

## Commands
```bash
npm run dev            # next dev (Turbopack)
npm run build          # next build (includes tsc --noEmit)
npm test               # vitest run
npm run test:scale     # the catalogue-scale perf specs only
npm run lint           # eslint
npm run e2e            # playwright (e2e/), also :headed / :ui
npm run db:migrate     # scripts/apply-migrations.sh — needs SUPABASE_DB_URL
npm run readiness:prod # scripts/ops/production-readiness.mjs
git config core.hooksPath .githooks    # one-time: enable local pre-commit
```

CI: `.github/workflows/ci.yml` runs `tsc --noEmit` → `vitest` → `next build` on push to `main` and on every PR.

## Env vars
**Required prod:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (public derivatives/assets), `R2_PRIVATE_BUCKET_NAME` (masters/WAV/stems), `NEXT_PUBLIC_R2_PUBLIC_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL=https://uche-beatstore-g.vercel.app`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `CRON_SECRET`.

**Optional:** `MOISES_API_KEY` (legacy stems), `DEMUCS_SERVICE_URL` (current stems service), `NEXT_PUBLIC_AUDD_API_TOKEN`, `ENABLE_LOCAL_STORE=true`, `RESEND_WEBHOOK_SECRET` (`whsec_…`; enables `/api/resend/webhook` open/click tracking → `beat_sends.opened_at/link_clicked_at`. Unset = route accepts events without signature verification, dev only), `NEXT_PUBLIC_R2_CDN_URL` (Cloudflare-cached custom domain in front of the R2 bucket, e.g. `https://cdn.uche-beatstore.com`; when set, the bottom player's `SimpleAudioEngine` streams previews from it instead of `r2.dev`. Unset = direct `r2.dev` public URL — still bypasses the `/api/audio` proxy, just not edge-cached. See `lib/audio/cdn.ts`), `SHARE_MEDIA_TOKEN_SECRET` (HMAC secret for signed share preview/peaks grants — falls back to `SUPABASE_SERVICE_ROLE_KEY`, and **throws in production** if neither is set), `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE`, `LOG_LEVEL`, `FFMPEG_BIN`, `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` (either of the first two enables AI image generation in the Cover Art Studio; read server-side only — `/api/cover/generate` reports which are configured and never accepts a key from the browser), `SUPABASE_DB_URL` (only for `npm run db:migrate`), `READINESS_BASE_URL`.

**Player audio path** — `tracks.audio_url`, `wav_url`, and stem URLs may be opaque `r2://bucket/key` references. Dashboard playback resolves those through authenticated `/api/audio`; public store playback uses `tracks.preview_url` through `/api/store/preview/[id]`. Never expose or rewrite a private `r2://` reference into public JSON. Public derivatives can still use `NEXT_PUBLIC_R2_CDN_URL`.

## Dashboard config (prod)
- **R2 CORS** must include `https://uche-beatstore-g.vercel.app` for `GET/PUT/POST/HEAD` — else "waveform unavailable."
- Direct multipart upload also requires the private bucket CORS policy to allow `PUT` from the production origin and expose the `ETag` response header.
- **R2 buckets:** `R2_BUCKET_NAME` is public and contains previews/covers/peaks/voice tags. `R2_PRIVATE_BUCKET_NAME` must have no public development URL and contains masters/WAV/stems. Any cloud-backed audio upload fails closed when the private bucket variable is missing; local filesystem fallback is only used when R2 itself is not configured.
- **Supabase Auth URL config:** Site URL = prod domain; Redirect URLs include `/auth/callback` and `/**`.
- **Google OAuth:** authorized redirect URI is the SUPABASE callback (`https://<ref>.supabase.co/auth/v1/callback`), not your domain.
- **Stripe webhook:** `/api/stripe/webhook` subscribed to `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`.

## Gotchas
- **The palette in an old CLAUDE.md is not the palette.** `#D4BFA0` burnt amber was replaced app-wide; an agent styled against it and shipped wrong colours. Read `src/app/globals.css` + `docs/design-direction.md`, and see "Colour + design tokens" above — the measured table there is what components actually use.
- **Three source-text guard tests exist and they are load-bearing** — they catch defect classes `tsc`, ESLint and a green build all miss:
  - `lib/ui/tailwind-classes.test.ts` — malformed opacity modifiers (`ring-white/30/40`, `border-white/`) compile to *nothing*. A scripted colour migration once introduced 167 of them, killing focus rings on store cards and checkout.
  - `lib/ui/reduced-motion.test.ts` — any `animate-pulse` / `animate-bounce` not gated on `useReducedMotion()` (allowlist for genuinely transient loading feedback).
  - `lib/source-hygiene.test.ts` — raw control characters in source. A literal NUL byte makes `grep` treat the file as binary and `git diff` unreviewable.
- **Don't script a styling migration.** One documented incident left 144 dead Tailwind classes, another the 167 malformed modifiers above. Hand-edit, or write a guard test first.
- **CSP is enforced on /store in production** — a new CDN script, iframe or worker origin on a store page that isn't in `buildCsp()` (`lib/security/csp.ts`) silently fails there while dev looks fine. Elsewhere it is still Report-Only.
- **Public store media must never carry a private URL.** `lib/store/public-media.ts#redactPublicTrackMedia` nulls `preview_url` / `wav_url` and swaps `audio_url` for the public preview derivative (CDN direct when configured, `/api/store/preview/[id]` otherwise). Share pages use short-lived HMAC grants (`lib/share-media-token.ts`, 15-min TTL) — routing public share media through the session-gated `/api/audio` proxy is a bug we've already shipped and fixed.
- **Pure logic goes in `lib/`, not in the component.** This project has silently reverted in-component logic more than once. Established pure modules: `store/filters.ts`, `store/discount.ts`, `store/readiness.ts`, `store/momentum.ts`, `library/triage.ts`, `library/columns.ts`, `dashboard/action-digest.ts`, `ui/toast-queue.ts`, `artwork/gradient.ts`. Extend one rather than inlining a new copy.
- **Triage state is derived, not stored** (`lib/library/triage.ts`) — no status column, so it classifies the whole back catalogue retroactively. Don't "fix" it by adding a column.
- **Overlays need `useDialogBehavior`** — dialogs get the full focus trap, menus/popovers get `trapFocus: false` (trapping a dropdown strands keyboard users). ~25 overlays are already retrofitted; a new one that skips it is inconsistent, not just unpolished.
- **Buyer emails are matched lowercased.** `contacts.email`, `license_purchases.buyer_email`, `buyer_favorites.email` and friends key the buyer→contact link. Normalise with `normalizeEmail` from `lib/contacts/email.ts` on **every** write — `contacts_user_email_uniq (user_id, email)` is case-sensitive, so raw casing forks one human into two contacts and makes their orders unfindable via `/store/orders`.
- **Upserting contacts?** The only unique index is `(user_id, email)`. `onConflict: 'email'` raises Postgres 42P10 — and because supabase-js *resolves* with `{ error }` rather than throwing, a bare `try/catch` never sees it. Destructure `.error` and log it.
- `"Could not find column X in schema cache"` → run `NOTIFY pgrst, 'reload schema';`, wait 10s.
- **PostgREST `.or()` interpolation footgun** — commas inside a value break the filter because PostgREST treats them as condition separators. Validate any interpolated id (e.g. `safeSellerId()` in `/api/store/route.ts` for UUIDs) before building the filter string.
- **Stripe SDK renames have bitten us twice.** Server: `ui_mode: 'embedded'` is removed → use `'embedded_page'`; `automatic_payment_methods` is rejected for embedded sessions, drop it. Client: `initEmbeddedCheckout` was removed in `@stripe/stripe-js@9.x` → use `stripe.createEmbeddedCheckoutPage({ clientSecret })`. Use the typed call (no `as any`) so the next rename fails at compile time.
- **The `(dashboard)` group requires auth via `src/proxy.ts`**; `(auth)` and `store/*` do not. Easy to put a new page in the wrong group and either expose private data or 401 a public visitor.
- **`prefers-reduced-motion` matters** — `MusicArtwork`, `ParticleText`, `MusicPortfolio`, the cosmos `.track-masonry` fade, and the vinyl spin all gate animation on it. Respect that pattern in new visual components.
- Don't add `window.scrollY` to fixed-positioned portals. Bounding-rect coords are viewport-relative.
- `npm run dev` is permissive about imports; `npm run build` (and CI) catches them. Always build before PR.
- Two share routes: legacy `/share/[token]`, modern `/projects/share/[token]`. New work in the latter.
- If new code depends on an open PR, branch off that PR — not `main`.
- **shadcn/ui is vendored in `components/shadcn`, NOT `components/ui`.** `components/ui` holds the hand-rolled `Button`/`Card`/`Drawer`/`Popover`/`Slider`/`Skeleton`, and macOS is case-insensitive — `shadcn add button` into that folder overwrites `Button.tsx`. `components.json` points the CLI at `components/shadcn`. shadcn components import `cn` from `@/lib/cn` (clsx + tailwind-merge, taught the app's `text-meta`/`text-eyebrow`/`text-micro`/`text-row-title` sizes); the app's own `cn` in `lib/utils` stays a plain joiner — default tailwind-merge reads `text-meta` as a colour and drops it. Colours come from the `--color-*` mapping in `globals.css`; raw values are `--sc-*` so the older `--accent`/`--success` meanings are untouched. The `--radius-*` scale is deliberately NOT remapped (757 existing usages). Prefer `shadcn view <name>` over `add`, which can rewrite `globals.css`.
- IndexedDB owns audio blobs; service worker owns app shell. Keep them separate.
- **Worktree contamination** — sub-agents have created `.claude/worktrees/agent-*` that get locked on crash. Cleanup: `git worktree unlock <path>` → `git worktree remove --force <path>` → `git branch -D worktree-<id>`.
- **Migration numbering races** — when two parallel branches both add migrations, both will claim the next number. Check `git log --all -- supabase/migrations/` before naming. We renumbered 040/041 → 046/047 once already.
- **SVG-as-image is a sandbox.** Anything rasterised via `new Image()` — cover art export, share cards — cannot fetch *any* external resource: no fonts, no stylesheets, no cross-origin images. Inline it as a data URI or it will silently render wrong while the on-screen version looks right.
- **Panchang has no glyph for the shift (U+21E7) or option (U+2325) symbols.** They render as tofu. Spell out "Shift" and "Alt" in keyboard hints; the command symbol is fine.
- **`coverArtExportPresets` is a Record keyed by id, not an array.** `Object.values()` it before mapping.
- **A centred overflowing scroll container clips its own start edge.** `place-items: center` makes the top/left of a zoomed-in artboard unreachable; use `place-items: safe center`.
- **`tailwindcss-animate` is not installed, and 54 classes were pretending otherwise.** `animate-in`, `fade-in`, `slide-in-from-*`, `zoom-in-*` across 34 files emitted no CSS at all — Tailwind v4 here, a bare `@import "tailwindcss"`, no `@plugin`. Every popover, dropdown, menu, toast and modal hard-cut into existence while the markup claimed a considered entrance. The real utilities live in `globals.css` and use the app's own `--dur-*`/`--ease-*` tokens: `ui-pop` (panel below its trigger), `ui-pop-up` (above it, or rising from the bottom), `ui-fade-in`, plus the existing `ui-modal-panel` / `ui-scrim` / `ui-drawer-*`. All are switched off under `prefers-reduced-motion` — the plugin classes never were, so this was also a motion-sensitivity gap. `lib/ui/tailwind-classes.test.ts` guards it; the scan strips comments first, because the words appear in prose too and the first version reported five comments as violations.
- **Write `-webkit-` before the standard property in hand-written CSS.** `globals.css` had `backdrop-filter` then `-webkit-backdrop-filter`. The production minifier keeps the later declaration and drops the earlier standard one, and Chrome does not support `-webkit-backdrop-filter` (`CSS.supports` is false). So in production Chrome the toasts, the glass play button and the overlay surface had **no blur**, while dev CSS, which isn't minified, looked right in every screenshot. Tailwind's `backdrop-blur-*` utilities already emit prefixed-first. `lib/ui/css-prefix-order.test.ts` guards it. To verify glass, run `next build && next start` and check `getComputedStyle(el).backdropFilter`; a dev server can't show this bug.
- **Anchored overlays share one material, `.overlay-surface`.** Popover, ActionMenu, Dropdown and the cover-art ContextMenu each had their own background (70% / 95% / 95% of another black / solid), border, shadow and radius. They now use the toast glass at 88% (72% let busy artwork show through menu labels), `rounded-xl`, `border-white/[0.12]`, rows inset with `mx-1 rounded-lg` and an `bg-white/[0.08]` highlight, and danger in `text-red-400` / `bg-red-500/10`. As with `.toast-surface`, don't put a `bg-*` utility or a `border` shorthand next to the class: the unlayered rule overrides `bg-*`.
- **A doubled opacity modifier paints nothing** — `bg-white/[0.04]/70`, `hover:bg-white/90/[0.04]`, `ring-white/30/40`, `bg-white/[0.02]/[0.98]`. Either half can be plain or arbitrary; Tailwind parses none of them and the class computes to `rgba(0,0,0,0)`. All four permutations were live at once: 52 of the `[…]/70` form across 30 files, then 6 more of the `90/[…]` form on the white close buttons in the links page, both share modals, the store list row and the store sidebar. `lib/ui/tailwind-classes.test.ts` missed each new shape until its pattern was widened to cover every permutation in one regex — narrow it again and a fresh population will hide behind it. They are residue of the scripted colour migration (3fe5698), which rewrote `bg-[#171511]/70` → `bg-white/[0.04]/70`; the fix is to DROP the leftover modifier, not multiply the two — multiplying makes the surface darker than every sibling the migration handled correctly. Watch for a rest state that ends up identical to its `hover:`, and for a second contradictory `hover:bg-*` left on the same element.
- **AGENTS.md is the product spec, not a build-order prompt.** Update it when you change the product, not when you change the code.

## Adding a feature
1. **Migration first** (if schema change): `supabase/migrations/NNN_descriptor.sql`, idempotent, ends with `NOTIFY pgrst, 'reload schema';`. Apply on Supabase before merging dependent code.
2. **Zod contract** in `lib/contracts/` for any mutation body.
3. **Route handler** — owner-gated (`requireRowOwnership` / `requireUser`), Zod-validated, `errorMessage(err)` on failure, `createLogger('api.x.y')` for diagnostics.
4. **Pure-logic extract** — when the feature has filter / sort / scoring / pricing logic, write it as a pure function in `lib/` first (`filterAndSortTracks` is the template). Vitest the helper. **Logic inside React components can't be tested in isolation and gets silently reverted** — we've shipped this regression twice.
5. **UI** with existing semantic tokens (no new colours, no hardcoded hex, no new font imports) — check it against `docs/design-direction.md` and the radii/control-language rules above.
6. **Wire on the page**; update `lib/types/` if a public shape changed.
7. **`npm run build && npm test`** locally (the guard tests in `lib/ui/` and `lib/source-hygiene.test.ts` run here and catch what `tsc` can't); `npm run e2e` when a storefront or project/playlist flow changed. Pre-commit hook (if enabled) double-checks staged TS.
8. **PR** with Summary / Why / Test plan / Required prod config / Migrations to apply. CI (`.github/workflows/ci.yml`) will gate the merge.

## API map (high-level, public + dashboard)
Roughly 200 route files — this is the shape, not the inventory. `find src/app/api -name route.ts` is the source of truth.
- **Public storefront** — `/api/store` (catalogue), `/api/store/[id]`, `/api/store/facets`, `/api/store/drops`, `/api/store/momentum`, `/api/store/playlists/[id]`, `/api/store/projects/[id]`, `/api/store/projects/access/[token]{,/download,/peaks}`, `/api/store/projects/access/by-session`, `/api/store/producer/[slug]`, `/api/store/checkout`, `/api/store/promo`, `/api/store/offer{,/[id]}`, `/api/store/contact`, `/api/store/follow`, `/api/store/comments/[trackId]`, `/api/store/delivery`, `/api/store/download-file`, `/api/store/free-download{,s}`, `/api/store/orders{,/resend}`, `/api/store/event` + `/api/store/play` (funnel telemetry).
- **Buyer accounts** — `/api/store/account/request` (magic link), `/api/store/account/me`, `/api/store/account/portal`, `/api/store/account/[token]` (legacy 24h token), `/api/store/me` (sole write path to favourites / history / playlists).
- **Public media** — `/api/store/preview/[id]`, `/api/store/peaks/[id]`, `/api/share/[token]/preview/[trackId]` + `/peaks/[trackId]` (HMAC-signed grants).
- **Public share** — `/api/share/[token]/{route,play,download,checkout,analytics}`, `/api/projects/share/[token]/{route,tracks,comments}`.
- **Producer (auth)** — `/api/tracks` (+ `/[id]/{analyze,announce,arrangement,heatmap,lyrics,peaks,rate,similar,tags,shares,versions,stem-files,stems/upload}`, `/auto-tag`, `/reorder`, `/stats`, `/store-summary`, `/tags/bulk`), `/api/projects`, `/api/playlists`, `/api/smart-playlists`, `/api/contacts` (+ `/tasks`, `/segments`, `/scores`, `/import`, `/tags/bulk`), `/api/beat_sends`, `/api/campaigns`, `/api/calendar`, `/api/events`, `/api/profile{,/voice-tag}`, `/api/licenses`, `/api/track-licenses`, `/api/promo-codes`, `/api/sales` (+ `/deliver-stems`, `/resend`, `/resolve-refund-review`), `/api/analytics`, `/api/links`, `/api/notifications`, `/api/team`, `/api/tags/colors`, `/api/cover/generate`, `/api/upload/*` (+ `/image`, `/status`), `/api/stems/*`, `/api/search`, `/api/activity`, `/api/whoami`, `/api/invite`, `/api/email`, `/api/words`, `/api/privacy/erase`.
- **Webhooks, cron + diagnostics** — `/api/stripe/webhook`, `/api/resend/webhook`, `/api/cron/*` (see Cron above), `/api/stripe/diagnostics`, `/api/audio/diagnostics`, `/api/stems/health`, `/api/health`, `/api/csp-report`.
