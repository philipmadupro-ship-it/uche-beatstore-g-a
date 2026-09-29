# Master prompt — apply the pending Supabase migrations

Two ways to use this file:

- **Hand it to a Claude Code session.** Start a session on this repository,
  with `SUPABASE_DB_URL` set as an environment variable in the environment's
  settings (never pasted into the chat), and send everything under
  "The prompt" below.
- **Do it yourself.** Follow the same steps by hand; the "Without psql"
  section is the Supabase SQL editor route.

As of 2026-09-29 nothing is pending: 112–129 were applied with the SQL-editor bundle. Use this runbook for the next migrations (130 onwards): rebuild the bundle with only the new numbers.
`supabase/MIGRATIONS.md` is
the ledger; if it disagrees with this file, the ledger wins.

---

## The prompt

> You are applying the pending database migrations for the U2C Beatstore
> (`uche-beatstore-g-a`) to its **production** Supabase Postgres. Work from the
> repository, not from memory.
>
> **Read first:** `supabase/MIGRATIONS.md` (ledger, numbering, what each
> pending migration does), `scripts/apply-migrations.sh` (the runner),
> `supabase/apply/verify.sql` (the read-only check) and CLAUDE.md's "DB"
> paragraph.
>
> **Hard rules**
> 1. The connection string is in the environment as `SUPABASE_DB_URL`. Never
>    print it, echo it, log it, write it to a file, or put it in a commit. If
>    it is missing, stop and say so — do not ask for it in the chat.
> 2. Only the migrations already in `supabase/migrations/` are applied. Do not
>    write new SQL against production, edit a migration file, or "fix" data by
>    hand. If something fails, stop and report. `npm run db:migrate` runs each
>    file in its own transaction, so a failing file changes nothing and the
>    ones before it stay applied.
> 3. Every migration is idempotent (`IF NOT EXISTS`, guarded `DO` blocks,
>    `ON CONFLICT DO NOTHING`), so re-running an applied one is a no-op. Do not
>    try to skip "already applied" files by hand.
> 4. Nothing destructive: no `DROP TABLE`, `TRUNCATE` or `DELETE` of your own.
>    The rollback notes below are for a human to decide on, not for you.
>
> **Step 1 — preflight (read-only).** Run
> `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/apply/verify.sql`
> and report the table. Then run these read-only counts and report them,
> because two migrations change data:
> ```sql
> -- 112 creates a contact for each paid buyer email with none:
> SELECT count(*) AS buyers_without_contact FROM (
>   SELECT DISTINCT lp.seller_user_id, lower(btrim(lp.buyer_email)) e
>   FROM license_purchases lp
>   WHERE lp.status = 'paid' AND lp.seller_user_id IS NOT NULL AND lp.buyer_email IS NOT NULL
>     AND lower(btrim(lp.buyer_email)) <> 'unknown@invalid' AND position('@' in lp.buyer_email) > 1
>     AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = lp.seller_user_id AND lower(btrim(c.email)) = lower(btrim(lp.buyer_email)))
> ) x;
> -- 123 copies old per-send statuses into decisions (only these four map):
> SELECT status, count(*) FROM beat_sends WHERE status IN ('interested','negotiating','placed','pass') GROUP BY status;
> -- 126 links project shares to contacts by email (NULLs only):
> SELECT count(*) AS shares_to_link FROM project_shares WHERE invited_email IS NOT NULL;
> ```
> Confirm `public.is_producer()` exists (migrations 119/120 created it; 122+
> need it): `SELECT to_regprocedure('public.is_producer()');`. If it is NULL,
> stop — 117–120 are not applied and must go first.
>
> **Step 2 — backup.** Tell me to take (or confirm) a Supabase backup /
> point-in-time restore marker before you continue, and wait for my go-ahead.
>
> **Step 3 — apply.** `npm run db:migrate` (it runs every file in order, each
> in its own transaction, stopping at the first error). Report the output
> without the connection string.
>
> **Step 4 — verify.** Re-run `supabase/apply/verify.sql`; every row must say
> `applied`. Then wait ~10 s for PostgREST's schema cache and, if any route
> still reports a missing column, run `NOTIFY pgrst, 'reload schema';`.
> Spot-check with read-only queries:
> ```sql
> SELECT count(*) FROM project_contacts;          -- 0 is normal before first use
> SELECT count(*) FROM contact_track_states;      -- = the 123 copy above (newest send per contact+beat)
> SELECT count(*) FROM project_shares WHERE contact_id IS NOT NULL;
> SELECT relrowsecurity FROM pg_class WHERE relname IN
>   ('project_contacts','contact_track_states','artist_portals','project_assets');  -- all true
> ```
>
> **Step 5 — record it.** Update the table in `supabase/MIGRATIONS.md`: each
> migration you applied becomes "applied YYYY-MM-DD (db:migrate)", and the
> "Confirmed applied" line moves if the whole run was clean. Commit that one
> file with a message saying what was applied and push it to the working
> branch. Do not open a pull request unless I ask.
>
> **Report back** with: the preflight table and counts, what was applied, the
> final verify table, and anything unexpected.

