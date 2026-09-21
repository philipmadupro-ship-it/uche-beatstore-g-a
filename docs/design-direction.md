# Antigravity Design Direction — "Quiet Luxury"

The master visual prompt for all UI passes. Every restyling change must trace back to a
principle here. Product owner's brief: the current UI is **too busy** — dense, over-decorated,
"bazaar" energy. Target: **simple, luxury, Apple / Untitled UI restraint** — while keeping
every feature, flow, and accessibility affordance exactly as it is.

## North stars

- **Apple**: one idea per screen region; whitespace is the luxury; controls are quiet until needed.
- **Untitled UI**: disciplined type scale, 2–3 radii, subtle 1px borders OR background steps — never both fighting.
- **Spotify**: content (covers, titles) is the interface; chrome recedes to near-invisibility.

## Principles (apply in order)

1. **Reduction over decoration.** Each screen keeps ONE hero moment. Demote or delete
   competing gradients, glows, rings, duplicate badges, and decorative chips. If an element
   doesn't help the user decide or act, it earns removal.
2. **Typography carries the luxury.** Fewer sizes per screen (target ≤ 4 text styles visible
   at once). Generous line-height and letter-spacing discipline. Mono-uppercase micro-labels
   ONLY for true metadata (BPM, key, date) — never for headings or buttons.
3. **One accent, and it marks state — not every button.** `#FFFFFF` (and its alpha steps) is
   the single accent. It signals **state**: active, playing, selected, focused. It is *not* a
   button surface. Kill decorative multi-accent usage (`#9d95e8`, `#7F77DD`, `#D6BE7A` etc. as
   card tints). Semantic exceptions stay: mint `#6DC6A4` = free, gold `#c8a84b` =
   rating/wishlist, warm `#c8a47a` = musical key.

   See **Control language** below for how this cashes out in buttons and chips — the short
   version is that a solid white fill is rare and earns its place, and everything else is
   translucent.

   > **History.** This originally specified a warm `#D4BFA0` accent; the beige→white/alpha
   > migration replaced it app-wide and that direction was kept. The *warm* palette still
   > governs surfaces and text (principle 4) — it is the accent specifically that is white.
   > Amended again after that migration produced a wall of solid-white buttons, which was not
   > the intent. The producer's storefront accent picker (`ACCENT_PRESETS`, profile swatches)
   > is a separate, user-controlled setting and is out of scope for this rule.
4. **Flatter, calmer surfaces.** Prefer background steps (`#0a0907 → #14110d → #171511`) over
   border+shadow stacking. Max one border OR one shadow per element. Radii vocabulary: 8px
   (controls), 12px (cards), 20px (modals/heroes) — nothing else.
5. **Density down, breathing room up.** Increase padding, reduce items-per-row where cramped,
   move secondary metadata behind hover/detail/drawer instead of stacking it inline.
6. **Calm motion.** Fades and small translates only; no bouncing, no spinning decoration.
   `prefers-reduced-motion` disables everything non-essential (existing rule, keep).
7. **One anatomy per pattern.** Every card looks like every card; every list row like every
   list row; every modal like every modal. Divergence needs a functional reason.

## Control language

Reference: Spotify's chrome — grey translucent pills, nothing shouting. The rule:

**Translucent is the default.** Every button, chip, toggle, and transport control:

| State | Treatment |
|---|---|
| Rest | `bg-white/[0.06]` + `border border-white/10` |
| Hover | `bg-white/[0.10]` + `border-white/20` |
| Active / selected | `bg-white/[0.14]` + `border-white/30`, text at full white |
| Disabled | `opacity-40`, no colour change |

**Solid white (`bg-white text-black`) is reserved for exactly one primary action per view** —
the thing you want the buyer to press: *Add to cart*, *Buy bundle*, *Checkout*. Never for
transport controls, filter chips, tabs, toggles, status pills, or badges. If a screen has two
solid-white buttons, one of them is wrong.

**Chips and filters** follow the same scale: translucent grey pill at rest, filled only when
active. An active chip is `bg-white/[0.14]`, not `bg-white`.

**Icon-only controls** (transport, close, overflow) carry no fill at rest at all — icon plus
hover wash. Prominence comes from **size and spacing**, not from a filled disc.

**Status badges** are text + hairline border, never a solid fill. A "Live" or "Exclusive" pill
is `border-white/20 text-white/70`, not black-on-white.

> **Why this exists.** The beige→white migration mechanically converted every accent-coloured
> button into `bg-white text-black font-semibold shadow-md`. That is why solid white was
> everywhere — it was a side effect of a find-and-replace, not a design decision. Treat any
> remaining `text-black bg-white font-semibold shadow-md` cluster as migration residue.

## The beat preview player

The audition surface (Now Playing card, store preview drawer, share drawer) has its own
reference, taken from a producer-tool player the owner supplied:

