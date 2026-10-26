# Label OS go-live — the owner's runbook

What you do, in order. Everything below was rehearsed on a throwaway Postgres
in the production state (migrations 001–129 plus a seeded producer): the bundle
ran twice with no error, changed no existing row, and left a schema identical
to a from-scratch build. Nothing was ever run against your real Supabase.

Your producer login (the account with the `creator_profiles` row) is not
edited by any of this. The only things added around it are its own `producer`
organization (migration 137) and its row in the operator list (step 1).

## 0. Before you start — read-only checks

Take a Supabase backup / note the point-in-time-restore time first (Dashboard →
Database → Backups). Then paste each query below into the SQL editor and compare
with what it must show. **If any one differs, stop and tell the orchestrator.**
None of them changes anything.

```sql
-- 1 row, value 1 (the producer; the bundle itself refuses anything else)
SELECT count(*) FROM public.creator_profiles;

-- 1 row: true
SELECT user_id IS NOT NULL FROM public.creator_profiles;

-- 1 row: 0
SELECT count(*) FROM public.projects WHERE user_id IS NULL;

-- only these types (and NULL): beat, instrumental, song, remix, loop, topline
SELECT type, count(*) FROM public.tracks GROUP BY 1;

-- 0 rows: none of the columns the bundle adds exists yet
SELECT c.table_name, c.column_name
FROM information_schema.columns c
JOIN (VALUES
    ('artist_portals', ARRAY['require_sign_in', 'sign_in_sent_at']),
    ('buyer_offers', ARRAY['buyer_email_verified']),
    ('contacts', ARRAY['artist_org_id', 'org_id', 'org_self_artist', 'search_tsv', 'secondary_category']),
    ('notifications', ARRAY['org_id']),
    ('project_assets', ARRAY['created_by', 'org_id', 'search_tsv', 'sensitivity', 'uploaded_by_contact_id']),
    ('project_comments', ARRAY['org_id', 'resolved_at', 'resolved_by', 'visibility']),
    ('project_contacts', ARRAY['can_upload', 'pitch_note']),
    ('projects', ARRAY['inbox_for_contact_id', 'org_id', 'search_tsv']),
    ('track_collaborators', ARRAY['confirmed_at', 'confirmed_by', 'created_by', 'dispute_note', 'org_id', 'party_id', 'role_detail', 'scope', 'status']),
    ('tracks', ARRAY['created_by', 'explicit', 'genre', 'isrc', 'iswc', 'language', 'master_owner', 'metadata_updated_at', 'org_id', 'p_line', 'provenance', 'recorded_on', 'samples_clearance_asset_id', 'samples_clearance_note', 'samples_declared', 'search_tsv', 'song_stage', 'version_label'])
) AS w(tbl, cols) ON w.tbl = c.table_name AND c.column_name = ANY (w.cols)
WHERE c.table_schema = 'public';

-- 0 rows: none of the tables the bundle adds exists yet
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('activity_events', 'approvals', 'artist_direction', 'artist_messages', 'artist_references', 'connection_projects', 'member_artist_scopes', 'org_connections', 'org_digest_channels', 'org_digest_members', 'org_entitlements', 'org_invitations', 'org_managed_accounts', 'org_members', 'org_overview_seen', 'org_saved_views', 'organizations', 'parties', 'platform_admins', 'project_members', 'release_items', 'releases', 'song_beats', 'song_reviews', 'split_lines', 'split_sheets', 'tasks', 'track_links', 'user_profiles');

-- 0 rows: everything in public belongs to postgres
SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public' AND tableowner <> 'postgres';

-- 15 or higher
SELECT version();
```

(The two "0 rows" lists were generated from what the bundle really creates, by
comparing a production-state database before and after the rehearsal.)

If `creator_profiles` shows more than 1 row, also run
`SELECT user_id, display_name, created_at FROM public.creator_profiles;` and send
the result to the orchestrator; do not delete anything yourself and do not run
the bundle until the count is exactly 1. (Before 26 Sep any signed-in buyer could
create such a row, so an old stray one is possible.)

