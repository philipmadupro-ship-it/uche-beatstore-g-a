# Migrations

Append-only, idempotent SQL. Applied on Supabase before merging dependent
code.

## Conventions

- **Numbering is sequential** — `NNN_short_descriptor.sql`. Before naming
  a new migration in a branch off main, also check open PRs:
  ```bash
  git log --all -- supabase/migrations/
  ```
  We've collided and had to renumber twice (040/041 → 046/047).
- **Idempotent.** `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN
  IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Running the same file
  twice must be a no-op.
- **End every file with**:
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
  Without this, PostgREST keeps serving the stale schema cache and you get
  `Could not find column X in schema cache` from API routes for ~10 min.
- **RLS on every owned table.** Default policy shape is "owner-or-null
  SELECT" — buyer-facing rows have `user_id IS NULL` rows readable by
  anyone, owner rows readable only by the owner. Mutations are gated to
  the owner.

## Applying

In Supabase Studio → SQL Editor, paste the file contents and run. The
service-role connection bypasses RLS, so the migration applies cleanly.
Then refresh the schema cache (the `NOTIFY` at the bottom does this
automatically) and wait ~10 seconds for PostgREST to pick it up.

## Backfills

When adding a NOT NULL column to a populated table:

1. Add the column nullable.
2. Backfill with a sensible default.
3. `ALTER COLUMN … SET NOT NULL` in the *same* migration.

Migration 049 is the template for this pattern (`projects.user_id`).

## Renaming / dropping

Don't. Migrations are append-only. If a column is unused, drop it in a
new migration with `IF EXISTS` so re-runs are safe. If you change a
column's meaning, add a new column and stop writing to the old one.
