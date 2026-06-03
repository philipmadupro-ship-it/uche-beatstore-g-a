# storefront-commerce

## Storefront mission

Help buyers discover beats quickly, preview confidently, and complete checkout with minimal friction. The store is the producer's public identity — it should feel premium, not like a generic marketplace.

## Commerce model

- **Track licenses** — lease or exclusive, priced per-track (override) or from producer default.
- **Project bundles** — single price for all tracks in a project.
- **Free downloads** — gated by email capture via the contact form.
- **Promo codes** — `promo_codes` table; percent or flat discount distributed across line items.
- Checkout: Stripe `ui_mode: 'embedded_page'` (not deprecated `embedded`).
- No buyer accounts. Email only.

## Key store surfaces

- `/store` — catalogue with grid/list views, sidebar facets (type, genre, mood, key, BPM, price, duration, free-only, favorites, new-this-week).
- `/store/[id]` — track detail with license card grid.
- `/store/projects/[id]` — project bundle detail.
- `/store/checkout` — cart-mode + project-mode, promo code, Stripe embedded.
- `/store/download` — post-purchase track delivery (signed R2 URLs).
- `/store/projects/access/[token]` — post-purchase project delivery.
- `/store/producer/[slug]` — producer profile page.

## Filter + sort logic

`lib/store/filters.ts` → `filterAndSortTracks` — pure, Vitest-covered. All filter logic lives here. Never re-inline in the page component.

## Webhook idempotency

`/api/stripe/webhook` is idempotent at two levels:
1. Event: `processed_stripe_events.event_id`.
2. Purchase: `license_purchases.stripe_session_id` (UNIQUE), `project_access_links.stripe_session_id`.

## Guardrails

- Never blur license-purchase vs bundle-purchase distinction.
- Exclusive purchases delist the track (`store_listed=false`).
- Stems-pending flow: exclusive buys without WAV/stems are NOT blocked — `needs_stems_upload=true` on the purchase row, producer gets an email.
- Stripe SDK: `ui_mode: 'embedded_page'` (server); `stripe.createEmbeddedCheckoutPage({ clientSecret })` (client).
- Cache: `/api/store` → `public, s-maxage=30, stale-while-revalidate=60`.

## Skill integrations

- `/high-end-visual-design` + `/ui-ux-pro-max` — for new storefront components. The store competes visually with Bandcamp and Beatstars — it must feel premium.
- `/web-design-guidelines` — run before shipping new store pages (accessibility, trust signals, mobile usability).
