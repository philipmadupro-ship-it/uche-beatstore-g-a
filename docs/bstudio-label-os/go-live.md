# Label OS go-live — the owner's runbook

What you do, in order. Everything below was rehearsed on a throwaway Postgres
in the production state (migrations 001–129 plus a seeded producer): the bundle
ran twice with no error, changed no existing row, and left a schema identical
to a from-scratch build. Nothing was ever run against your real Supabase.

Your producer login (the account with the `creator_profiles` row) is not
edited by any of this. The only things added around it are its own `producer`
organization (migration 137) and its row in the operator list (step 1).

## 0. Before you start

- Take a Supabase backup / point-in-time-restore marker (Dashboard → Database →
  Backups).
- Check the one assumption the bundle makes. In the SQL editor run:
  `SELECT count(*) FROM public.creator_profiles;` — it must say **1** (you).
  Before 26 Sep any signed-in buyer could create a profile row, so an old stray
  row is possible. The bundle refuses to run on anything but exactly one row
  and says so; nothing changes if it refuses. If it says 2 or more, run
  `SELECT user_id, display_name, created_at FROM public.creator_profiles;`,
  then **stop and tell the orchestrator**. Do not delete anything yourself and
  do not run the bundle until it is back to exactly one row.

## 1. Paste the migration bundle

1. Open the repo file `supabase/apply/labelos-go-live.sql` (≈ 500 KB, 11 000
   lines), select all, copy.
2. Supabase → SQL editor → new query → paste **everything**. Make sure nothing
   is highlighted, then press **Run**. (The editor runs only the highlighted
   text, which is how a half-pasted script fails.)
3. It runs in one transaction: either all of it applies or none of it does.
   If it errors, copy the message to Claude; nothing was changed, and you can
   run the whole file again after the cause is fixed.
4. The last result is a table with 63 rows. **Every row must say `applied`.**
   Any `MISSING` row means that migration did not take: send the table to Claude.
   You can re-read the same table any time by running
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
  Tell Claude, so the privilege or the approach can be fixed.
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
