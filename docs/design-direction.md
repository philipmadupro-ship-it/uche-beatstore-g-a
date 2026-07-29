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
3. **One accent.** `#FFFFFF` (and its alpha steps) is reserved for the primary action and the
   active/playing state. Kill decorative multi-accent usage (`#9d95e8`, `#7F77DD`, `#D6BE7A`,
   etc. as card tints). Semantic exceptions stay: mint `#6DC6A4` = free, gold `#c8a84b` =
   rating/wishlist, warm `#c8a47a` = musical key.

   > **Amended.** This principle originally specified a warm `#D4BFA0` accent. The
   > beige-to-white/alpha migration replaced it app-wide, and on review that direction was
   > kept — so the rule now documents what ships. The *warm* palette still governs surfaces
   > and text (see principle 4); it is the accent specifically that is white. The producer's
   > storefront accent picker (`ACCENT_PRESETS`, profile swatches) is a separate,
   > user-controlled setting and is deliberately out of scope for this rule.
4. **Flatter, calmer surfaces.** Prefer background steps (`#0a0907 → #14110d → #171511`) over
   border+shadow stacking. Max one border OR one shadow per element. Radii vocabulary: 8px
   (controls), 12px (cards), 20px (modals/heroes) — nothing else.
5. **Density down, breathing room up.** Increase padding, reduce items-per-row where cramped,
   move secondary metadata behind hover/detail/drawer instead of stacking it inline.
6. **Calm motion.** Fades and small translates only; no bouncing, no spinning decoration.
   `prefers-reduced-motion` disables everything non-essential (existing rule, keep).
7. **One anatomy per pattern.** Every card looks like every card; every list row like every
   list row; every modal like every modal. Divergence needs a functional reason.

## Hard constraints (unchanged from product rules)

- UI-only: **zero** feature, behavior, data, or route changes.
- Keep all aria attributes, keyboard handling, focus states, and tap targets ≥ 40px.
- Mobile mirrors desktop functionally; this pass must improve mobile calm too.
- Existing tokens & fonts only (Akira / Synkopy / Panchang, no CDN imports, no new colors).
- No new UI libraries; primitives stay hand-rolled.
- Tests, typecheck, lint, and build stay green after every surface pass.

## Surface order (buyer-facing first)

1. `/store` catalogue (cards, list rows, toolbar, sidebar/facets)
2. `/store/[id]` detail + preview drawer + cart drawer + checkout
3. Share pages (all four variants) + bottom player
4. Dashboard home/library (hero, quick actions, rows, list)
5. Projects, playlists, store-editor, sales/analytics
6. PlayerBar + modals/toasts/empty states sweep

## Definition of done per surface

- Visually: fewer borders/colors/type-sizes than before (count them), one hero moment, calm.
- Functionally: identical behavior, verified by existing tests + build.
- Logged: an entry in `docs/codex-execution-log.md` with skills used, changes, verification.
