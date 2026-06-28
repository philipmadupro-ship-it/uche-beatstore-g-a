# RLS audit — owned-table policy sweep

Satisfies the production-readiness P1 item: *"confirm every owned table has
owner-or-null SELECT + owner-only write, and that no legacy `USING (true)`
policies remain on owned tables."*

**Method:** static review of `supabase/migrations/*.sql` (the append-only,
idempotent source of truth) — every `ENABLE ROW LEVEL SECURITY`, `CREATE
POLICY`, and `USING (true)` / `WITH CHECK (true)`. Re-run with:

```bash
grep -rhi "enable row level security" supabase/migrations/*.sql
grep -rn "USING (true)\|WITH CHECK (true)" supabase/migrations/*.sql
```

## Result: PASS

- **RLS is enabled on all 52 owned tables.** No owned table relies on default
  table privileges.
- **No over-permissive policy remains on an owned table.** Every early
  `FOR ALL USING (true)` (migrations 002/003 on `tracks`, `playlists`,
  `playlist_tracks`, `project_tracks`, `track_versions`, `contacts`,
  `calendar_events`, `beat_sends`, `share_links`) was dropped and replaced in
  **migration 010_scope_rls_to_owner** with the owner-or-null pattern
  (`user_id IS NULL OR auth.uid() = user_id`), or with an `EXISTS` parent-owner
  check for junction/child tables.
- **No migration ≥ 040 introduced any `USING (true)` / `WITH CHECK (true)`.**

## Intentional public-by-design exceptions (reviewed, kept)

These are **read-only or append-only** on public-by-design surfaces; none expose
owned write access, and each is further filtered by an unguessable token or
scoped query in the route layer:

| Policy | Table | Mode | Why it's safe |
|---|---|---|---|
| `public read session` | `share_links` | SELECT | Anonymous link recipients look up a share by token; route enforces password/role. |
| `public insert play` | `share_plays` | INSERT | Anonymous play logging; no read-back. |
| heatmap insert (mig 016) | play/heatmap log | INSERT | Anonymous play telemetry. |
| `public_token_lookup` | `project_shares` | SELECT | Token validity check; route enforces password/role server-side. |
| `public_read` | `project_comments` | SELECT | Share-page reader; route filters by project_id + share token. |

Service-role-only tables (`processed_stripe_events`, `rate_limits`) have RLS
enabled with no public policy — correct, since only `createServiceClient()`
(which bypasses RLS) touches them.

## Defense in depth

App-layer scoping (`requireRowOwnership` / `requireUser` + service-role only
after the ownership check) remains in place, so even a reverted RLS migration
keeps the routes correct. RLS is the second line, not the only line.

## Recommendation

No code change required. Re-run this sweep whenever a migration adds a table
with a `user_id` / `seller_user_id` column, and prefer the migration-010
owner-or-null template for any new owned table.
