---
name: marketplace-and-licensing
description: Use for Beatstor license tiers, license comparison, cart, cart drawer, Stripe checkout prep, promo codes, terms acknowledgement, purchases, downloads, receipts, exclusive availability, and separating save/playlist/cart/purchase flows.
---

# Marketplace And Licensing

## Activation

Use for license selectors, cart state, checkout routes, Stripe metadata, promo codes, project bundles, post-purchase downloads, order access, and commerce UI.

## Workflow

1. Inspect `useCart`, `LicenseSelector`, `TrackLicensePanel`, `CartDrawer`, store checkout routes, webhook, and delivery routes.
2. Keep server as authority for price, ownership, purchase status, and download grants.
3. Separate adding to cart, selecting a license, buying exclusive, downloading files, saving/favoriting, and adding to playlists.
4. Preserve track-license vs project-bundle purchase distinction.
5. Add tests for pricing, discount, entitlement, or checkout metadata changes.

## Checklist

- License tiers show price, formats, rights, limits, credit requirements, and availability where data exists.
- Cart shows beat, producer, selected license, subtotal, discount, total, remove/change actions, and terms acknowledgement when required.
- Exclusive availability is enforced without dark patterns.
- Mock checkout is clearly separate from production Stripe.
- Purchases create protected, verified download access.

## Expected Output

Commerce change with server-side validation, user-facing license clarity, tests, and remaining payment/config notes.
