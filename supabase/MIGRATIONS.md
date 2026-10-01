# Database migrations — deploy runbook

Migrations live in `supabase/migrations/NNN_descriptor.sql`, are **append-only**
and **idempotent** (`CREATE ... IF NOT EXISTS`, guarded `DO` blocks), and each
ends with `NOTIFY pgrst, 'reload schema';`. Because they're idempotent, applying
the full set in order is safe and re-runnable — that's the deploy contract.

## The rule
**Apply migrations BEFORE deploying code that depends on them.** A feature whose
table/column/index isn't live yet silently no-ops (or 500s). Apply on a
**staging** Supabase project first, then production.

## Verify locally first — always

```bash
npm run db:local:check
```

Starts a throwaway Postgres (temp dir, `127.0.0.1:55432`, never Supabase), runs
`scripts/local-db/reset.sh` against it (bootstrap, every migration twice, seed), then
`supabase/local/checks/*.sql` and each `supabase/rollback/*.down.sql`, and deletes
the database. A new migration ships with a check file of its own.

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

## Applied status

As of **2026-09-29** 001–129 are in effect on production: the owner ran the
SQL-editor bundle and its verify table reported every row `applied`.
**Pending: 130, 131, 132** (Artist Workspace, phase 3) and **133** (linked
material), **134** (contact roles) and **135** (label pitch notes) — `supabase/apply/pending.sql` carries all six. Every one is
idempotent, so the bundle is safe to run again if some were already applied. Keep the table below as the record; add new
migrations to it as **not applied** until they are run.

## History
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
| `112_backfill_buyer_contacts.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | 1 paid buyer email has no contact |
| `113_store_layout.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner; prod `/api/store` also returns a `store_layout` key) | `creator_profiles.store_layout` |
| `114_share_price_overrides.sql` | no-op on prod | columns already exist, added outside migrations |
| `115_track_collaborators.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new table; `track_collaborators` missing |
| `116_notifications_realtime.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — adds `notifications` to the realtime publication |
| `117_creator_profiles_no_self_insert.sql` | applied 2026-09-26 (manual SQL editor run, reported by owner) | security — drops the RLS policy that let any signed-in buyer insert a `creator_profiles` row |
| `118_strict_arrangements_rls.sql` | applied 2026-09-26 (manual SQL editor run, reported by owner) | security — owner-only RLS on `arrangements` (097 missed it) |
| `119_producer_only_catalogue_writes.sql` | applied 2026-09-26 (manual SQL editor run, reported by owner) | security — RLS writes to `tracks`/`projects`/`playlists` require a producer profile (apply after 117) |
| `120_producer_only_share_links.sql` | applied 2026-09-26 (manual SQL editor run, reported by owner) | security — RLS writes to `share_links` require a producer profile (needs 119) |
| `117_project_access_payment_intent.sql` | applied | reported applied by the producer 2026-09-26 |
| `118_finish_strict_owned_rows.sql` | applied | reported applied by the producer 2026-09-26 |
| `122_project_contacts.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — Artist Relationship Workspace |
| `123_contact_track_states.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — includes a one-time copy of `beat_sends.status` |
| `124_song_beat_and_credit_links.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — `tracks.beat_track_id`, `track_collaborators.contact_id`, `contacts.avatar_url` |
| `125_artist_portals.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — one portal per artist |
| `126_project_shares_contact.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — `project_shares.contact_id` + email backfill |
| `121_share_full_playback.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — per-share full track vs 75 s preview (SHARE-01) |
| `127_project_assets.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — project files (Artist Workspace, phase 2) |
| `128_portal_comments.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — `project_comments.contact_id`: an artist's portal thread |
| `129_artist_portal_auto_digest.sql` | applied 2026-09-29 (SQL editor bundle `supabase/apply/pending.sql`, verify table all `applied`, reported by owner) | new — `artist_portals.auto_digest` for the daily digest cron |
| `130_artist_messages.sql` | **not applied** | new — `artist_messages`: one thread per artist, messages + requests (phase 3) |
| `131_portal_sign_in.sql` | **not applied** | new — `artist_portals.require_sign_in` + `sign_in_sent_at` (optional email sign-in) |
| `132_song_beats.sql` | **not applied** | new — `song_beats`: a song built on several beats; backfilled from `tracks.beat_track_id` |
| `133_track_links.sql` | **not applied** | new — `track_links` (instrumental / loop / topline / version) + track types `loop`, `topline` |
| `134_contact_secondary_role.sql` | **not applied** | new — `contacts.secondary_category`: one extra role beside `category` |
| `135_portal_pitch_note.sql` | **not applied** | new — `project_contacts.pitch_note`: the pitch a label sees on a pack in their portal |

