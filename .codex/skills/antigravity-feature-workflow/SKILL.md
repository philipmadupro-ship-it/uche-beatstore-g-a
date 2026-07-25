---
name: antigravity-feature-workflow
description: Use when implementing or modifying Antigravity features across Next.js App Router pages, API routes, contracts, Supabase-backed data, Zustand hooks, or shared lib helpers. Trigger for general feature work, bug fixes, route changes, dashboard work, share pages, upload/playback work, or cross-surface changes.
---

# Antigravity Feature Workflow

## Start Here

Read `CLAUDE.md` before implementation if you have not already in the turn. Read `AGENTS.md` when the requested behavior affects product meaning, buyer flows, producer workflows, or data model assumptions.

## Implementation Order

1. Locate the current pattern with `rg` and nearby files.
2. If schema changes are needed, create the migration first and use `antigravity-supabase-safety`.
3. Add or update Zod contracts in `src/lib/contracts/` for mutation bodies.
4. Put filter, sort, scoring, pricing, entitlement, or transform logic in a pure helper under `src/lib/<domain>/`.
5. Add focused Vitest coverage for the helper or route-level behavior.
6. Wire API routes and UI using existing components and hooks.
7. Verify with the smallest meaningful command, then run broader checks when risk justifies it.

## Local Patterns

- API routes live in `src/app/api/**/route.ts`.
- Mutations are Zod-validated and return `{ error: string }` on failure.
- Use `errorMessage(err)` and `createLogger('api.x.y')`.
- Owner gating uses `requireUser()` or `requireRowOwnership(table, id)`.
- Service-role client is allowed only after ownership is verified.
- Prefer existing primitives: `Dropdown`, `BatchActionBar`, `useToast`, `confirmToast`, `Popover`.

## Pure Helper Rule

Do not add complex logic inside React components. Existing protected helpers include:

- `src/lib/store/filters.ts`
- `src/lib/contacts/filters.ts`
- `src/lib/projects/filters.ts`
- `src/lib/playlists/filters.ts`

For any new filter or scoring behavior, write the helper and test first, then call it from the page or component.

## Risk Checks

Before finishing, check the relevant boundaries:

- Auth: dashboard private, store/share public.
- Playback: private R2 values never leak to public responses.
- Commerce: track licenses and project bundles remain distinct.
- Migration: append-only, idempotent, `NOTIFY pgrst, 'reload schema';`.
- UI: warm dark tokens, reduced motion, no new UI library.