- **Waveform is continuous and mirrored**, not discrete bars — fine per-column detail rendered
  about a centre axis, so the shape actually corresponds to the audio.
- **Coloured by frequency content** (low/mid/high band energy), the way a DAW spectral view is.
  Colour is information here, which is why it is exempt from principle 3's one-accent rule.
- **A readout rides the waveform**: `−46.8 dB · 405.2 Hz · G#4 −43¢`, monospace, tabular-nums.
- **Playhead** is a thin full-height line. No glow.
- Beneath: `title`, then `artist · BPM · key`; then a hairline progress line with elapsed left
  and **remaining** (`−2:35`) right.
- **Transport is plain icons.** No filled play disc — per the control language above.
- **Cover art** is the visual anchor; the waveform sits below it, never painted over it.

Explicitly *not* taken from the reference: its light card. Our dark surface stays.

## Hard constraints (unchanged from product rules)

- UI-only: **zero** feature, behavior, data, or route changes.
- Keep all aria attributes, keyboard handling, focus states, and tap targets ≥ 40px.
- Mobile mirrors desktop functionally; this pass must improve mobile calm too.
- Existing tokens & fonts only — **three faces**: Akira Expanded (body), Synkopy
  (`.font-heading`), Panchang (`.font-mono`). No CDN imports, no new colours. A fourth face
  (Inter) was once scoped to storefront labels via `--font-store`; it has been removed, and
  "three" means three.
- No new UI libraries; primitives stay hand-rolled.
- Tests, typecheck, lint, and build stay green after every surface pass.

## Surface order (buyer-facing first)

All six have had at least one pass. Colour, shadow, type scale and radii vocabulary are
consistent tree-wide.

1. ~~`/store` catalogue~~ · 2. ~~`/store/[id]` + drawers + checkout~~ · 3. ~~Share pages~~ ·
4. ~~Dashboard home/library~~ · 5. ~~Projects, playlists, store-editor, sales/analytics~~ ·
6. ~~PlayerBar + modals/toasts/empty states~~

**Open work**, in order:

1. **Control language rollout** — replace migration-residue solid-white buttons with the
   translucent scale above. Highest traffic first: `store/BeatCard`, `StoreListView`,
   `/store` filter chips, checkout, `CartDrawer`, then dashboard toolbars.
   *Baseline at time of writing:* **288 solid `bg-white` usages across 100 files**, of which
   **31 across 24 files** carry the exact `text-black bg-white font-semibold shadow-md`
   migration signature. Target: one solid-white action per view, so the great majority of
   those become translucent. Measure with
   `grep -rEho "bg-white([^/a-zA-Z0-9_-]|$)" src/ | wc -l`.

   *2026-09-20 — chips and badges done: **169 across 78 files**.* Every tab, toggle,
   filter chip and pagination control now uses the `bg-white/[0.14] border-white/30`
   active state, and every count badge is a hairline pill. What remains is almost
   entirely **primary-action buttons**, which is the half needing judgement rather than
   a rule: "one per view" cannot be decided by grep, and several views legitimately have
   one (checkout, the cart pill, Google sign-in, Save profile). Take them a view at a
   time. The same pass fixed 45 controls whose hover fill equalled their rest fill and
   4 carrying two hover fills at once; `lib/ui/tailwind-classes.test.ts` now guards both,
   so that population cannot regrow.
2. **Preview player rebuild** — ~~per "The beat preview player" above.~~

   *2026-09-21 — already built; verified rather than rebuilt.* `player/SpectralWaveform.tsx`
   (canvas, `useSpectralPeaks` + `lib/audio/spectral-peaks.ts`) is wired into all three
   surfaces the section names: `PlayerBar`, `store/BeatPreviewDrawer` and
   `share/ShareTrackDetailsDrawer`. Checked against the spec bullets in a browser on the
   `/store` fixture: cover art anchors the panel with the waveform **below** it, the
   waveform is continuous and mirrored rather than discrete bars, the playhead is a thin
   line, elapsed sits left with **remaining** (`−3:30`) right, and transport is plain
   glyphs with no filled play disc. One deliberate divergence, documented in the component:
   the playhead is FIXED at centre and the waveform scrolls past it, because a travelling
   playhead over a three-minute beat is a progress bar, not a transport.
