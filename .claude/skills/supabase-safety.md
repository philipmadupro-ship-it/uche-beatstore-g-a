# supabase-safety

## Migration rules

- Append-only, idempotent (`IF NOT EXISTS` / `IF EXISTS`).
- End every schema change: `NOTIFY pgrst, 'reload schema';`.
- Naming: `NNN_descriptor.sql`. Check `git log --all -- supabase/migrations/` to avoid numbering conflicts.
- Current ceiling: **092** (`contacts.crm_status`).
- Apply in Supabase before merging any code that depends on the new columns.

## RLS rules

- RLS on every owned table.
- Owner pattern: `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`.
- Junction parent pattern: `USING (EXISTS (SELECT 1 FROM parent p WHERE p.id = junction.parent_id AND (p.user_id IS NULL OR p.user_id = auth.uid())))`.
- Never weaken RLS for convenience — use the service-role client behind an ownership check instead.

## OwnedTable + local-store sync

When adding a new owned table:
1. Add it to the `OwnedTable` union in `src/lib/db.ts`.
2. Add it to the schema type + default `[]` in `src/lib/local-store.ts`.
Forgetting either breaks the local-store fallback and strict TS check.

## Service-role discipline

```ts
const owner = await requireRowOwnership('table', id);
if (!owner.ok) return owner.res;
// Only now: use owner.admin (service-role client)
```

Never call `createServiceClient()` before ownership is verified.

## Common gotchas

- `"Could not find column X"` → `NOTIFY pgrst, 'reload schema';` then wait 10s.
- PostgREST `.or()` interpolation — commas inside values break filter; validate IDs before building filter strings.
- Two worktree branches claiming the same migration number → check `git log --all`.

## Skill integrations

- `/supabase-postgres-best-practices` — ALWAYS consult before writing complex queries, composite indexes, or RLS policies with JOINs. The skill knows Supabase-specific performance pitfalls (e.g., `auth.uid()` in RLS causing seq scans without proper indexing).