## 1. Paste the migration bundle

1. Open the repo file `supabase/apply/labelos-go-live.sql` (≈ 500 KB, 11 000
   lines), select all, copy.
2. Supabase → SQL editor → new query → paste **everything**. Make sure nothing
   is highlighted, then press **Run**. (The editor runs only the highlighted
   text, which is how a half-pasted script fails.)
3. It runs in one transaction: either all of it applies or none of it does.
   If it errors, copy the message to the orchestrator; nothing was changed, and you can
   run the whole file again after the cause is fixed.
4. The last result is a table with 63 rows. **Every row must say `applied`.**
   Any `MISSING` row means that migration did not take: send the table to the
   orchestrator. One exception: the row `112_backfill_buyer_contacts` depends on
   your data (it is `MISSING` if a paid buyer still has no contact), so if it is
   the **only** `MISSING` row, that is not a failed paste.
5. If the paste errors, the editor may leave its session inside the failed
   transaction. Run `ROLLBACK;` on its own, or open a new SQL-editor tab, before
   you run anything else. Then send the error to the orchestrator.

You can re-read the verify table any time by running
`supabase/apply/labelos-verify.sql` on its own.

What the bundle contains, in order: the guard above; then every migration from
130 up, in number order: 130–135 and `139_buyer_offer_email_verified` (still
pending from main) and every Label OS migration (136–173, 189–192, including
`191_portal_contact_uploads`; `139_labelos_org_contacts` shares the number 139
with the buyer one, they are independent); your row in `platform_admins`
(chosen from `creator_profiles`, never from a typed address); the check.
Rebuild it after any later migration merges with
`scripts/ops/bundle-labelos-go-live.sh > supabase/apply/labelos-go-live.sql`.

It is safe to run again: every migration is idempotent. The first paste covers
migrations up to 173 and 189–192. Anything that merges later (174 and up) ships
as a second paste of the rebuilt bundle; running the rebuilt file over a database
that already has the first paste applied changes nothing that is already there.

## 2. Turn Label OS on

Order does not matter between step 1 and the code deploy — the code on this
branch runs both before and after the bundle (see "Order" at the end) — but
Label OS itself only appears once the flag is on.

1. Vercel → the project → Settings → Environment Variables → add
   `LABEL_OS_ENABLED` = `true` for **Production**.
2. **Redeploy** (Deployments → the latest → ⋯ → Redeploy). Changing a variable
   does not change a running deployment, and `/login` and the dashboard are
   prerendered, so they only learn the flag on a new deployment.

With the flag on, anyone who signs in or signs up at `/login` and is neither the
producer nor a member of an org is sent to `/setup` to create one (by design,
LABEL-48); buyers who sign in at `/store/account` are not affected.

With the flag on, `/o/*`, `/api/org/*`, `/setup`, `/join/<token>`, `/shared`
and `/platform` exist; with it off every one of those answers 404.

## 3. Create the first label

Sign in with your producer account (nothing about it has changed: you land in
the studio as always).

1. Open **`/platform`** (the operator console). Only accounts in
   `platform_admins` see it — you were added in step 1; everyone else gets a
   404.
2. **New licensee**: Account = *Label*, a name, the address (slug), the
   modules it gets, seats / artists limits if you want them, and the **owner's
   email**. The owner gets an invitation email and becomes the org's owner
   when they accept at `/join/<token>`. To run the label yourself, use your own
   sign-in email as the owner's email. **This self-invite has not been tested
   (manual step):** if the invitation does not arrive or cannot be accepted with
   your own address, stop and tell the orchestrator rather than working around it.
3. The org then shows in the org switcher (top bar) and under Settings →
   Organizations, and opens at `/o/<slug>`.

`/setup` is the other way in, but it is for a **new** account with no
membership: a producer account is sent to the library instead. Use `/platform`
for orgs you create; `/setup` is what a new sign-up sees.

## 4. Bring people in