---

## Without psql (Supabase SQL editor)

1. Supabase dashboard → SQL editor → new query.
2. Open `supabase/apply/pending.sql`, copy **all** of it, paste, and press
   **Run with nothing selected**. The editor runs only the highlighted text
   when there is a selection — that is how a pasted migration fails with
   `syntax error at or near "created_at"`: only the middle of a
   `CREATE TABLE` ran.
3. The editor may warn about "destructive operations": the bundle contains
   `DROP POLICY IF EXISTS` / `DROP TRIGGER IF EXISTS`, which recreate
   policies and triggers in place. Nothing drops a table or data.
4. An error stops the run. The SQL editor does not keep one session or
   transaction across a pasted script, so statements before the error may
   already be applied — that is safe, because every migration is idempotent:
   fix the cause and run the whole file again. The last result is the verify
   table — every row should say `applied`.
   For the same reason the bundle never relies on a TEMP table surviving from
   one statement to the next: migration 112 builds one, which the editor drops
   before the next statement reads it (`relation "_paid_buyers" does not
   exist`), so the bundle carries a same-effect form of 112 from
   `supabase/apply/editor/`, verified to leave identical contacts.
5. Regenerate the bundle after new migrations:
   `scripts/ops/bundle-migrations.sh 112 113 … 129 > supabase/apply/pending.sql`.

## What each pending migration does, and what undoing it means

All are additive. "Undo" is for a person to decide, after a backup restore
has been ruled out.

| Migration | Adds | Data it writes | Safe to deploy code before it? | Undo |
|---|---|---|---|---|
| 112 | — | contacts for paid buyers with none | yes | delete contacts with notes `Backfilled from a completed purchase (mig 112)` |
| 113 | `creator_profiles.store_layout` | — | yes (storefront reads it separately) | drop the column |
| 115 | `track_collaborators` | — | yes (credits degrade to empty) | drop the table |
| 116 | `notifications` in realtime | — | yes (bell falls back to polling) | `ALTER PUBLICATION supabase_realtime DROP TABLE notifications` |
| 121 | `full_playback` on share tables | — | yes (reads as full) | drop the columns |
| 122–126 | artist workspace tables + columns | 123: decisions copied from `beat_sends.status`; 126: `project_shares.contact_id` from emails | **no — apply first** | drop `artist_portals`, `contact_track_states`, `project_contacts`; drop the added columns |
| 127 | `project_assets` | — | yes (Files hides itself; uploads 503) | drop the table (the stored files stay in R2 under `project-assets/`) |
| 128 | `project_comments.contact_id` | — | yes (portal comments 503) | drop the column |
| 129 | `artist_portals.auto_digest` | — | yes (the cron skips) | drop the column |

Order matters only in one place: 122–126 need `public.is_producer()` from
119, and 128 needs 125's portals to be useful. Running the full set in number
order, as both routes above do, satisfies both.