**To apply everything pending in one go** without `psql`, paste
`supabase/apply/pending.sql` (built by `scripts/ops/bundle-migrations.sh`) into
the Supabase SQL editor with nothing selected — the editor runs only the
highlighted text when something is selected, and a half-selected CREATE TABLE
fails with `syntax error at or near "created_at"`. The editor does not keep
one session across the script, so a migration whose TEMP table is read by a
later statement (112) fails there with `relation "_paid_buyers" does not
exist`; the bundle uses the same-effect form in `supabase/apply/editor/`
instead, and the bundler refuses a TEMP-table migration that has none. An
error stops the run; re-running the whole file is safe. The bundle ends with
`supabase/apply/verify.sql`, a read-only table of
which migrations are in effect. The step-by-step runbook (for a person or an
agent session) is `docs/prompts/apply-migrations.md`.

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
- `117_creator_profiles_no_self_insert.sql` — **security, apply promptly.**
  Drops `creator_profiles_insert`. A profile row is what marks the producer
  (`requireProducer`, `src/proxy.ts`), and that policy let any buyer insert
  one for themselves via PostgREST. Nothing in the app inserts through RLS;
  `/api/profile` writes with the service role.
- `113_store_layout.sql` — adds `creator_profiles.store_layout` (jsonb) for the
  Store Editor's Design mode. `/api/store` reads it in its own query, so the
  storefront survives without it, but the builder has nowhere to save.

All are idempotent, so running the full set (`npm run db:migrate`) is safe.
- `117_project_access_payment_intent.sql` — adds
  `project_access_links.stripe_payment_intent` (+ partial index) so
  `charge.refunded` / `charge.dispute.created` can revoke a bundle by setting
  `expires_at = now()`. Safe to merge before applying: the webhook retries the
  insert without the column, but refunds cannot revoke bundles until it is
  applied. Rows bought before it have no intent — revoke those by hand.
  Idempotent.

- `118_finish_strict_owned_rows.sql` — finishes 097: owner-only policies on
  `arrangements`, `project_shares`, `project_comments`, `project_tags`,
  `project_folder_items`, `playlist_tags`, `playlist_folder_items`,
  `contact_tags` (they still allowed `user_id IS NULL`). Drops
  `beat_comments_public_read`, which exposed `author_email` / `ip_hash` to
  the public anon key; the app reads comments via the service role only.
  Idempotent; replayed locally before/after with a buyer + anon probe.

- `122`–`126` — **Artist Relationship Workspace, phase 1.** Apply in order
  (124 needs nothing from 122/123, but 123's copy and 126's backfill read
  tables that must already exist, which they do from earlier migrations).
  All five are **required before the workspace code is deployed**: the
  workspace, portal and decision routes read these tables directly and answer
  `503 {"error": "...", "migration": "122"}`-style errors without them, and
  the contact page falls back to the plain CRM view. Each new table has an
  owner-only policy and a `SECURITY DEFINER` trigger refusing a row whose
  project / contact / track belongs to another owner.
  - `123` copies old per-send statuses onto the (contact, track) pair, newest
    send winning: `interested → interested`, `negotiating → selected`,
    `placed → released`, `pass → passed`. `sent` / `opened` are engagement and
    are not copied. `ON CONFLICT DO NOTHING`, so re-running never overwrites a
    decision made after the first run.
  - `126` fills `project_shares.contact_id` from `invited_email` against the
    project owner's contacts (case-insensitive), NULLs only.
  - Verified 2026-09-29 on a local Postgres 16 + PostgREST 12 replay of
    001–126 (twice, for idempotency) with seeded sends and shares, plus
    anon / buyer / producer / cross-owner probes through PostgREST.

  **Numbered 122, not 121.** `121_share_full_playback.sql` was on the
  unmerged branch `claude/lucid-ride-5j0gql`.

