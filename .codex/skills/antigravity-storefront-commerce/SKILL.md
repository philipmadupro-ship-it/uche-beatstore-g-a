---
name: antigravity-storefront-commerce
description: Use for Antigravity public storefront work: /store catalogue, track detail pages, project bundles, checkout, Stripe embedded checkout, promo codes, cart, wishlist, free downloads, delivery links, store analytics, buyer flows, and public cache behavior.
---

# Antigravity Storefront Commerce

## Mission

Help buyers discover beats, preview confidently, and complete checkout with minimal friction. The store should feel like the producer's premium public identity, not a generic marketplace.

## Key Surfaces

- `/store`: catalogue, grid/list, faceted search, wishlist, cart.
- `/store/[id]`: track detail, licenses, waveform, share, free-download CTA.
- `/store/projects/[id]`: project bundle detail.
- `/store/checkout`: cart-mode and `?project_id=` project-mode checkout.
- `/store/download`: post-purchase track license delivery.
- `/store/projects/access/[token]`: post-purchase project bundle delivery.
- `/store/producer/[slug]`: producer profile.

## Commerce Model

- Track licenses are line-item purchases written to `license_purchases`.
- Project bundles are bundle purchases written to `project_access_links`.
- Promo codes live in `promo_codes`; percent discounts distribute uniformly, flat discounts split proportionally.
- No buyer accounts. Email is the buyer identifier.
- Exclusive purchases delist the track.
- Exclusive purchases without WAV or ready stems use the stems-pending flow, not checkout rejection.

## Stripe Guardrails

- Server checkout uses `ui_mode: 'embedded_page'`.
- Client checkout uses `stripe.createEmbeddedCheckoutPage({ clientSecret })`.
- Webhook verifies signature with `req.text()`, not `req.json()`.
- Idempotency exists at event level and purchase level.
- `metadata.purchase_kind` distinguishes `track_license` from `project`.

## Store Data Guardrails

- `/api/store` sends `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`.
- Public store playback uses previews, never private masters.
- Never expose private `r2://` references in public JSON.
- Filter and sort logic stays in `src/lib/store/filters.ts` and tests.

## UI Notes

Use `antigravity-design-system` for storefront visual changes. Keep active filters visible as chips, mobile totals sticky in checkout, and buyer trust signals clear without adding marketing clutter.
