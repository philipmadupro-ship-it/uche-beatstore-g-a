# storefront-commerce

## Storefront mission

Help buyers discover beats quickly, preview confidently, and complete checkout with minimal friction.

## Commerce model

- Tracks can be listed individually on the store.
- Projects can be sold as bundles.
- Track licenses and project bundles are different purchase types.
- Checkout uses Stripe embedded checkout.
- Email is captured at checkout; no buyer account is required.

## Key storefront surfaces

- `/store` catalogue with faceted discovery.
- `/store/[id]` track detail with license options.
- `/store/projects/[id]` project bundle detail.
- `/store/checkout` for single unified checkout.
- `/store/download` and `/store/projects/access/[token]` for delivery.
- `/store/producer/[slug]` for producer identity and merchandising.

## UX priorities

- Fast preview confidence.
- Clear pricing and license differentiation.
- Strong mobile usability.
- Trust signals near checkout.
- Strong merchandising of featured tracks, playlists, and projects.
- Share-to-store continuity where relevant.

## Guardrails

- Never confuse license purchases with bundle purchases.
- Keep sticky totals and purchase clarity on mobile.
- Preserve promo/deep-link behavior when changing checkout flows.
