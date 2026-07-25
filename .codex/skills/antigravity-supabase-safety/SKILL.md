---
name: antigravity-supabase-safety
description: Use before editing Antigravity Supabase migrations, RLS policies, ownership checks, service-role routes, Postgres indexes, public/private table access, or local-store/db facade table support.
---

# Antigravity Supabase Safety

## Migration Rules

- Migrations are append-only.
- Use idempotent DDL: `IF NOT EXISTS` / `IF EXISTS`.
- End schema changes with `NOTIFY pgrst, 'reload schema';`.
- Before numbering a migration, check existing migrations and `git log --all -- supabase/migrations/`.
- Do not weaken RLS for convenience.

## Ownership Pattern

Owned tables use:

```sql
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid())
```

Junction tables should check ownership through the parent table.

For route handlers:

```ts
const owner = await requireRowOwnership('table', id);
if (!owner.ok) return owner.res;
// Use owner.admin only after this point.
```

## Required Sync Points

When adding a new owned table:

- Add it to `OwnedTable` in `src/lib/db.ts`.
- Add it to `src/lib/local-store.ts` schema defaults.
- Add or update contract schemas in `src/lib/contracts/` if mutations touch it.

## Query Guardrails

- Validate IDs before interpolating PostgREST `.or()` strings.
- Prefer batch lookups over N+1 queries.
- Add indexes for high-traffic filters and RLS lookup paths.
- Use service role only behind ownership verification.

## Public Data Boundary

Store and share routes can be public, but responses must contain only public-safe fields. Private audio values, private bucket keys, and service-only metadata must stay server-side.