- `127`–`129` — **Artist Relationship Workspace, phase 2.** Apply after
  122–126. Unlike 122–126, the code degrades per feature without them:
  project files, portal comments and the daily digest each answer
  `schemaReady: false` / 503 naming their migration, and everything else in
  the workspace and portal keeps working.
  - `127` — `project_assets`: references, artwork, lyric sheets and documents
    attached to a project, stored in the PRIVATE bucket (`url` is an `r2://`
    reference, never public). `in_portal` (default false) + `portal_at` decide
    what artists see and what counts as NEW. Owner-only RLS + same-owner
    trigger.
  - `128` — `project_comments.contact_id` (ON DELETE SET NULL) + a trigger
    refusing another owner's contact: which artist's portal thread a comment
    belongs to. Share pages filter these out.
  - `129` — `artist_portals.auto_digest` (default false) for
    `/api/cron/artist-digest`.
  - Verified 2026-09-29 on the local Postgres 16 + PostgREST 12 replay of
    001–129 (twice), with RLS / trigger probes, and with 127–129 removed
    again to check each route degrades.

- `130`–`132` — **Artist Relationship Workspace, phase 3.** Apply after
  122–129. Each degrades on its own without them, like phase 2: messages
  answer `schemaReady: false` / 503 naming 130 and the portal hides its
  Messages tab; without 131 sign-in simply cannot be switched on; without
  132 "Built on" keeps one beat (`tracks.beat_track_id`) and a second beat
  answers 503.
  - `130` — `artist_messages` (author producer|artist, kind message|request,
    request_status open|done|declined, read_at, emailed_at). A check keeps
    requests artist-written and status-bearing. Owner-only RLS + same-owner
    trigger (contact and project).
  - `131` — `artist_portals.require_sign_in` (default false) and
    `sign_in_sent_at` (one sign-in email a minute).
  - `132` — `song_beats (song_track_id, beat_track_id, position)`, owner-only
    RLS + same-owner trigger, no self-reference. Backfilled once from
    `tracks.beat_track_id` (position 0), `ON CONFLICT DO NOTHING`, so a re-run
    is a no-op. `beat_track_id` stays the main beat.
  - Verified 2026-09-29 on the local Postgres 16 + PostgREST 12 replay of
    001–132 (twice), in `e2e/artist-workspace-phase3.spec.ts`, and with
    130–132 dropped again to check each route degrades.

