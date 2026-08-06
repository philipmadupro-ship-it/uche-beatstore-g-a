# Database migrations — deploy runbook

Migrations live in `supabase/migrations/NNN_descriptor.sql`, are **append-only**
and **idempotent** (`CREATE ... IF NOT EXISTS`, guarded `DO` blocks), and each
ends with `NOTIFY pgrst, 'reload schema';`. Because they're idempotent, applying
the full set in order is safe and re-runnable — that's the deploy contract.

## The rule
**Apply migrations BEFORE deploying code that depends on them.** A feature whose
table/column/index isn't live yet silently no-ops (or 500s). Apply on a
**staging** Supabase project first, then production.

## How to apply

```bash
# Direct/session connection string from:
#   Supabase dashboard → Project Settings → Database → Connection string
SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  npm run db:migrate
```

This runs `scripts/apply-migrations.sh`, which applies every file in order via
`psql`. Idempotency means already-applied migrations are no-ops.

Alternatives:
- **Supabase CLI**: `supabase link --project-ref <ref>` then `supabase db push`
  (the repo isn't linked yet — no `config.toml`).
- **Dashboard**: paste a single migration's SQL into the SQL editor (manual
  fallback for a one-off).

After applying, wait ~10s for the PostgREST schema cache to reload (the
`NOTIFY pgrst` line). If you hit `Could not find column X in schema cache`,
re-run `NOTIFY pgrst, 'reload schema';` and wait.

## ⚠️ Currently UNAPPLIED
None — all 106 migrations were confirmed applied via a full clean replay
(2026-08-05). If you add a new one, list it here until it's confirmed applied.

## Numbering
Latest applied baseline = 106. When two branches both add a migration, both
claim the next number — check `git log --all -- supabase/migrations/` before
naming (we renumbered 040/041 → 046/047 once already; 096/097/098/099 each
have two independent files sharing a number from a past parallel-branch
collision — both sides of each pair are legitimate and applied, just
renumber the *next* new migration past 106, don't touch the existing pairs).

## Future: gate it in CI/CD
The robust end state is a deploy step that runs `npm run db:migrate` against the
target project (with `SUPABASE_DB_URL` as a CI secret) immediately before the
app deploy, so schema and code ship together and drift is impossible.
