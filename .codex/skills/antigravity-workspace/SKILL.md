---
name: antigravity-workspace
description: Use for general work in the Antigravity beatstore workspace, especially when routing ambiguous requests, choosing which product surface to inspect, or preserving context from prior Antigravity conversations across dashboard, storefront, share links, CRM, commerce, and release work.
---

# Antigravity Workspace

## Purpose

Use this as the first orientation skill for broad Antigravity requests. It turns the recurring workspace conversations into a quick routing map so future work starts in the right product surface.

## Canonical Docs

- Product spec: `AGENTS.md`
- Engineering reference: `CLAUDE.md`
- Existing Claude conversation summaries: `.claude/skills/*.md`

Read `AGENTS.md` when product behavior is unclear. Read `CLAUDE.md` before implementation. Read only the relevant `.claude/skills/*.md` file when a narrower domain applies.

## Product Shape

Antigravity is a single-producer beatstore with two major surfaces:

- Private dashboard: library, projects, playlists, studio, contacts, campaigns, calendar, links, store editor, sales, analytics, profile, settings, offline.
- Public buyer surfaces: `/store`, track detail, project bundle detail, checkout, downloads, producer profile, share links.

User types:

- Producer: the single authenticated operator.
- Buyer or guest: no account; email is captured only at checkout or free-download capture.
- Share recipient: tokenized public route with `recipient_kind` variants: client, producer, rapper, friend.

## Routing

- Full Beatstor prompt, active goal continuation, completion audit, or cross-conversation context: use `beatstor-product-orchestrator`.
- Broad feature or bug: use `antigravity-feature-workflow`.
- Public store, checkout, Stripe, promo, delivery, cart, wishlist: use `antigravity-storefront-commerce`.
- Database migrations, RLS, ownership, Supabase query safety: use `antigravity-supabase-safety`.
- UI, layout, visual polish, theme, accessibility, motion: use `antigravity-design-system`.
- Contacts, CRM, send modal, beat sends, Resend tracking, segments: use `antigravity-crm-outreach`.
- Tests, build, release, PR readiness: use `antigravity-testing-release`.

## Non-Negotiables

- Public routes stay public: `/store/**`, `/share/*`, `/projects/share/*`.
- Dashboard routes under `/(dashboard)` stay auth-gated through `src/proxy.ts`.
- Business logic belongs in pure helpers under `src/lib/**`, with Vitest coverage.
- No Radix, Headless UI, shadcn, CDN fonts, or buyer accounts.
- Do not expose private `r2://` audio references in public JSON.
