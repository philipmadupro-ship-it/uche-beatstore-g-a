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
Confirmed applied: **001–106**, via a full clean replay (2026-08-05).

Status **unverified** — these landed after that replay and were never listed
here, so treat them as unapplied until checked against the target project:

- `107_tag_colors.sql`
- `108_brand_logo_and_kind_artwork.sql`
- `109_default_artwork.sql` (renumbered from 106 to clear a duplicate)
- `110_normalize_contact_emails.sql` — **backfill**. Lowercases every CRM-linking
  email (contacts, license_purchases, project_access_links,
  store_free_downloads, buyer_*) and deduplicates the contacts the
  case-sensitive `contacts_user_email_uniq` index had forked. Apply together
  with the write-side normalisation in `lib/contacts/email.ts`, or past orders
  stay unfindable via `/store/orders`.

- `111_adopt_orphan_contacts.sql` — **data migration**. Adopts legacy
  `user_id IS NULL` contacts onto the single producer (guarded: runs only when
  exactly one `creator_profiles` owner exists), merging any that collide on
  email. Required by the owner-only scoping now used in `/api/contacts`,
  `/api/contacts/scores` and `/(dashboard)/contacts` — without it those legacy
  rows disappear from the CRM instead of being adopted.

- `112_backfill_buyer_contacts.sql` — **data migration**. Reconciles past
  purchases with the CRM: creates a contact for any paid buyer email that has
  none, and marks every contact with a paid purchase as `crm_status='customer'`
  / `buyer_pipeline_status='purchased'`. Only fills NULLs, so a hand-set stage
  is never overwritten. Excludes the `unknown@invalid` sentinel. Needed because
  the webhook fix only applies to future purchases — without it, existing
  customers keep rendering as cold leads.

If you add a new one, list it here until it's confirmed applied.

## Numbering
Latest applied baseline = 106; latest file on disk = 112. When two branches both add a migration, both
claim the next number — check `git log --all -- supabase/migrations/` before
naming (we renumbered 040/041 → 046/047 once already; 096/097/098/099 each
have two independent files sharing a number from a past parallel-branch
collision — both sides of each pair are legitimate and applied, just
renumber the *next* new migration past 106, don't touch the existing pairs).

## Future: gate it in CI/CD
The robust end state is a deploy step that runs `npm run db:migrate` against the
target project (with `SUPABASE_DB_URL` as a CI secret) immediately before the
app deploy, so schema and code ship together and drift is impossible.