3. **`src/components/ui/` radii** — ~~the primitives violate the 8/12/20 rule themselves
   (`Modal.tsx` is 16px while 16 hand-rolled surfaces write the correct 20px)~~. Fix the
   primitives *before* the pages, or the drift comes back.

   *2026-09-20 — done, and `Modal.tsx` was already 20px by the time this was picked up.*
   The primitives now use only 8px controls, 12px cards and 20px modals/heroes: `Card`,
   `ListRow`, `CoverEditor`, `Skeleton` and `MediaCard` dropped from 16px to 12px,
   `Dropdown`, `ColorPicker`, `Slider`, `Toaster` and `MediaCard`'s badge from 6px to 8px,
   `ProductList` 24px and `Toaster` 22px to 20px, and `Drawer`'s bottom sheet from 24px to
   20px. `lib/ui/radii.test.ts` guards it, with `rounded-full`, the inherited-shape
   overlays and the 15px colour swatch allowlisted and each reason written down.
   **The pages are not covered** — they still hold plenty of off-vocabulary radii, and
   widening the guard before the rollout reaches them would just produce a test people
   skip. Widen it surface by surface.
4. **Type scale** — ~~worst offenders `store/[id]/page.tsx` and `sales/page.tsx` (9 distinct
   sizes each). Collapsing `12px → 11px` is the single highest-leverage change.~~

   *2026-09-21 — the small end is done.* `12px → 11px` app-wide (295 occurrences across
   108 files) and `7px → 8px` (11), leaving the 7–13px band at five steps: 8, 9, 10, 11
   (body), 13. 11px was already the dominant body size at 626 uses against 295, so the
   merge moved the minority onto the majority rather than inventing a value.
   `lib/ui/type-scale.test.ts` guards the band.

   Two corrections to the note above. `sales` was 9 distinct sizes and is now 8.
   `store/[id]` was **8, not 9**, and the count overstated it either way: three of those
   are `text-[28px] sm:text-[36px] md:text-[48px]` on one line — a single responsive
   heading, not three styles. Its remaining `32px` is the price figure on a licence tier,
   deliberately distinct from the title. Rendered, the page now shows seven distinct sizes
   across all its text, dominated by 11px and 9px.

   **Still open:** the headings above 13px (14, 15, 16, 17, 18, 20, 22, 24, 28…). Collapsing
   those is a visual judgement per surface rather than a rule, which is why the guard stops
   at 13px instead of banning sizes with no agreed replacement.
5. **Modal consolidation** — ~~21 hand-rolled overlays; 19 lack Escape, 20 lack focus trap,
   all 21 lack `role="dialog"`~~. `ui/Modal` already implements all of it.

   *2026-09-21 — done, and the counts above were badly stale by the time it was picked up.*
   27 components already carried `role="dialog"`; `ContactHistoryDrawer` had been rebuilt on
   `ui/Drawer` and only matched a scan because it *describes* the old pattern in a comment.
   Four genuine gaps remained: `QuickShareModal` (a real dialog — now `role="dialog"`,
   `aria-modal`, focus trap), and the folder popovers in `PlaylistFilterBar` /
   `ProjectFilterBar` plus the New-release menu on `/library`, which are anchored popovers
   and menus, so they take Escape and focus restoration with `trapFocus: false` — trapping
   one strands a keyboard user in a popup they expect to Tab out of. All three previously
   closed **only** on an outside click, so a keyboard user could not dismiss them at all.
   `lib/ui/overlay-behavior.test.ts` guards the population, with `DropZone` (a drop target)
   and `GlassPage` (decorative `aria-hidden` washes) allowlisted and their reasons written
   down.
6. **Tokenisation** — 175 files hardcode hex against a 114-property token layer that is
   essentially unused. This is the root cause of repeated colour drift.

   *2026-09-20 — the blocker under this item is fixed; the migration itself is not done.*
   Tokenising the literals was **not safe to do**, because the token layer did not describe
   the app: `--bg-card` resolved to `#181815` while 135 components hardcode `#0D0D0A`, and
   `--bg-page` to `#0B0B0A` against 300 uses of `#090907`. Converting a literal would have
   *changed its colour*. That was also live, not theoretical — the ~34 sites that already
   used the tokens (`ui/Card`, `Modal`, `Drawer`, `Field`, and the sales / analytics /
   calendar / contacts pages) rendered a full shade lighter than their neighbours, and one
   page painted three different near-blacks at once.

   The surface tokens now hold the measured values, so `#090907` ⇄ `var(--bg-page)` and
   `#0D0D0A` ⇄ `var(--bg-card)` are genuine no-ops and the migration can proceed surface by
   surface. Two things to know first: **text, border and accent tokens are still off**
   (`--text-primary` `#E6DED1` vs `text-white/80`; `--border-default` `#282722` vs
   `border-white/10`), so only surfaces are safe today; and many literals carry an opacity
   modifier (`bg-[#090907]/90`), so check how `bg-[var(--bg-page)]/90` compiles here before
   converting that population.

## Definition of done per surface

- Visually: fewer borders/colors/type-sizes than before (count them), one hero moment, calm.
- Functionally: identical behavior, verified by existing tests + build.
- Logged: an entry in `docs/codex-execution-log.md` with skills used, changes, verification.
