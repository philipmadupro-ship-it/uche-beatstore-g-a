# Beatstor Current Progress Map

This map condenses the execution log into continuation lanes. Use the log as the authoritative source when exact commands, files, or caveats matter.

## Completed Or Started Lanes

- Skill system and initial audit: prompt-required skills exist under `.codex/skills/`, with `docs/codex-execution-log.md` as the durable progress record.
- Store discovery: URL-restorable filters, recent searches, suggestions, keyboard navigation, no-results recovery, and focused helper tests are in place.
- Global player: buffering/error state, player store regression coverage, cover-waveform visual layer, artwork safety helpers, and browser smoke for error state have been added.
- Commerce/cart: checkout license terms acknowledgement, route warning cleanup, cart/player/storefront lint fixes, and browser verification for checkout acknowledgement have been done.
- Upload: drop-zone draft persistence and rejection recovery helpers/tests were added; authenticated browser drag/drop coverage remains open.
- Buyer library: account endpoints/pages now return safe track summaries for history, favorites, and playlists, with session marker handling and tests.
- Design system: De Roche visual foundation, protected dev lab, interactive lab controls, export controls, cover-art templates, and export presets exist.
- Release readiness: focused build/performance passes ran; production build passes. Turbopack NFT warnings around `next.config.ts -> src/lib/audio/convert.ts -> analyze route` remain known and are documented in `docs/release-readiness.md`.
- Repository lint: CLOSED. Full-repo ESLint reports 0 errors (was 67). Remaining 93 warnings are the accepted `no-img-element` / `exhaustive-deps` / unused-symbol baseline; the image warnings are deliberately deferred into the visual pass.
- Playback performance: preview MP3 generation, direct-from-R2 streaming, on-device preview cache, EU function co-location, and presigned-redirect library playback all shipped.

## Active Lane

- **Quiet Luxury UI restyle.** The product owner's standing brief: the UI is too busy and must
  become simpler, calmer, and more premium (Apple / Untitled UI). Master prompt and acceptance
  criteria live in `docs/design-direction.md`; use the `quiet-luxury-ui` skill. Work the surface
  order listed there, one surface per pass, buyer-facing first.

## Highest-Value Open Lanes

- Authenticated browser fixtures for dashboard upload and buyer account flows.
- Responsive/mobile browser QA for store search popover, player expanded mode, upload drop-zone, checkout, and account pages.
- Accessibility audit across player, store filters/search, cart, checkout, upload, and dashboard controls.
- Producer dashboard publishing depth: public preview, publish/private/schedule states, license pricing ergonomics, and operational analytics clarity.
- Commerce hardening: stale exclusive availability, download entitlement browser flows, promo edge cases, receipt/order states, and Stripe credential limits.
- Secure storage verification: public preview vs purchased master/stem access, signed URL behavior, and no private R2 leakage in public JSON.
- Turbopack NFT warning elimination remains open; deployment workaround is documented.
- Final visual polish pass across cards, lists, modals, menus, forms, loading, empty, and error states.

## Choosing The Next Pass

Prefer a lane that can be verified with current credentials and local state. If auth or external services block full proof, implement pure helpers, API guards, or unauthenticated browser checks first, and log the remaining credential-dependent gap explicitly.