- `133` — **Linked material.** `track_links (from_track_id, to_track_id,
  relation, position)`, one relation per pair (`instrumental`, `loop`,
  `topline`, `version`; "a song built on a beat" stays in 132's `song_beats`),
  owner-only RLS + same-owner trigger, no self-link. `tracks_type_check` is
  dropped-if-present and re-added with `loop` and `topline` (existing rows all
  satisfy it). Written without DO blocks, so it needs no editor form. The
  verify row also checks that exactly one type check exists: if production's
  constraint had a different name, the old narrower one would survive the
  DROP IF EXISTS and refuse loops, and verify would read MISSING.
  Without 133: links other than "beat" answer 503; everything else works.

- `134` — **Contact roles.** `contacts.secondary_category` (text, nullable,
  partial index): one extra role beside the main `category`, which decides
  the tabs a contact appears in on /contacts (`lib/contacts/roles.ts`).
  Without it the Producers/Labels tabs still work from `category`; saving an
  extra role fails until it is applied.

- `135` — **Portals shaped by role.** `project_contacts.pitch_note` (text,
  nullable, ≤ 2000 chars): the producer's pitch of one project to one label,
  shown on that pack in the label's portal (`lib/artist-portal/audience.ts`).
  Per link, not per project — one pack is pitched differently to two labels.
  Without it portals are still shaped by role; the pitch is just absent and
  saving one answers 503 naming 135.

Update this table when a run is confirmed.

If you add a new one, list it here until it's confirmed applied.

## Numbering
Latest applied baseline = 106; latest file on disk = 138 (136–138 Label OS, not applied), 121 is `121_share_full_playback` (SHARE-01) (next new migration = 139). When two branches both add a migration, both
claim the next number — check `git log --all -- supabase/migrations/` before
naming (we renumbered 040/041 → 046/047 once already; 096/097/098/099 each
have two independent files sharing a number from a past parallel-branch
collision (and so do 117/118: `117_creator_profiles_no_self_insert` +
`117_project_access_payment_intent`, `118_strict_arrangements_rls` +
`118_finish_strict_owned_rows`, from two security branches landing the same
day) — both sides of each pair are legitimate and applied, just
renumber the *next* new migration past 106, don't touch the existing pairs).

## Future: gate it in CI/CD
The robust end state is a deploy step that runs `npm run db:migrate` against the
target project (with `SUPABASE_DB_URL` as a CI secret) immediately before the
app deploy, so schema and code ship together and drift is impossible.

- `121_share_full_playback.sql` — adds `full_playback boolean NOT NULL DEFAULT true` to `share_links` and `project_shares`: per-share full track vs 75 s preview (`lib/share/playback.ts`). **Safe to merge before applying**: the code reads a missing column as full, so every share plays in full until it is applied; only saving the "1:15 preview" choice fails (409, with a message naming this migration). Idempotent.

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

## Label OS migrations (branch `claude/happy-bardeen-rnosf3`)
Label OS migrations live on the Label OS branch only and are **not applied to
the production database** until the owner merges that branch into `main`
(`docs/bstudio-label-os/16-execution-runbook.md`). Each one is listed here as
"Label OS — not applied (apply at final merge)" when it is added.

| Migration | Status | What it does |
|---|---|---|
| `136_labelos_org_core.sql` | **Label OS — not applied (apply at final merge)** | LABEL-03. Five new tables (`organizations`, `org_members` with per-member `cap_grants`/`cap_revokes`, `org_invitations`, `user_profiles`, `activity_events`), the `org_role` / `has_org_cap` SECURITY DEFINER helpers (mirroring `src/lib/labelos/capabilities.ts`, held equal by `capabilities.sql.test.ts`), a deferred "≥1 owner per org" trigger, and member-only RLS. No existing table is touched. Rollback: `supabase/rollback/136_labelos_org_core.down.sql` |
| `137_labelos_producer_org.sql` | **Label OS — not applied (apply at final merge)** | LABEL-07. Data only (M2): every `creator_profiles` owner gets one `producer`-kind org (name = `display_name` or "My studio", slug from the profile slug / name, next free `-2`, `-3` …) and an `owner` membership. Adds `labelos_ensure_producer_org(user)` (SECURITY DEFINER, service-role only, per-user advisory lock), which `POST /api/profile` also calls through `src/lib/labelos/personal-org.ts`; a user who already owns or created a producer org gets nothing new (an ownership transfer never spawns a second), a buyer gets nothing. No `org_id` written to any existing table. Apply after 136. Rollback: `supabase/rollback/137_labelos_producer_org.down.sql` (deletes producer orgs with no other member, drops the two functions) |
| `138_labelos_invitation_accept.sql` | **Label OS — not applied (apply at final merge)** | LABEL-08. One function, no table change: `labelos_accept_invitation(token_hash, user)` (SECURITY DEFINER, service-role only) locks the invitation, checks the user's `auth.users` email is verified (`email_confirmed_at`) and equals the invited one (trim + lower-case), revoked / used / expired, and that the inviter still holds `members.manage` (owner/admin), then writes `org_members` (scope `artists` for an artist or a member limited to named artists), marks the invitation accepted and records the `member.joined` audit event in one transaction. Accepting twice is idempotent; an existing member keeps their role. Still no INSERT policy or grant on `org_members`. Apply after 137. Rollback: `supabase/rollback/138_labelos_invitation_accept.down.sql` (drops the function; memberships and audit rows stay) |

**Numbered 136, not 122.** `main` already has 122–135 (#44, artist workspace +
portal); the Label OS branch has not merged them yet. Numbering past them keeps
the final merge free of collisions.