From `/o/<slug>/settings` (the admin centre) → **Members**:

- **Invite** (a person who has, or will make, their own account): email + role
  (owner / admin / member / artist) + functions (marketing, legal, finance,
  A&R, …). They get an email with a `/join/<token>` link, valid for the
  address the invitation names; signed in with that address they accept it.
- **Create account** (a person who should just get a login): you type their
  company email and a first password; the page shows the password once and the
  app never stores it. They sign in with it and are asked to choose their own
  at once. You can **reset** it later, switch the account **off** and on, or
  remove them; reset and switch-off sign the person out everywhere. Use this
  for addresses the organization controls, not personal ones (invite those).
- **Self-serve sign-up**: anyone can open `/login` → Create account and pick
  *independent artist / producer* or *label*; they land on `/setup`, name their
  organization and get it with every module (limits and plans come later; you
  can narrow any org afterwards in `/platform`).
- **Share one project** with an outside collaborator without making them a
  member: the project's Members panel (`/o/<slug>/projects/<id>`), they see it
  under `/shared`.

## 5. Switching it off again

1. Vercel → delete `LABEL_OS_ENABLED` (or set it to `false`) → Redeploy.
2. Every Label OS page and route answers 404 again and your studio is exactly
   as before. The tables and their data **stay** (nothing is dropped), so
   turning it back on later finds everything where it was.
3. Two daily jobs deliberately ignore the flag: `purge-deleted-orgs` and
   `prune-org-events`. An org whose owner scheduled its deletion is still
   purged after its 30 days.

## 6. Final-apply notes

- **171 finance preset.** Before 171 the `finance` function granted nothing; now
  a member listing it gets catalog.read, business.read.internal, finance.write
  and tasks.write. On a fresh go-live there are no members yet, so nothing
  changes for anyone.
- **190 and `auth.sessions`.** "Reset password" and "Switch off" end a team
  account's sessions by deleting its rows in `auth.sessions`. Check that the
  database role that owns the function is allowed to, in the SQL editor:

  ```sql
  SELECT has_table_privilege('postgres', 'auth.sessions', 'DELETE') AS can_delete_sessions;
  ```

  `true` is what you want. If it says `false` nothing breaks: the reset still
  changes the password and records the event, and the function logs that
  sessions were not revoked (an old session would then live until it expires).
  Tell the orchestrator, so the privilege or the approach can be fixed.
- **Buckets.** Label OS audio, previews and files live in the **private** R2
  bucket (`R2_PRIVATE_BUCKET_NAME`) under `orgs/<org-id>/…`; the bucket and its
  CORS are the same ones the studio already needs. Only a released release
  published to the store copies a preview clip to the **public** bucket
  (`store-releases/…`).
- **Environment variables.** Label OS needs nothing new beyond the studio's
  existing ones (Supabase keys, R2, `RESEND_API_KEY` / `RESEND_FROM_EMAIL`,
  `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`). Optional: `DIGEST_SECRET` (a long
  random string that encrypts a saved Slack webhook; without it the service-role
  key is used; keep `DIGEST_SECRET_PREVIOUS` when you rotate it) and
  `LABEL_OS_FEED_TOKEN_SECRET` (signs calendar-feed links; same fallback).
  The new crons (`weekly-digest`, `purge-deleted-orgs`, `prune-org-events`) are
  already in `vercel.json`.

## Order: code and bundle

Either order is safe, and it was checked in a running app (flag off and on,
1440 and 390 wide, every page of the studio, storefront, buyer account, share
pages and artist portal, plus writes):

- **Code first, bundle later** (the database is as production is today): no
  page or route returns a 5xx, with the flag off or on. One real break was found
  and fixed on the way: the library, project and upload code asked for
  `org_id`, a column migration 141 adds, and failed without it. They now carry
  on without it when it does not exist yet.
- **Bundle first, code later**: the old code does not know the new tables and
  columns, which only add things.
- Label OS itself only works once both are in and the flag is on.

If you are unsure, paste the bundle first: it changes nothing you can see.
