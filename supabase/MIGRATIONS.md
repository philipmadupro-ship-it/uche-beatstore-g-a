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

Checked against production on **2026-09-17** with read-only probes (the
service-role key can read the schema's effects but cannot run DDL):

| Migration | Status on prod | Evidence |
|---|---|---|
| `107_tag_colors.sql` | applied | `tag_colors` exists |
| `108_brand_logo_and_kind_artwork.sql` | applied | `creator_profiles.logo_url` exists |
| `109_default_artwork.sql` | applied | `creator_profiles.default_artwork_url` exists |
| `110_normalize_contact_emails.sql` | effect present | no contact emails with uppercase letters found |
| `111_adopt_orphan_contacts.sql` | effect present | 0 contacts with `user_id IS NULL` |
| `112_backfill_buyer_contacts.sql` | **not applied** | 1 paid buyer email has no contact |
| `113_store_layout.sql` | **not applied** | `creator_profiles.store_layout` missing |
| `114_share_price_overrides.sql` | no-op on prod | columns already exist, added outside migrations |
| `115_track_collaborators.sql` | **not applied** | new table; `track_collaborators` missing |
| `116_notifications_realtime.sql` | **not applied** | new — adds `notifications` to the realtime publication |

What each still-pending one does:

- `112_backfill_buyer_contacts.sql` — **data migration**. Creates a contact
  for any paid buyer email that has none, and marks every contact with a paid
  purchase `crm_status='customer'` / `buyer_pipeline_status='purchased'`. Only
  fills NULLs. Excludes the `unknown@invalid` sentinel.
- `115_track_collaborators.sql` — new table holding who else is credited on a
  track, written from the filename credits `lib/upload/title-metadata` parses
  at upload. Nothing reads it until it is applied; the upload path treats a
  failed write as non-fatal, so an unapplied migration costs the credits, not
  the upload.
- `113_store_layout.sql` — adds `creator_profiles.store_layout` (jsonb) for the
  Store Editor's Design mode. `/api/store` reads it in its own query, so the
  storefront survives without it, but the builder has nowhere to save.

All are idempotent, so running the full set (`npm run db:migrate`) is safe.
Update this table when a run is confirmed.

If you add a new one, list it here until it's confirmed applied.

## Numbering
Latest applied baseline = 106; latest file on disk = 115 (next new migration = 116). When two branches both add a migration, both
claim the next number — check `git log --all -- supabase/migrations/` before
naming (we renumbered 040/041 → 046/047 once already; 096/097/098/099 each
have two independent files sharing a number from a past parallel-branch
collision — both sides of each pair are legitimate and applied, just
renumber the *next* new migration past 106, don't touch the existing pairs).

## Future: gate it in CI/CD
The robust end state is a deploy step that runs `npm run db:migrate` against the
target project (with `SUPABASE_DB_URL` as a CI secret) immediately before the
app deploy, so schema and code ship together and drift is impossible.

- `116_notifications_realtime.sql` — adds `public.notifications` to the
  `supabase_realtime` publication and sets `REPLICA IDENTITY FULL`, mirroring
  `012_realtime_comments.sql`. `TopBar` has subscribed to this table since it
  was created in 064, but the table was never a publication member, so nothing
  was ever broadcast and the bell updated only on its 60-second poll. Safe to
  apply any time and safe to merge before applying — the poll is the existing
  behaviour, so the code does not depend on this migration, it just gets slower
  without it. Idempotent.

  **Numbered 116, not 115.** `115_track_collaborators.sql` already exists on
  branch `claude/code-review-agent-integration-cdf964`. Two branches claiming
  one number is the collision this file warns about; check
  `git log --all -- supabase/migrations/` before naming the next one.
