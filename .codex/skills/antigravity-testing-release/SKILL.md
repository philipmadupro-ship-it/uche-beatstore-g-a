---
name: antigravity-testing-release
description: Use for Antigravity validation, Vitest coverage, build checks, release readiness, PR test plans, regression risk review, CI failures, and verification after UI, API, commerce, auth, migration, or CRM changes.
---

# Antigravity Testing Release

## Verification Ladder

Pick the smallest check that proves the change, then widen for risk:

1. Focused unit test for pure helper changes.
2. Relevant route or component tests if present.
3. `npx tsc --noEmit` for type-sensitive changes.
4. `npm test` for shared logic or regression-prone areas.
5. `npm run build` before PRs or when App Router boundaries changed.

## High-Risk Areas

Run broader checks for:

- Auth boundaries and `src/proxy.ts`.
- Checkout, Stripe webhook, promo codes, delivery routes.
- Public store and share API responses.
- Supabase migrations, RLS, service-role ownership.
- Upload, playback, private/public R2 media.
- CRM filtering, send modal, Resend tracking.

## Pure Helper Coverage

These helpers are regression guards:

- `src/lib/store/filters.ts`
- `src/lib/contacts/filters.ts`
- `src/lib/projects/filters.ts`
- `src/lib/playlists/filters.ts`

Add or update tests whenever behavior changes.

## Release Checklist

- Happy path and at least one edge case verified.
- Public vs protected route behavior is intentional.
- Migration applied or clearly called out before dependent code ships.
- Reduced-motion and mobile state checked for visual changes.
- PR notes include summary, why, test plan, required production config, and migrations.

## If Checks Cannot Run

Say exactly which command was not run or failed, why, and what residual risk remains. Do not imply verification happened when it did not.
