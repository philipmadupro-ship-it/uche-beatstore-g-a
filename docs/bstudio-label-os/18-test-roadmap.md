# 18 — Test Roadmap (for the product owner)

**Written 2026-10-14 · for the owner of the beatstore · plain language, no engineering needed except the one-time setup in section 1.**

You have used the original beatstore for a long time. This file walks you through testing **the whole app**: the old producer app **and** the new Label OS. For each feature it says what changed, where to click, what you should see, how to try to break it, and what "looks wrong".

How to use it:

- Work top to bottom. Tick `[x]` when a step behaves as written. If it does not, write it down with the template in section 7 and keep going.
- **Label OS** = the new part of the app for labels, artists and producers working in teams. It lives under `/o/<org-slug>/…`.
- **Org** (organization) = a team space. There are three kinds: **label**, **artist**, **producer** (a producer's own studio).
- **Flag** = `LABEL_OS_ENABLED`, the on/off switch for everything new. Off = the app is the old app.
- **Scope** = which artists a team member may see. "Nova only" means that person sees Nova's songs and nobody else's.
- **Roster** = the artists signed to a label.
- **Gate** = a check a release must pass before it can be delivered (tracklist, masters, credits & splits, legal, artwork, metadata, marketing).
- Task ids look like `LABEL-24`. PR numbers (`#83`) are the code changes on GitHub.

## What is in this build (so you know what to expect)

| Part | Status |
|---|---|
| All 42 backlog tasks (LABEL-01 to LABEL-42) | **Built and merged** into the one Label OS branch `claude/happy-bardeen-rnosf3`. Nothing needs a second branch any more. The last three squash commits: LABEL-38 weekly digest `d2148736` (#111), LABEL-37 filters and saved views `49fb03b4` (#113), LABEL-42 released → store `31c05b74` (#110). A docs-only change (#114, `75cc8f8b`) came after |
| New since the last version of this file | **Music** page (`/o/<slug>/music`), the **filter bar and saved views** on Music and Releases (4.12), the **weekly digest** settings page (4.10), the **On the store** card and the public **Released** strip (4.16) |
| Migrations | **136 to 161 all exist** on the Label OS branch (the last five: 157 approvals, 158 store playback, 159 org search, 160 weekly digest, 161 saved views). The ledger is `supabase/MIGRATIONS.md`. None of them is applied to production |
| Daily cron | The weekly-digest job is now scheduled **every day at 07:20 UTC** (`vercel.json`). It is safe to run more than once in a week: a member gets one digest per week, later runs only pick up anyone missed |

The backlog file (`14-engineering-backlog.md`) was out of date about LABEL-31 to 36 and, before the last merges, about 37, 38 and 42. Trust `git log` and this table over it.

---

## 1. How to set up to test

**Golden rules**

1. Never apply migrations 136 and up to the **production** database. They are applied only at the final merge.
2. Always test the **Label OS branch** `claude/happy-bardeen-rnosf3`. It holds every Label OS task. **Not `main`**, which has no Label OS at all. There is no other branch to switch to.
3. With `LABEL_OS_ENABLED` off (or unset) the app behaves like the old app and every `/o/…` and `/api/org/…` address answers "Not found". That is on purpose.

### Option A. Local stack (safest, free, nothing real can break)

You need: Node, Postgres with `psql`, and about 10 minutes of an engineer's time the first time. Everything runs on your machine. The "database" is a throwaway Postgres with the real security rules turned on.

```bash
git checkout claude/happy-bardeen-rnosf3          # the only branch you need; it has all 42 tasks and migrations 136 to 161
npm install
npm run db:local:reset                            # builds the database, applies every migration twice, seeds 4 accounts
npm run db:local:up                               # starts the database API (:3000), the gateway (:54321) and a FAKE email service (:54400)
source scripts/local-db/env.sh                    # points the app at all of that and sets LABEL_OS_ENABLED=true
npm run dev -- -p 3457                            # the app: http://localhost:3457  (first page load takes ~30 s to compile)
```

`db:local:reset` needs a Postgres superuser at `postgresql://postgres:postgres@127.0.0.1:5432/postgres` (or set `LOCAL_DB_ADMIN_URL`).

**What the local stack does NOT have:** Stripe (no real checkout), realtime (the bell updates by polling about every 60 s instead of instantly), cloud storage (R2). Without R2, uploaded audio is stored on disk, **no preview clip and no waveform is made**, and the background analysis (BPM/key) may not finish. For listening tests, waveforms, and the "unlist deletes public previews" test, use Option B.

**Log in as someone (there is no login screen locally).** The local stack signs people in with a cookie you paste into the browser. Put this function in your terminal once (run it from the repo folder):

```bash
as() {   # usage: as <person> [page-to-open] [session-age-in-seconds]
  local id email
  case "$1" in
    uche)        id=0b0e1a57-0000-4000-8000-000000000001; email=producer@local.test;;
    admin)       id=0b0e1a57-0000-4000-8000-0000000000c1; email=admin@local.test;;
    ar)          id=0b0e1a57-0000-4000-8000-0000000000c2; email=ar@local.test;;
    ar-nova)     id=0b0e1a57-0000-4000-8000-0000000000c3; email=ar-nova@local.test;;
    pm)          id=0b0e1a57-0000-4000-8000-0000000000c4; email=pm@local.test;;
    marketing)   id=0b0e1a57-0000-4000-8000-0000000000c5; email=marketing@local.test;;
    legal)       id=0b0e1a57-0000-4000-8000-0000000000c6; email=legal@local.test;;
    manager)     id=0b0e1a57-0000-4000-8000-0000000000c7; email=manager@local.test;;
    producer-fn) id=0b0e1a57-0000-4000-8000-0000000000c8; email=producer-fn@local.test;;
    engineer)    id=0b0e1a57-0000-4000-8000-0000000000c9; email=engineer@local.test;;
    nova)        id=0b0e1a57-0000-4000-8000-0000000000b2; email=artist-a@local.test;;
    kilo)        id=0b0e1a57-0000-4000-8000-0000000000b3; email=artist-b@local.test;;
    nova-owner)  id=0b0e1a57-0000-4000-8000-0000000000d1; email=nova-owner@local.test;;
    ext-viewer)      id=0b0e1a57-0000-4000-8000-0000000000e1; email=ext-viewer@local.test;;
    ext-commenter)   id=0b0e1a57-0000-4000-8000-0000000000e2; email=ext-commenter@local.test;;
    ext-contributor) id=0b0e1a57-0000-4000-8000-0000000000e3; email=ext-contributor@local.test;;
    ext-editor)      id=0b0e1a57-0000-4000-8000-0000000000e4; email=ext-editor@local.test;;
    bea)         id=0b0e1a57-0000-4000-8000-0000000000b1; email=buyer@local.test;;
    *) echo "unknown person: $1" >&2; return 1;;
  esac
  node --input-type=module -e "
    import { sessionCookie } from './scripts/local-db/jwt.mjs';
    const c = sessionCookie('$id', '$email', Math.floor(Date.now() / 1000) - Number('${3:-0}'));
    console.log('document.cookie = \"' + c.name + '=' + c.value + '; path=/; max-age=2592000\"; location.href = \"${2:-/}\";');"
}
```

Then: `as admin /o/night-shift` prints one line. Open `http://localhost:3457` in the browser, open the developer console (F12 → Console), paste the line, press Enter. The page reloads signed in as that person.

- **Use one browser profile or private window per person** so you can keep several people open side by side. The cookie is shared inside one profile.
- The third argument makes the sign-in look old (seconds). `as uche /o/night-shift/settings/data 3600` = "signed in an hour ago", which is how you test the "sign in again" rule for export and delete (4.17). A normal cookie counts as "recent" for 10 minutes only, then those two acts ask you to sign in again, and the emailed sign-in link does not exist locally. Just run `as uche …` again.
- Everyone's email ends in `@local.test`.

**Create the demo label** (people, a label, two artists, an artist org). Save this as `demo-label.sql` and run it: `psql postgresql://postgres:postgres@127.0.0.1:5432/beatstore_local -f demo-label.sql`. It is safe to run twice. (I ran it on a fresh copy of the migrations. It worked, twice.)

```sql
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('0b0e1a57-0000-4000-8000-0000000000c1', 'admin@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c2', 'ar@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c3', 'ar-nova@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c4', 'pm@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c5', 'marketing@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c6', 'legal@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c7', 'manager@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c8', 'producer-fn@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000c9', 'engineer@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000d1', 'nova-owner@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000e1', 'ext-viewer@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000e2', 'ext-commenter@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000e3', 'ext-contributor@local.test'),
  ('0b0e1a57-0000-4000-8000-0000000000e4', 'ext-editor@local.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('0b0e1a57-0000-4000-8000-000000000001', 'Uche (owner)'),
  ('0b0e1a57-0000-4000-8000-0000000000c1', 'Ada Admin'),
  ('0b0e1a57-0000-4000-8000-0000000000c2', 'Sam A&R'),
  ('0b0e1a57-0000-4000-8000-0000000000c3', 'Ana A&R (Nova only)'),
  ('0b0e1a57-0000-4000-8000-0000000000c4', 'Pat Project Manager'),
  ('0b0e1a57-0000-4000-8000-0000000000c5', 'Maya Marketing'),
  ('0b0e1a57-0000-4000-8000-0000000000c6', 'Dana Legal'),
  ('0b0e1a57-0000-4000-8000-0000000000c7', 'Max Manager (Nova only)'),
  ('0b0e1a57-0000-4000-8000-0000000000c8', 'Pia Producer'),
  ('0b0e1a57-0000-4000-8000-0000000000c9', 'Enzo Engineer'),
  ('0b0e1a57-0000-4000-8000-0000000000b2', 'Nova Okafor (artist login)'),
  ('0b0e1a57-0000-4000-8000-0000000000b3', 'Kilo Reyes (artist login)'),
  ('0b0e1a57-0000-4000-8000-0000000000d1', 'Nova (runs her own artist org)'),
  ('0b0e1a57-0000-4000-8000-0000000000e1', 'Vic Viewer'),
  ('0b0e1a57-0000-4000-8000-0000000000e2', 'Cleo Commenter'),
  ('0b0e1a57-0000-4000-8000-0000000000e3', 'Cass Contributor'),
  ('0b0e1a57-0000-4000-8000-0000000000e4', 'Eddie Editor'),
  ('0b0e1a57-0000-4000-8000-0000000000b1', 'Bea Buyer (no org)')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- The producer's own studio (what migration 137 does for a real producer). Slug: uche.
SELECT public.labelos_ensure_producer_org('0b0e1a57-0000-4000-8000-000000000001');

-- The label: Night Shift Records (slug night-shift).
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  ('0b0e1a57-0000-4000-8000-00000000a001', 'Night Shift Records', 'night-shift', 'label', '0b0e1a57-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-000000000001', 'owner',  '{}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c1', 'admin',  '{}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c2', 'member', '{a_and_r}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c3', 'member', '{a_and_r}', 'artists'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c4', 'member', '{project_manager}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c5', 'member', '{marketing}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c6', 'member', '{legal}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c7', 'member', '{artist_manager}', 'artists'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c8', 'member', '{producer}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c9', 'member', '{engineer}', 'org'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000b2', 'artist', '{}', 'artists'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000b3', 'artist', '{}', 'artists')
ON CONFLICT DO NOTHING;

-- The roster: Nova Okafor and Kilo Reyes.
INSERT INTO public.contacts (id, org_id, user_id, name, email, category) VALUES
  ('0b0e1a57-0000-4000-8000-00000000b001', '0b0e1a57-0000-4000-8000-00000000a001', NULL, 'Nova Okafor', 'nova@roster.test', 'artist'),
  ('0b0e1a57-0000-4000-8000-00000000b002', '0b0e1a57-0000-4000-8000-00000000a001', NULL, 'Kilo Reyes',  'kilo@roster.test', 'artist')
ON CONFLICT DO NOTHING;
-- "Nova only" people (Ana, Max) and each artist's own login.
INSERT INTO public.member_artist_scopes (org_id, user_id, contact_id) VALUES
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c3', '0b0e1a57-0000-4000-8000-00000000b001'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000c7', '0b0e1a57-0000-4000-8000-00000000b001'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000b2', '0b0e1a57-0000-4000-8000-00000000b001'),
  ('0b0e1a57-0000-4000-8000-00000000a001', '0b0e1a57-0000-4000-8000-0000000000b3', '0b0e1a57-0000-4000-8000-00000000b002')
ON CONFLICT DO NOTHING;

-- An artist who runs her own ARTIST org (it creates her one roster entry by itself). Slug: nova-solo.
INSERT INTO public.organizations (id, name, slug, kind, created_by) VALUES
  ('0b0e1a57-0000-4000-8000-00000000a002', 'Nova Solo', 'nova-solo', 'artist', '0b0e1a57-0000-4000-8000-0000000000d1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope) VALUES
  ('0b0e1a57-0000-4000-8000-00000000a002', '0b0e1a57-0000-4000-8000-0000000000d1', 'owner', '{}', 'org')
ON CONFLICT DO NOTHING;
COMMIT;
```

The four external project people (`ext-…`) are accounts with **no** membership on purpose. You will invite them from the screen in 4.14, which tests the invitation itself.

**There is no screen to create a label, an artist org, a roster artist or a release** (see "Could not find in the app" below), which is why the SQL above exists. A release is created from the browser console, signed in as `uche` on any `/o/night-shift` page:

```js
const org = (await (await fetch('/api/org')).json()).orgs.find(o => o.slug === 'night-shift');
const roster = (await (await fetch(`/api/org/${org.id}/contacts?view=roster`)).json()).contacts;
const nova = roster.find(c => c.name === 'Nova Okafor');
const res = await fetch(`/api/org/${org.id}/releases`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Midnight EP', contact_id: nova.id, type: 'ep', target_date: '2026-12-01' }) });
console.log(res.status, await res.json());   // 201, then open /o/night-shift/releases
```

(Same pattern for a new roster artist: `POST /api/org/<id>/contacts` with `{ name: 'Rhea', category: 'artist' }`.)

**Make sample audio** (an 8 second tone; change `330` for a different tone; the file lands in `/tmp`). Name the file like real music, because the app reads tempo and key out of file names (`Midnight 140 Fm.wav` becomes the song "Midnight", 140 BPM, F minor):

```bash
node -e "const f=+process.argv[1]||330,r=44100,n=r*8,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(r,24);b.writeUInt32LE(r*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*f*i/r)),44+i*2);require('fs').writeFileSync('/tmp/Midnight 140 Fm.wav',b)" 330
```

**Emails.** The local "Resend" is fake and records every email: `curl -s http://127.0.0.1:54400/emails` lists them (the invitation link is inside); `curl -s -X DELETE http://127.0.0.1:54400/emails` clears them. **There is no fake Slack.** The Slack webhook only accepts addresses that start `https://hooks.slack.com/`, so Slack posting can only be tried against a real, throwaway Slack workspace.

**Clean up after:** uploads made locally without R2 land in `public/uploads/` and `data/orgs/…`. Delete them when done; do not commit them.

### Option B. A Vercel preview / staging with its own Supabase (closest to real, needed for audio, R2, real email)

1. Create a **second** Supabase project (call it `bstudio-staging`). Never reuse production.
2. In a terminal, `SUPABASE_DB_URL='<the staging connection string>' npm run db:migrate`. This applies **every** migration file in `supabase/migrations/` (136 to 161 on the Label OS branch; confirm with `ls supabase/migrations | tail`). **Double-check the URL points at staging before pressing Enter.** Never run this against production from this branch.
3. In Vercel → Settings → Environment Variables, set the **Preview** values only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all three from staging), and `LABEL_OS_ENABLED=true`. In staging Supabase set Auth → URL Configuration: Site URL = the preview URL, Redirect URLs include `/auth/callback`.
4. Open the preview URL of the branch. Until step 3 is done the preview runs with Label OS **off** and looks like production.
5. Real people sign in by email link. Use plus-addresses of your own (`you+ar@gmail.com`, `you+legal@gmail.com`…), one per person in the table in section 2. Create the label with the same SQL (change the emails and ids, or use the SQL editor and look the ids up in `auth.users`).
6. A person with **no** producer profile who signs in at `/login` is sent to the buyer account page (`/store/account/me`), not to the label. Open `/o/night-shift` yourself or use the invitation link. See the weak-spot note in section 2.

### What the extra settings do (and what breaks without them)

| Setting | What it is for | Without it |
|---|---|---|
| `LABEL_OS_ENABLED=true` | Turns Label OS on | Everything under `/o/…`, `/join/…`, `/shared…`, `/restore/…` and `/api/org/…` answers "Not found". The old app is untouched |
| The three Supabase values | Database and sign-in | Label OS answers "requires a database" (503). It has no fallback on purpose |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Sends invitation, digest and sign-in emails | An invitation is still created but **not emailed**; the screen tells the inviter the email did not send. Digest sends nothing. Locally, `env.sh` points these at the fake email service |
| `CRON_SECRET` | Password for scheduled jobs (org deletion purge, 2-year clean-up, weekly digest) | The jobs answer "CRON_SECRET not configured" (500) and never run. `env.sh` sets it to `local-cron` |
| `LABEL_OS_FEED_TOKEN_SECRET` | Signs release-calendar links | Falls back to the Supabase service key. If neither exists the calendar link feature errors. Setting it separately lets you rotate it without touching the database key |
| `DIGEST_SECRET` | Encrypts the Slack webhook address | Falls back to the Supabase service key. If neither exists, saving a webhook answers 503. `DIGEST_SECRET_PREVIOUS` still decrypts old ones after a change |
| `R2_*` buckets | Real audio storage, previews, waveforms | Locally: no preview or waveform for org songs. On staging: uploads fail closed if the private bucket is missing |

Trigger a scheduled job by hand: `curl -s -H "Authorization: Bearer local-cron" http://localhost:3457/api/cron/purge-deleted-orgs` (also `prune-org-events` and `weekly-digest`; the digest one is safe to run again, it sends nothing twice in the same week).

### Could not find in the app (the backlog or the plan says it should exist, I found no screen)

- A button to **create a label, artist org or producer org**. Only the producer's studio is created automatically (when the producer profile is saved).
- A button to **add an artist to a label's roster**. The Artists page says "People in this organization's directory with an artist role appear here", but nothing on the page adds one. (An artist org gets its one artist automatically.)
- A button to **start a new, not-yet-released release** (label or artist org). The only button that creates one is **Add released music** on the Releases board (owners/admins), which enters music that is **already out** (4.16). A release in progress is still created from the console snippet above. (Re-checked in `src/components/labelos` and the release pages: no other "new release" control.)
- **Approve buttons for the release gates Masters, Artwork, Marketing, Metadata.** Only the Legal gate has a button, on the song page. A release page lists the gates read-only. The only way a human can deliver is "Deliver anyway, as an owner" (4.8).
- **A parties page** (the list of rights holders). Parties are made inside the credits box. The credit "withdraw" action and a screen for an outside member's own credit are marked "not done" in the backlog.
- **A screen for the Needs-attention thresholds** (30 days) or for the legal / marketing gate switches. They live in the org's settings in the database only.
- Any **paid plan / account-tier** switch. I searched for billing, plan and subscription in the Label OS code: nothing.
- **A way for a returning label member to land on their label** after a plain sign-in (see section 2).
- Producer-account deletion "from Settings" (the studio's data page promises it; Settings only has "erase a buyer's data").

---

## 2. The people to log in as

All logins below exist after the setup in section 1 (`as <name>`). Passwords do not exist. The word **hubs** means the menu groups in the top bar.

| Login (`as …`) | Who they are | Should see | Should NOT see |
|---|---|---|---|
| `uche` (producer@) | **Owner** of the label, owner of the studio, the old producer | Everything. Hubs: Artists (Artists, **Music**, A&R inbox), Releases, Rights (Legal queue), Organization (Members, Connections). Producer extras: Profile, Settings, a top-bar Search button; the logo goes to `/library` | — |
| `admin` | **Admin** of the label | Same hubs as the owner. Can invite, change roles/abilities, scopes, rename, connect labels | Export & deletion buttons (owners only). Producer extras (not the producer) |
| `ar` | **A&R**, whole label | Artists + **A&R inbox**, Releases. Members (read only). Can rate/review, upload, edit songs, create releases, approve the **Masters** gate | Legal queue, Connections, contracts (restricted files), split percentages (can read credits, not edit), business notes |
| `ar-nova` | A&R limited to **Nova** | Same as `ar`, but only Nova's songs, releases, files, activity | Anything of Kilo: names, counts, search hits, Overview rows, calendar entries |
| `pm` | **Project manager** | Artists + A&R inbox, Releases. Business-internal notes. Approves **Metadata** | Legal queue, contracts |
| `marketing` | **Marketing** | Artists (no A&R inbox), Releases. **Finished** audio only. Approves **Artwork** and **Marketing**. Business notes | Demos, loops, toplines, stems (shown as "restricted"), rating, credits/split detail, contracts |
| `legal` | **Legal** | Artists, Releases, **Rights → Legal queue**. Credits, splits, restricted files (contracts), approves **Legal** | Working audio, rating songs, editing songs |
| `manager` | **Artist manager**, Nova only | Artists + A&R inbox, Releases for Nova. Working audio | Kilo; legal queue |
| `producer-fn` | **Producer** (a team member) | Artists, Releases, working audio, can add songs. Only **their own credit line** in splits (D2) | Other people's split lines, legal queue |
| `engineer` | **Engineer** | Same as producer | Same as producer |
| `nova` | **Roster artist** (role Artist, scope: Nova) | Overview of her own work ("Where the artists you work on stand"), Artists page with just Nova, Releases. Her stage, **every reviewer's rating and verdict**, A&R comments (decision D5). Her own Direction (artist-visible items) | Kilo, other artists' releases, "Team only" comments and notes, internal direction items, contracts, business notes, A&R inbox button (she cannot rate) |
| `kilo` | Roster artist for Kilo | Mirror image of `nova` | Everything of Nova |
| `nova-owner` | **Owner of an artist org** ("Nova Solo") | Her own org: hubs Artists (just herself), Releases, Rights, Organization (Members, **Connections**). Everything in her own org, including business notes | Night Shift Records until connected, and then only what she chose to share |
| `ext-viewer` / `ext-commenter` / `ext-contributor` / `ext-editor` | **Outside people** invited to ONE project (after you invite them, 4.14) | `/shared` (the "Projects" list) and `/shared/<project>`. Their role shown on the page. Project name, recordings, the artist's **name** | The label, the Artists page, other projects, members. No org chrome at all |
| `bea` | A **signed-in stranger** with no org (the seed buyer) | The buyer account page `/store/account/me` | `/o/…` (sent away), `/shared` unless invited, any `/api/org/…` |
| *(signed out)* | Visitor | Public store, public share links, artist portals | `/o/…` and `/shared…` send you to `/login` |
| `uche` on `/library` | **A producer using the old beatstore** | The old dashboard, unchanged (section 3) | — |

### The three org kinds — what changes

| | **Label** (Night Shift Records) | **Artist org** (Nova Solo) | **Producer org** (the studio, slug `uche`) |
|---|---|---|---|
| Created how | By hand today | By hand today. Creates its one artist automatically | **Automatically** when the producer profile is saved |
| Roles you can give | Owner, Admin, Member, **Artist** | Owner, Admin, Member | Owner, Admin, Member |
| Functions you can give | All nine (A&R, PM, Marketing, Legal, Finance, Artist manager, Producer, Engineer, Operations) | Artist manager, Producer, Engineer, Marketing, Legal, Operations | Producer, Engineer, Artist manager, Operations |
| Hubs in the top bar | Artists, Releases, Rights, Organization | Same as label | The old producer hubs (Catalog, Store, CRM) for the producer, plus Organization (Members). **No Artists / Releases / Rights hubs** |
| Roster | Many artists | Exactly one (the owner) | None |
| Connections (to another org) | Yes (needs `org.manage`) | Yes | No |
| Can be deleted from its data page | Yes (30-day countdown) | Yes | **No.** The page says it is "managed from Settings" |
| Can put releases on the public store | No (nothing is shown) | Only when connected to a label the **store owner** owns | Yes |
| Home address | `/o/<slug>` | `/o/<slug>` | `/library` for the owner, `/o/<slug>` for others |

### To verify: does the app really switch like this?

You asked for a clear **producer view**, **artist view** and **label view**, depending on your role in the label and on the kind of account. This is what the code does today. Check each line with your own eyes and mark it.

- [ ] **There is no separate "artist app" or "label app".** There is one org shell (`/o/<slug>`) and the *same pages* get narrower or wider by role and scope. Compare `uche`, `ar-nova` and `nova` on `/o/night-shift` side by side. Is the difference clear enough for you, or does it feel like the same product with pieces missing?
- [ ] **Org switcher** (top bar, left, building icon, "Organization: <name>. Switch organization"). It appears only if the person has more than one place to be: two orgs, or one org plus a shared project. Check `uche` (two orgs, the studio and Night Shift Records: **switcher shown**), `admin` (one org: **no switcher**), `nova-owner` (one org: no switcher). After you invite `ext-viewer` to a project, check that they get no switcher.
- [ ] **Entries in the switcher** show the kind and role in small capitals, such as `LABEL · OWNER`, `STUDIO · OWNER`, and a second block "Shared with me" for outside projects. An outside person with one shared project and no org does **not** get a switcher (one place only).
- [ ] **Hubs by role** (the table above). Open each persona and compare the top bar with the table. Specific checks: marketing has no "A&R inbox"; only owner/admin/legal show "Rights → Legal queue"; only owner/admin (and anyone given the ability) show "Connections".
- [ ] **Landing page.** The logo goes to `/library` for the producer and to `/o/<slug>` for everybody else. Visiting `/o/night-shift` lands on **Overview**. If a member lacks the right to see the catalogue the Overview sends them to the Members page instead.
- [ ] **A returning label member who is not a producer.** Sign out, sign in again as `ar` at `/login` (staging) or open `/`. In the code, `/library` sends anyone without a producer profile to the **buyer account page**, which has no link to the label. They must type or bookmark `/o/<slug>`. Only right after accepting an invitation do they get an "Open <org>" button. **Is that acceptable?** (Candidate bug, logged under open decisions.)
- [ ] **The producer's Search button inside a label.** As `uche` in `/o/night-shift` the top bar still shows the old **Search** button. In the code that button opens the old dashboard palette, which switches itself off under `/o/…`. Click it: does anything open? Press ⌘K / Ctrl+K: that opens the org search. If the button does nothing, note it as a bug.
- [ ] **Studio (producer org) shell.** As `uche` open `/o/uche`: producer hubs plus Organization. Members of a studio who are *not* the producer get no producer hubs (those links would open the viewer's own dashboard).
- [ ] **"Depends on the account you pay for."** I found no plan or billing logic. What you can do depends on org kind + role + function + per-person switches (+ scope). Decide whether a paid tier should exist (open decision 6).

---

## 3. Before you start: the 10-minute smoke test

### 3a. Flag OFF — the old app must be unchanged (2 min)

Start the app **without** `LABEL_OS_ENABLED` (or set it to anything but `true`/`1`; locally, `unset LABEL_OS_ENABLED` after `source env.sh`).

- [ ] `http://localhost:3457/library` loads exactly as before. Top bar: no building-icon switcher.
- [ ] `/o/night-shift`, `/join/anything`, `/shared`, `/restore/00000000-0000-4000-8000-000000000000` all answer plain "Not found".
- [ ] Open the browser console on `/library` and run `(await fetch('/api/org')).status` → `404`.
- [ ] `/settings` has no "Organizations" card.
- [ ] `/invite/anything` shows "This invite has expired" with a "Go to sign in" button (the old team invite is retired, 4.18). This one works with the flag off too.

### 3b. Flag ON — the old app should still feel the same (8 min). Sign in as `uche`.

- [ ] `/library`: tracks list, play one, open the track drawer. Same as before.
- [ ] Upload a track (the uploads tray bottom-right). Name it `Night Shift 140 Fm.wav`: it should be read as 140 BPM, F minor.
- [ ] `/projects` and a project page; `/playlists`; `/contacts` (artist cards, producers, labels tabs); an artist portal link.
- [ ] `/links`: copy a share link, open it in a private window, play. Downloads still obey the setting.
- [ ] `/store` (private window, signed out): grid loads, preview plays, add to cart works. Checkout needs Stripe keys; skip locally.
- [ ] `/store-editor` Design and Content tabs load.
- [ ] `/sales`, `/analytics`, `/calendar`, `/cover-art` open.
- [ ] **What is new for the producer with the flag on:**
  - [ ] Top bar now has the **switcher** (you have two places: the studio and Night Shift).
  - [ ] `/settings` shows an **Organizations** card (each org name, link). The old "Team members" and "Invite collaborator" cards are **gone** (LABEL-40, #95).
  - [ ] The bell: only the producer's own notifications (sales etc.), not the label's task notifications.
  - [ ] Your **CRM contacts** (`/contacts`) show none of the label's roster people. Label people never leak into the old CRM.
- [ ] Nothing in the old app should be slower, empty, or asking for something new.

If any line of 3a or 3b fails, stop and report it first: it means the old app broke.

---

## 4. Feature walkthroughs

Conventions: "as `ar`" means log in with `as ar /o/night-shift`. Check at desktop width (about 1440 px) **and** phone width (390 px: browser dev tools → device toolbar). Nothing should scroll sideways or hide the main button.

Set up once before section 4.3: as `uche` upload songs for Nova and Kilo (4.4) so there is something to look at.

### 4.1 Organization, members and invitations — LABEL-03/05/06/07/08/09 (#49, #55–#59)

**What changed.** There is now a place for a team. Every producer gets a personal "studio" org automatically (it is the old dashboard). A label has members with a **role** (owner, admin, member, artist) and **functions** (A&R, Marketing…), plus single on/off **abilities** per person and an optional **artist list** that limits whom they see. Invitations are links emailed to one address, valid 7 days, usable once.

**Where.** `/o/night-shift/settings/members` (menu: Organization → Members). Invite: the **Invite** button top right. Invitee: `/join/<token>`.

**Do this**
1. As `uche` open Members. Expect heading "<N> members" and a row per person, "You" on yours.
2. Click the org name at the top, rename it ("Night Shift Records Ltd"), press Enter. Expect the switcher and the heading to update; reload keeps it.
3. On Sam A&R's row open **⋯** → tick **Marketing**. Expect the badge to show A&R and Marketing.
4. Click **Abilities** on Sam. Switch off "Rate and review". Expect the button to read "Abilities · 1 changed". Then check as `ar`: no A&R inbox in the menu.
5. Click Sam's **Role** and choose Admin, then back to Member. Expect functions to reset when role becomes Admin.
6. Click **Invite**. Type `ext-viewer@local.test` in Email address, pick a role and functions, **Send invitation**. Expect it in the pending list. Check the fake emails: `curl -s http://127.0.0.1:54400/emails` shows the invitation with a `/join/<token>` link.
7. As `ext-viewer` open that link. Expect "Invitation" page asking you to sign in with the address it was sent to; with the right cookie you get **Accept invitation**; after accepting, **Open <org>**.
8. Back as `uche`: **⋯ → Revoke invitation** on a different pending invite. Expect toast "Invitation revoked". Open that link: "This invitation was withdrawn…".
9. Remove a member (**⋯ → Remove from organization**, confirm). They lose access on their next click.

**Try to break it**
- [ ] Open the invite link twice after accepting: "This invitation has already been used. Each link works once."
- [ ] Open an invite meant for another email while signed in as someone else: "sent to a different email address".
- [ ] Wait out / age an invitation (`UPDATE org_invitations SET expires_at = now() - interval '1 day'`): "This invitation has expired."
- [ ] Try to demote or remove the **last owner**: no buttons offered; the server answers 409 (never a raw database error).
- [ ] As `ar` (a plain member) open Members: list is readable **without email addresses**, and there is no Invite button and no ⋯ menus.
- [ ] As `admin` try to give someone the ability "manage members" via Abilities: it must not be offered (make them Admin instead).
- [ ] Type a bad email (`bob@`), an empty org name, a 200-character org name: refused with a clear message, nothing saved.
- [ ] Double-click **Send invitation**: one invitation, not two.

**Looks wrong if…** a member sees another member's email; the switcher shows an org you left; a revoked link still lets you in; a duplicate invitation appears; an error says "violates constraint" or shows a SQL word.

### 4.2 Roster artists and artist scopes — LABEL-10, LABEL-17 (#65, #74)

**What changed.** A label's artists are its own contacts (kept apart from your old CRM). A member can be limited to chosen artists. An artist has a workspace with tabs.

**Where.** `/o/night-shift/artists`; one artist at `/o/night-shift/artists/<id>` with tabs **Overview · Projects · Songs · Releases · Files · Direction · Activity** (`?tab=songs` etc.). Scope picker: Members → a row's **⋯ → Selected artists**, then the **Artists** button.

**Do this**
1. As `uche` open Artists: cards for Nova Okafor and Kilo Reyes. An **Upload audio** box is above them.
2. Open Nova. Click through every tab. Empty tabs should say what is missing, not show errors.
3. Members → Ana (A&R, Nova only) → click the **Artists** button on her row (it reads "Artists · none" for a person with no artists). In the picker, switch Kilo on. Her row now counts two artists. Switch him off again.
4. As `ar-nova` open Artists. Expect Nova only. Open `/o/night-shift/artists/0b0e1a57-0000-4000-8000-00000000b002` (Kilo's id). Expect "Not found".
5. Make a member "limited" and give them zero artists: their Artists page says "You have not been given any artists in this organization yet. An owner or admin chooses them on the Members page."

**Try to break it**
- [ ] As `ar-nova` call `/api/org/<id>/contacts` from the console: only Nova appears; no email of Kilo.
- [ ] As `ar-nova` try `POST /api/org/<id>/contacts` (add a person) and `PUT /api/org/<id>/members/artists` (widen own scope): both 403.
- [ ] Check your **old CRM** (`/contacts` as `uche`): no Nova or Kilo from the label, and the old CRM URL for a label contact does not open.
- [ ] Emoji and very long names on a contact; a name only of spaces.

**Looks wrong if…** a scoped person sees any count ("12 songs") of an artist they cannot open; the old CRM lists label people.

### 4.3 Songs, stages, reviews and the A&R inbox — LABEL-11/24/25 (#66, #83, #88)

**What changed.** A song is a track with an A&R **stage**: Inbox → In review → Shortlisted → In development → Selected, plus On hold, Passed, Archived. Moves follow a fixed table (no jumping). Each reviewer rates 1–5 with a verdict (shortlist, hold, pass, changes requested) and a note; two A&Rs' reviews sit side by side. The A&R inbox is a keyboard queue, oldest first.

**Where.** Song page `/o/night-shift/songs/<id>` (stage control at the top). Inbox `/o/night-shift/ar` (menu: Artists → A&R inbox).

**Do this** (after uploading three songs for Nova, 4.4)
1. As `ar` open the A&R inbox. Expect the three songs, oldest first.
2. Keys: **J / K** next/previous, **Space** play, **1–5** rate, **R** start a review, **S** shortlist, **H** hold, **P** pass, **C** note, **X** select. Press `J`, `4`. Expect a rating of 4 saved. Now press `S`: nothing happens, because from the Inbox a song can only go to In review (**R**), Passed (**P**) or Archived. Press **R** (start review), then `S` (shortlist) or `H` (hold) now work and the row leaves the inbox.
3. Press `C`, type "love the drums", **Ctrl+Enter**. The note placeholder says "A note for this song. Its artist reads it too."
4. Open a song page → stage control: from "In review" it offers exactly Shortlisted, Passed, On hold, Archived. Choose On hold. Expect the artist's Songs tab to show "On hold".
5. As `uche` rate the same song 2 and verdict "pass". Expect both ratings listed, an average, and neither overwrote the other.
6. As `nova` open `/o/night-shift/ar`: she sees her own songs and **both** reviewers' ratings, verdicts and notes. She cannot rate.

**Try to break it**
- [ ] As `nova` try to move her own song to "Selected": refused. She may do Inbox → In review only.
- [ ] As `ar-nova` open the song page of one of Kilo's songs: "Not found".
- [ ] Open the same song in two windows; move it to "On hold" in one, then try "Shortlisted" in the other: the second must be refused (409, "stale"), not silently overwrite.
- [ ] Hold a key down (`4` repeated) and hit `P` quickly twice: one verdict, no crash, the cursor moves on once.
- [ ] Press Space on the inbox while the player bar has a song: it must not toggle two things at once.
- [ ] A 3000-character note: refused (limit 2000).
- [ ] As `marketing` (no rating ability): no inbox button; `/o/night-shift/ar` by URL should not let them rate.

**Looks wrong if…** one reviewer's rating replaces another's; the artist sees a "Team only" note; the note text appears in the Activity feed (it must say "reviewed" only).

### 4.4 Uploads and audio — LABEL-12/13/14/15 (#68–#71)

**What changed.** Audio uploaded into a label goes to the **artist's Inbox project** and is **private** until released. Every recording has a kind: **finished** (master, instrumental, the mix of a selected song) or **working** (demo, loop, topline, stems, rough mixes). Roles decide who can hear which. Files on a project have a sensitivity (normal / restricted, e.g. contracts).

**Where.** Artists page → **Upload audio** box (choose Artist; then "New songs" or "Add to song as demo / master / instrumental / loop / topline / version"). The uploads tray shows progress. Recordings are on the song page ("Recordings", with an A/B compare when there are two). Files: artist → **Files** tab, and on `/o/night-shift/projects/<id>`.

**Do this**
1. As `uche` on Artists choose artist Nova, "New songs", pick `Midnight 140 Fm.wav`. Expect a row in the tray, then a song titled "Midnight" in Nova's Inbox with BPM 140, key F minor read from the name.
2. Upload a second file as "Add to song as master" and a third as "demo" to the same song. Open the song: Recordings lists three kinds.
3. As `marketing` open the song (once it is "Selected" or on a release; earlier it is hidden). Expect only finished recordings playable; others say **restricted** or are absent ("No recording you can play yet.").
4. On `/o/night-shift/projects/<id>` (or the artist's **Files** tab) drop in a PDF named `contract.pdf`. Contracts and split sheets are always **Restricted**; for any other file open its **⋯** menu and tick **Restricted**. As `marketing` it must not open; as `legal` it opens (and each download is logged as an event). A member who may only handle contracts (legal) adds every file they upload as restricted.

**Try to break it**
- [ ] As `ar-nova` use the Upload box: only Nova offered. Try `POST /api/org/<id>/upload/init` for Kilo's id from the console: refused.
- [ ] Open an org audio URL as a stranger (`bea`): `/api/org/<org>/audio/<song>?variant=full` → 404, not 403 (the app does not confirm it exists).
- [ ] Try `variant=wav`, `variant=stem:vocals` as `marketing`: refused.
- [ ] Upload a `.exe`, a 0-byte file, a file named `../../x.wav`: refused or sanitised; nothing stored outside the org.
- [ ] Cancel an upload mid-way; close the tab mid-way and reopen: no half song stuck in the Inbox.
- [ ] A file name that disagrees with the analyser (`beat 90 140.wav`): the app must say it was not applied and offer the choice, not guess.
- [ ] The producer's old Library upload still makes **public** previews; org uploads never do (staging: look in the public bucket).

**Looks wrong if…** a preview or file link works when pasted into a private window; the player plays a demo for marketing; a file lands in the old Library.

### 4.5 Creative direction — LABEL-26 (#93)

**What changed.** Each roster artist has a "creative direction" page: six short fields plus keywords, and references (a track, a link, a file, or a note), each visible to the artist or **internal** (team only).

**Where.** Artist → **Direction** tab (`?tab=direction`).

**Do this**
1. As `ar` fill **Sound**, **Lyrics & themes**, **Visual world**, **Influences**, **Steer away from**, **Next move**; add a keyword ("night") with Enter.
2. Add a link reference `https://example.com`, a note, a track (search by title), and an internal note.
3. As `nova` open her Direction tab: the artist-visible items show; the internal one is absent and not counted.

**Try to break it**
- [ ] Add a link `javascript:alert(1)` or `http://…`: refused (https only).
- [ ] As `nova`, `GET /api/org/<id>/artists/<her id>/references` from the console: no internal row, not even a count. Try `PATCH` on an internal reference id: 404.
- [ ] As `nova`, try to create an internal reference: 403.
- [ ] A 601-character field: refused. 41-character keyword: refused.
- [ ] A track/file the viewer cannot open appears as "restricted", not with its title.

**Looks wrong if…** the artist sees a team-only note; an unknown field is silently saved.
(Open decision: should a roster artist be able to edit their own direction at all? See section 6.)

### 4.6 Credits, parties and split sheets — LABEL-27/28 (#94, #96)

**What changed.** Credits (who did what) are now richer and use a **party** (a person or company with legal name, IPI, publisher). Credits have a status (proposed, confirmed, disputed). **Split sheets** record percentages for composition and master, versioned, and must add up to **exactly 100**; once circulated they cannot be edited, only replaced by a new version.

**Where.** Song page → **Credits** box and **Splits** box (and "Credits & rights").

**Do this**
1. As `legal` open a song. In **Credits** use "Propose a credit": pick a role (Songwriter, Producer…), choose or create the rights holder ("e.g. Nova Okafor").
2. In **Splits** start a **Composition** sheet. Add two lines: 50 and 50. Total shows live; **Circulate** (title "Send for signature") enables only at exactly 100. Save draft, Circulate. Status becomes "Circulated for signature".
3. Click **Acknowledge** on a line (as the person on it, or as legal). Then **New version** and change to 60/40: the old one reads "Replaced by a newer version. It stays on record."
4. Upload a signed PDF with "Upload signed PDF"; as `marketing` it must be unreachable.

**Try to break it**
- [ ] Three lines of 33.3333: **Circulate is disabled** with the reason; the server also answers 422 if forced from the console.
- [ ] Type 0, -5, 100.0001, "abc", 1e2 in a share box.
- [ ] Edit a circulated sheet from the console (`PATCH`): 409.
- [ ] As `producer-fn` (own line only): you see your line and nothing else of the sheet (no other names, no total).
- [ ] As `marketing`: no Credits/Splits boxes at all. As `ext-contributor`: cannot propose a credit for someone else.
- [ ] Dispute a credit with an empty reason (allowed, "optional") and with 2000 characters.
- [ ] **Old credits on your producer tracks** (library drawer) read unchanged.

**Looks wrong if…** shares sum to 99.9999 and circulate; an old version is editable; a percentage leaks to a role without rights access.

### 4.7 Legal readiness, approvals and the legal handoff — LABEL-29/30/31 (#100, #102, #105)

**What changed.** The app works out, per song, what legal still needs (L1–L14: writer legal names, IPI, publisher, signed split, samples declared…) and shows **Legal readiness** with a list of what is missing. A person can **ask** someone to approve; the approver answers **Approved** or **Changes requested** with a note. Nobody can approve their own request. If the song changes after approval, it reads **Stale — changed since approval**. **Send to legal** lands in the Legal queue; a **legal pack** can be downloaded.

**Where.** Song page → "Credits & rights" (readiness, **Samples** declaration), "Approval" box. Queue: `/o/night-shift/rights/legal` (Rights → Legal queue).

**Do this**
1. As `ar` open a song: "Legal readiness" with a percentage and **Missing** items. Under Samples choose a declaration; "yes" asks for a clearance note.
2. In **Approval** click **Send to legal**, pick Dana, add a note, optionally tick the task box, **Send to legal**. Toast "Sent to legal".
3. As `legal` open the Legal queue: the song is listed ("Asked of you"), ready ones first, oldest first. Open it, **Approve** or **Request changes** (write what must change → **Send changes**).
4. Change the song's credits after approving. Expect the chip to read **Stale** with what changed.

**Try to break it**
- [ ] As `ar`, ask yourself to approve: the person is not offered, or **Approve** is disabled with "You cannot approve a request you made yourself".
- [ ] As `ar`, call `POST /api/org/<id>/approvals/decide` for the legal gate: 403.
- [ ] As `marketing`: no Legal queue in the menu; `/o/night-shift/rights/legal` by URL → Not found.
- [ ] Ask twice quickly (double click): one open request.
- [ ] The percentage is for show: a song at 90% with a blocker must still not be approvable "by percentage".
- [ ] As `ar-nova`: the queue shows only Nova's items.

**Looks wrong if…** an approval stays "Approved" after the facts changed; legal sees songs outside their scope; an approver sees contract text they have no right to.
(Open decision: what turning the legal gate **off** should mean. Section 6.)

### 4.8 Releases, readiness gates, the board and delivery — LABEL-16/32/33 (#72, #104, #107)

**What changed.** A release is a draft with a tracklist, artwork and details. Seven **gates** are worked out for you, never ticked by hand: Tracklist, Masters, Credits & splits, Legal, Artwork, Metadata, Marketing. Delivered = a stored fact once every gate is satisfied, or the owner overrides with a written reason.

**Where.** Board: `/o/night-shift/releases` (filters All · Ready to deliver · In progress · Delivered · Cancelled, with counts; `?state=delivered`). Detail: `/o/night-shift/releases/<id>`: **Tracklist**, **Artwork**, **Details** (UPC, Label, ℗ line, © line, Genre, Target date, Release date), **Gates**, **Delivery**.

**Do this**
1. Create "Midnight EP" with the console snippet in section 1. Open the board: one row, "In progress", date line, and a strip of gates.
2. On the detail page click title to rename. In Tracklist use the "Add a song…" dropdown to add Midnight; reorder with the arrows; remove one.
3. Fill UPC with `abc`: refused. With 11 digits: refused. A valid 12/13-digit UPC with correct check digit: accepted.
4. In **Gates** each chip says a word (such as Blocked). Click "<n> to fix": a popover lists exactly what is blocking, in plain words.
5. **Delivery**: as `uche` type a Distributor. Because not every gate is satisfied, only an owner sees "Deliver anyway, as an owner"; tick it, write why, press **Deliver anyway**. Expect "Release delivered", state Delivered, and the Delivery card reading "Delivered to … · <date>".
6. Open the board with Delivered filter: it is there. A delivered release's tracklist and details are not editable.
7. Press **⋯ Release actions → Cancel release** on another draft; then **Reopen as draft**.

**Try to break it**
- [ ] As `ar` (not an owner) try to deliver a not-ready release: no override checkbox; button disabled "Only an owner can deliver a release that is not ready."
- [ ] Leave Distributor empty: button disabled, reason "Name the distributor."
- [ ] "Deliver anyway" with an empty reason: "Say why it is delivered before it is ready."
- [ ] Double-click **Mark delivered**: exactly **one** delivery and one audit entry (check the Activity tab).
- [ ] Change the target date to a bad date (`2026-02-30`): refused.
- [ ] As `marketing` open a release: read-only, no edit boxes; Delivery says "Delivering needs release access."
- [ ] As `ar-nova` open Kilo's release by URL: Not found. The board lists only Nova's releases.
- [ ] Add a Kilo song to a Nova release: refused (the choice list offers the artist's own songs only).
- [ ] Reload mid-edit; open the release in two windows, deliver in one, edit in the other: the second must be refused.
- [ ] An album with 40 tracks reorders without losing or duplicating positions.

**Looks wrong if…** a gate turns green by itself with missing data; "Ready to deliver" appears while a blocker exists; a delivered release can be edited.
(Open decisions: delivery audit atomic; legal gate off. Section 6.)

### 4.9 Metadata export and release calendar feed — LABEL-34 (#106)

**What changed.** From a release page you can download distributor metadata (CSV or JSON, with ERN-style column names) and make a personal **calendar link** (an `.ics` address for Google/Apple Calendar) showing release titles and dates.

**Where.** Release detail header: **Distributor metadata → Download CSV / Download JSON**, and **Calendar link**.

**Do this**
1. As `ar` (release writer) on a release click **Download CSV**; toast "Metadata exported" with the file name. Open it: one row per track, ISRC etc. Credits appear **only if you have rights access**: as `uche` open Members and switch off the credits-reading ability for `ar`, then export again and compare. The two files should differ only by the credits. Marketing cannot export at all (no buttons).
2. Click **Calendar link → Create calendar link**, then **Copy link**. In a private window open the copied address: an `.ics` text file with release titles and dates.
3. Click **Replace link**: toast "New link created — the old one no longer works". Try the old address: it must fail.
4. **Turn off**: the address fails. **Create calendar link** again gives a new one.

**Try to break it**
- [ ] Remove the person from the org (or leave and rejoin); their old calendar address must stay dead.
- [ ] Create the calendar address as `ar-nova`: no Kilo release in it.
- [ ] Change one character in the token, or use another org's id: not found, never a "valid but empty" calendar.
- [ ] Export a release with no tracks, with an emoji title, and with a comma/quote in the title: the CSV stays well-formed.
- [ ] The calendar shows only **titles and dates** — no artist email, no notes.

**Looks wrong if…** an old calendar address keeps working after Replace/Turn off; a scoped member's calendar names another artist's release.

### 4.10 Overview, Needs attention, My work, "since your last visit", and the weekly digest — LABEL-18/19/20/35/38 (#76, #78, #80, #108, #111)

**What changed.** The Overview is the label's morning page: **Needs attention** (exceptions first, each with a person and one next action), **My work** (+ "Waiting on others"), a table of artists × songs by stage with the next release, and **Since your last visit** (activity grouped by artist, then day, one line per person per day). An opt-in **weekly digest** (email, plus an optional Slack post) is in the same branch (migration 160).

**Where.** `/o/night-shift` (the landing page). Digest settings: `/o/night-shift/settings/digest` (the **Weekly digest** link at the top of the Members page). The cron that sends it is `/api/cron/weekly-digest`, scheduled every day at 07:20 UTC.

**Do this**
1. As `uche`: the Needs attention card. Make the three canonical items: a draft release whose target date is within 30 days and has a blocking gate; a song that has sat in a working stage (In review, Shortlisted, In development) for more than 30 days (ask your engineer to backdate its `song.stage_changed` row in `activity_events` by 40 days); an overdue task (4.13). Expect one line each, naming a person and an action link ("Unblock …", "Move it on", "Decide on it").
2. The artists table: one row per roster artist, songs by stage, "Selected" count, "Next release". Click through.
3. Look at **Since your last visit**. Reload; items you have seen no longer show as new (the "last visit" moment is one value per person, stamped when you view).
4. As `marketing`: songs you cannot hear appear as a number "N songs restricted", never a title.
5. Open the Members page → **Weekly digest**. Tick **Email me a weekly digest**. As an owner or admin you also get a **Slack** box for an incoming-webhook address (see section 5, tests 6 to 8 and 18). Run the job by hand (section 1) and read the email at `http://127.0.0.1:54400/emails`; run it again the same day: no second email.

**Try to break it**
- [ ] As `ar-nova` search the page text for "Kilo": nothing. No row, no counts, no activity line, no "restricted" count that includes Kilo's songs.
- [ ] As `nova` the header reads "Where the artists you work on stand."
- [ ] Ten uploads in ten minutes by one person show as **one** line ("uploaded 10 songs"), not ten.
- [ ] Overdue tasks: one item per person, even with 20 tasks.
- [ ] A release far in the future, a song 10 days into a stage, a task not yet due: **not** listed.
- [ ] Nothing to flag: the card reads "Nothing needs attention."
- [ ] Digest: the checks are in section 5 (tests 6, 7, 8 and 18).

**Looks wrong if…** a notification fires for every upload; numbers disagree with the Releases board; hidden artist names appear anywhere.

### 4.11 Search and the command palette — LABEL-36 (#109)

**What changed.** Inside a label, ⌘K (Ctrl+K) opens the **org's own search**. It finds artists, songs, releases, projects, and jumps straight to an object if you paste an **ISRC, ISWC, UPC or IPI**. It only returns what you may open. The old producer search still works on the old dashboard.

**Where.** Any `/o/<slug>/…` page: press ⌘K / Ctrl+K. Placeholder "Search artists, songs, releases, projects, or paste an ISRC / UPC…".

**Do this**
1. As `uche` type `mid`: Midnight appears with a one-line status (stage). Arrow keys + Enter open it. Escape closes.
2. Give a release a valid UPC, paste it into the box: it jumps to the release.
3. Search for `runn hom`-style partial words: each word matches as a start of a word.
4. As `marketing` search for a demo-only song: not found.

**Try to break it**
- [ ] As `ar-nova` type `Kilo` and the title of a Kilo song: **no result, no "N results", no count**.
- [ ] Type quotes, `&`, `|`, `:*`, `)(`, `'; drop table`: no error screen; just fewer or no results.
- [ ] Paste a valid-looking ISRC that belongs to another org: nothing.
- [ ] Empty input, one letter, 500 characters, emoji, Arabic/Cyrillic text.
- [ ] On the old `/library`, ⌘K still opens the **old** search and finds only your producer tracks, never label songs.

**Looks wrong if…** the palette lists something that gives "Not found" when clicked; a hit shows a count of hidden things.

### 4.12 Filters and saved views — LABEL-37 (#113; migration 161)

**What changed.** Label OS now has a **Music** page (every song you may open) and a **Filter** bar on both Music and Releases. You narrow the list by stage, artist, credits, splits, what is missing, release state, gates and more; each choice becomes a removable chip; and you can **save the filters as a view**. A view remembers only the *filters* (ids and choices), never the results or any names. Every time someone opens it, the list is worked out again **for that person**, through their own role and artist list. So one shared view shows the owner every artist and shows a "Nova only" member only Nova, and nobody is told how many rows they were not shown. The page address remembers the filter (`?view=<id>` for a saved view, `?f=…` for an unsaved one), so a refresh or a bookmark keeps it.

**Where.**
- Music: `/o/night-shift/music` (menu: Artists → **Music**, next to Artists and A&R inbox). Needs permission to see the catalogue; without it the page is "Not found".
- Releases: `/o/night-shift/releases`. The filter bar sits above the board. With no filter you see the normal board (and its five state buttons); with a filter you see the matching releases in the same layout, plus **Show more** if there are many.
- The bar: a **Filter** button (it shows how many filters are on, "Filter · 2"), a **Views** menu (it shows the name of the view you opened), the chips, and **Clear all**.
- Inside the **Filter** window: **Title contains**, **Stage**, **Artist**, **Created** (dates), **Has a recording of kind** (+ "Recording made" dates), **Missing**, **Release**, **Tempo and key**, **Legal approval** (only if your role can see approvals), and **Splits**, **Credits** (**Add a credit filter**) and **Involving** (only if your role can read rights). Releases have State, Type, Artist, Target date, Release date, Delivered, **Ready to deliver** and **Gates** (**Add a gate filter**). Press **Apply filters**.
- The **Views** menu: your views and shared ones listed under "Saved views" (small text says "Yours", "Yours · shared" or "Shared by <name>"), **Save as a view…**, **Update "<name>" with these filters**, **Share this view with the organization** / **Make this view just mine**, **Take this shared view down** (owners/admins, on someone else's shared view), **Delete this view**.

**Get ready (once).** You need songs with different facts, so a few filters have something to find.
1. Upload at least three songs for Nova and one for Kilo (4.4). Moving one to another stage (4.3) and uploading one more as a **demo** to a song also helps.
2. Credits (4.6), as `legal` or `uche`: give one Nova song a **Producer** credit for a person called "Pia Producer", give another Nova song a **Featured Artist** credit for "Kilo Reyes" (create each rights holder inside the credits box), and leave one song with no credits. Give two Nova songs a **Songwriter** credit. On one of them start a **Composition** split sheet with two lines that add up to 100 and circulate it (4.6); leave the other with the credit and no sheet. The filter uses the same rule as the song page's **Legal readiness** list, so the song with no circulated sheet should list a missing split there, and the other should not.
3. Legal (4.7), as `ar`: **Send to legal** for one Nova song, so it reads "waiting".
4. Every uploaded song starts with **no artwork**. I found no button that sets a song's cover from the screen; if you want one song to drop out of "Missing artwork", ask your engineer to set `cover_url` on one track in the database.

**Do this: the seven example queries.** Sign in as `uche`, open Music, press **Filter**, choose what the row says, press **Apply filters**. After each one, read the chip, then take it off with its **x** (or **Clear all**) before the next. Check that the list is exactly the songs that fit.

| # | Question | In the Filter window | The chip should read | The list should show |
|---|---|---|---|---|
| 1 | Songs produced by Pia | Credits → **Add a credit filter** → *Credited person* "Pia Producer", *Credited as* "Producer (any production role)" | `Pia Producer · Producer / Co-Producer / Executive Producer` | Only the songs with a production credit for Pia, not songs where she has another role |
| 2 | Nova's demos from September | **Artist**: Nova. **Has a recording of kind**: Demo. **Recording made**: 1 September to 30 September of the year you test in (the date is the day the demo was uploaded, so to test with today's uploads use this month's dates) | Two chips: `Nova Okafor` and `Has demo <from> – <to>` | Only Nova's songs that have a demo made in that window; none of Kilo's |
| 3 | Songs missing artwork | **Missing** → Artwork | `Missing artwork` | Every song without a cover |
| 4 | Songs waiting for legal | **Legal approval** → Waiting (the choice is only there if your role can see approvals) | `Legal: waiting` | Only the song you sent to legal and nobody has answered yet. It is a list of *songs*, not projects. After `legal` approves it, apply the filter again: the song is gone from "Waiting" |
| 5 | Everything involving Pia | Credits and splits sections → **Involving** → Pia Producer | `Involving Pia Producer` | Songs where she is credited, on a split line, uploaded it, was given a task on it, or is a member of its project |
| 6 | Unreleased songs featuring Kilo | **Release** → Unreleased, and Credits → add a filter with *Credited person* "Kilo Reyes", *Credited as* "Featured artist" | `Unreleased` and `Kilo Reyes · Featured Artist` | The Nova song with the featured credit, as long as it is not on a release. Add it to a release (4.8) and apply again: it drops out |
| 7 | Songs where splits are not complete | **Splits** → Not complete | `Splits incomplete` | The song with a Songwriter credit and no circulated sheet, and any other song whose Legal readiness still lists an open split. Not the song with the circulated 100% sheet. Choose Complete instead and the list flips. (A song with no credits at all may count as complete; I could not confirm that from the code, so note what you see) |

- [ ] Every row of the table behaves as written (any extra or missing song is a bug; write down the song's title).
- [ ] The count under the bar ("3 songs") matches the number of rows. With no filter you see "No songs yet" only when you really have none.
- [ ] Combine two filters (rows 3 and 2): the list only has songs that satisfy both. Remove one chip with its **x**: the list widens at once.
- [ ] Reload the page with a filter on: the same chips and the same list come back (the address holds the filter). **Clear all** returns the whole list and a clean address.

**Do this: releases.** Open `/o/night-shift/releases`, press **Filter**. Try State "Delivered", Type "EP", Artist "Nova Okafor", and a **Gates** filter: **Add a gate filter**, gate "Legal", status "Blocked". Expect chips such as `State: delivered`, `Legal: blocked`, and only the matching releases in the usual board layout, with the gate strip on each. **Clear all** returns to the normal board, where the five state buttons still work.

**Do this: save a view, share it, change it.**
1. As `uche` on Music apply row 3 ("Missing artwork"). Open **Views** → **Save as a view…**. Type "Missing artwork" (up to 80 characters). A tick box **Share with the organization** appears (only for people who can edit the catalogue). Tick it and press **Save view**. Toast `Saved "Missing artwork"`. The Views button now shows that name, and the address has `?view=…`.
2. Press **Clear all**, then open **Views** and pick "Missing artwork": the chip and the list come back. The row says "Yours · shared".
3. Change the filter (add Stage "Inbox") and open **Views** → **Update "Missing artwork" with these filters**: toast "View updated". **Make this view just mine** turns sharing off ("Only you can see this view now"); **Share this view with the organization** turns it back on ("Shared with the organization").
4. Now open the same view as other people (one window or private window each; `as <name> "/o/night-shift/music"`, then **Views**).

| Open it as | Expect |
|---|---|
| `ar` (A&R, whole label) | The list shows "Missing artwork" as "Shared by Uche (owner)" and the same songs the owner saw. No Update / Delete in the menu for it. |
| `ar-nova` (Nova only) | The same shared view, but **only Nova's songs**. The count is Nova's only. Nothing says how many other songs exist or are hidden. |
| `marketing` (can see the catalogue, cannot edit it) | They can open the shared view and save a *personal* view of their own, but there is **no "Share with the organization" tick box** in the save window. Their list holds only the songs their role may hear (finished music), so it can be shorter than `ar`'s. |
| `admin` | The shared view is listed. **Take this shared view down** and **Delete this view** are offered (an owner or admin may remove someone else's shared view, but never rewrite it). |
| `bea` (signed in, no org) | `/o/night-shift/music` shows "Not found" (a plain not-found page, not "forbidden"). |
| Signed out | The sign-in page. |
| `ext-viewer` (outside person on one project) | `/o/night-shift/music` is not available to them (no org pages at all). |

5. As `ar` (not the author) open the Views menu on the owner's shared view: you should not see Update, Share or Delete for it. As `uche` use **Take this shared view down**: toast "The view is personal to its author again". Reload as `ar`: the view is gone from the menu.
6. As `uche`, **Delete this view**: a question "Delete "Missing artwork"?" and, because it was shared, "It disappears for everyone it was shared with." Confirm: toast "View deleted".
7. Open Overview (or the Activity tab) as `uche`: lines such as "saved a view", "changed a saved view", "deleted a saved view" appear. They must **not** contain the view's name or its filters. Only people who may read internal business notes see them (`ar-nova` and `nova` must not).

**What "hidden" and "404" look like (and what they must not look like).**
- A view that is not yours and not shared, or a shared view that names an artist you may not see: **it is simply not in your Views menu**. If you paste its address (`?view=<id>`) into the browser, the page shows the **plain list as if you had never asked**, with no error and no hint it exists. The API answers `Not found` (404), never 403.
- A filter that names an artist you may not see (for example `ar-nova` types an address holding Kilo's id): the list is **empty or only has what you may see**, the Kilo chip is not drawn, and a small note says "Part of this view is outside what you can see, so you are shown the rest." The note never says what or how much.
- A row you cannot open is simply not there, and there is never a line like "3 more songs you cannot see".

**Try to break it**
- [ ] **A saved view names an artist the viewer cannot see.** As `uche` save and **share** a view with Artist = Nova ("Nova work"). As `ar-nova` (Nova only): it is in the menu and works. Now save and share one with Artist = Kilo ("Kilo work"). As `ar-nova`: "Kilo work" is **not listed at all**; paste `…/music?view=<its id>` (read the id from the owner's address bar): you get the normal list, no error, no Kilo anywhere on the page (use Ctrl+F for "Kilo"). In the browser console as `ar-nova`: `(await fetch('/api/org/<id>/views/run?view=<id>')).status` is `404`, and `JSON.stringify(await (await fetch('/api/org/<id>/views?subject=songs')).json())` contains no mention of Kilo or his id. (`<id>` is the org id; get it with the first line of the release snippet in section 1.)
- [ ] **Narrowed note (an unsaved filter that names an artist you cannot see).** As `ar-nova`, open Music, press **Filter**, and look at the Artist choices: only Nova is offered. Now open an address that names Kilo anyway: in the console run `location.href = '/o/night-shift/music?f=' + btoa(JSON.stringify({v:1,subject:'songs',filter:{artistIds:['0b0e1a57-0000-4000-8000-00000000b002']}})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')` (that is Kilo's id from the demo SQL). Expect an empty list, no Kilo chip, and the "Part of this view is outside what you can see" note.
- [ ] **Credits or splits without rights access.** Sign in as `marketing` (no right to read credits and splits; `producer-fn` and `engineer` also have none). Press **Filter** on Music: the **Credits**, **Involving** and **Splits** boxes are **not there**, and **Missing** has no "Credits" button. Releases: no change. Then force it from the console: `await fetch('/api/org/<id>/views', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({subject:'songs', name:'sneaky', definition:{v:1, subject:'songs', filter:{splits:'incomplete'}}})})` → `403` with a sentence that your role cannot read splits. The same filter as an unsaved address (built like the previous item, with `splits:'incomplete'` as the filter) gives an empty list and the message "Your role cannot use this filter … which you do not have access to, so it shows nothing." **A view `uche` saved with a Splits or Credits filter and shared:** open it as `marketing`: it must show nothing, with that same message; never the songs and never any credit or split value.
- [ ] **Run a view with a deleted artist.** As `uche` create a throwaway artist (console, same pattern as section 1: `POST /api/org/<id>/contacts` with `{ name: 'Rhea', category: 'artist' }`). Upload one song for Rhea, save a view with Artist = Rhea ("Rhea work"), then delete her: `DELETE /api/org/<id>/contacts/<rhea id>` (it only works for someone who sees the whole label, and it is refused with a sentence if she has a release or a connection). Open "Rhea work" again as `uche`. Expect **no error screen, no crash, no "undefined"**; the list is empty ("No songs match") or at least never holds anyone else's songs. Note exactly what you see (the Rhea chip cannot be drawn because her name is gone). If it shows **every** song instead of none, a deleted artist has widened a filter: that is a bug, mark it URGENT. Then delete the empty view from the Views menu. Do the same as a shared view and open it as `ar`: no error either.
- [ ] Press **Apply filters** with a date range the wrong way round (from after to) or an impossible date (`2026-02-30`): an error is shown in the window ("alert" text), nothing is applied.
- [ ] Save a view with an empty name: "Give the view a name". Save two views with the same name: the second is refused ("You already have a view with that name"). Name of 81 characters: not accepted past 80.
- [ ] Add six credit filters: the sixth is not offered (limit five). A very long title text (81+ characters) is refused.
- [ ] Double-click **Save view**: one view, not two.
- [ ] Two windows: delete a view in one, pick it in the other: the other falls back to the plain list (no error).
- [ ] The saved view is a definition only. In the browser's network tab, open the response of `GET /api/org/<id>/views?subject=songs`: ids and choices, no song titles, no rows.
- [ ] Phone width (390 px): the bar wraps, the Filter window scrolls, nothing runs off the side.
- [ ] Filter bar on **Releases** when migration 161 is missing (not expected here, only for a database that was not updated): the bar says "Saving views needs the latest database update" and the filters still work. Skip on the local stack.

**Looks wrong if…** a scoped or restricted person sees a song, release, artist name or number they should not; a view shows different rows to two people with the same role and scope; a hidden view returns "forbidden" instead of "not found"; the activity line contains a view name or a filter; a deleted or invisible artist makes a filter show everything.

### 4.13 Comments, tasks and notifications — LABEL-22/23 (#87, #90)

**What changed.** Comments are tied to a project and a song, can be **pinned to a moment** in the audio, are threaded, and each is either visible to the artist or **Team only**. Unresolved threads from an earlier mix are carried forward ("from mix v1"). Tasks can be assigned (song, artist, project or release); the person gets a notification only for a **direct ask**, never for an upload.

**Where.** Comments: `/o/night-shift/projects/<id>` ("Comments on …" picker, **Add a comment**, **Team only** tick, **Send**). Tasks: song page "Tasks" box (**Add**), release tasks in the artist's Releases tab. Overview: **My work** and "Waiting on others". Bell: top bar **Notifications**.

**Do this**
1. As `uche` on a project page add a comment, then a second with **Team only** ticked. The second shows a "Team only" chip.
2. As `nova` open the project: she sees the first, not the second, and has no Team only tick. She replies. As `uche` see her reply under the thread.
3. Add a new mix version (upload as "Add to song as version"). The older unresolved thread shows "from mix v1" on the new version.
4. On a song page add a task, assign it to `ar`, set a due date in the past. As `ar` the bell shows "assigned you a task", Overview **My work** lists it as overdue. Tick its checkbox: it leaves My work.
5. Upload a song as `uche`: **nobody** gets a notification.

**Try to break it**
- [ ] As `ext-commenter` / `nova`: the "Team only" tick does not exist at all (not just disabled).
- [ ] Open the **public** share link of the project (old `/projects/share/<token>`) in a private window: no Team-only comments, no org comments leak.
- [ ] Assign a task to yourself: no notification to yourself. Assign to someone outside the org: not offered.
- [ ] Empty comment, 5000-character comment, a comment with `<script>alert(1)</script>`: shown as plain text.
- [ ] Click **Send** twice fast: one comment.
- [ ] `ar-nova` assigned a task on a Kilo song: refused.
- [ ] Mark one notification read: the badge goes down by one only.

**Looks wrong if…** the bell counts uploads; the producer's old bell shows label tasks; a Team-only note reaches an artist, an outside member, or a public page.

### 4.14 Outside people on one project ("Shared with me") — LABEL-21 (#84)

**What changed.** A person with their own account can be invited to **one project** as viewer, commenter, contributor or editor, without joining the label. They see that project's songs and recordings and the artist's name, nothing else. Their uploads are new *versions* credited to them and stay with the project owner if they leave (D3).

**Where.** Owner side: `/o/night-shift/projects/<id>` → **People outside <org>** (Email address, **Role**, **Invite**; per row Role, **Downloads**, **Remove**). Outside side: `/join/<token>`, `/shared`, `/shared/<project>`.

**Do this**
1. As `uche` invite `ext-contributor@local.test` as **Contributor**. Expect "Invited as Contributor" and an email.
2. As `ext-contributor` open the link, accept ("You now have access to <project>"), click **Open <project>**. The page shows your role "Contributor", the project, recordings, the artist's name.
3. Click **Add a version** and upload `Midnight v2.wav`: "1 file added to the uploads tray." A new version appears under the song, credited to you.
4. As `uche` change that person to **Viewer**: on the next click they lose the upload box and download buttons. Switch Downloads on and off.
5. **Remove** them: the project vanishes for them immediately ("Shared with me" empty).

**Try to break it**
- [ ] As the outside person, open `/o/night-shift` and `/o/night-shift/artists`: not allowed (404 or redirect).
- [ ] Open another project's id under `/shared/<other id>`: Not found.
- [ ] Look for any trace of the label name, other artists or members' emails in the page and its network calls.
- [ ] Viewer tries to download via the direct address `…/audio/<song>?variant=full&download=1`: refused.
- [ ] Invite the same email twice with different roles; invite with a different capitalisation (`EXT-Viewer@…`).
- [ ] Set an expiry in the past (database) and reload: access ends.
- [ ] Commenter tries to upload: no button, and a forced request is refused.

**Looks wrong if…** an outsider can reach the org shell; a removed person still plays audio from an open tab on the next request; their upload disappears when they leave.

### 4.15 Artist ↔ label connection — LABEL-41 (#99)

**What changed.** An artist org can connect to a label org: one side asks, the other accepts; **the artist chooses what the label sees** (whole catalogue or selected projects) and whether the label may copy beats. Either side can end it at once. Copies keep their origin.

**Where.** `/o/night-shift/settings/connections` and `/o/nova-solo/settings/connections` (Organization → Connections; needs the "manage org" ability). A connected view: `/o/night-shift/connections/<id>`.

**Do this**
1. As `uche` on Night Shift Connections: field "Their organization's slug or an owner's email" → `nova-solo` → **Ask to connect**. Row shows "Request sent".
2. As `nova-owner` on Nova Solo Connections: the row reads "Wants to connect". **Accept**: "Connected", "Nothing yet" shared.
3. Click **Sharing**, switch on one project. Label side: "1 project".
4. As `uche` open the connection: the shared recordings are listed with an audio player. As `marketing`: only finished ones.
5. As `nova-owner` switch on "Let them copy beats into their label". As `uche`, a beat shows **Use in a label song**; click it: "Copied". The original stays in Nova's org unchanged.
6. As `nova-owner` click **End**, then **End connection**. Label side: the connection page is "Not found" on the very next click.

**Try to break it**
- [ ] A label member limited to other artists (`ar-nova` if Nova is not theirs): sees nothing of the connection.
- [ ] Another label (create one) asks for the same artist org: it must not learn whether the artist org exists beyond what you typed (no "exists/does not exist" difference).
- [ ] Decline/withdraw a request, then ask again later ("You can ask again later.").
- [ ] With copies **off**, try streaming `variant=full` from the label side: refused. Label users only get a preview-quality stream.
- [ ] Share nothing, then open the connection page: empty with the sentence "They choose what to share with you…".
- [ ] End the connection, then ask again: a new fresh request, old shares not revived.

**Looks wrong if…** the label sees a project the artist never ticked; ending the connection leaves audio playable; the copy is moved instead of copied.

### 4.16 Released → store bridge — LABEL-42 (#110; migration 158)

**What changed.** Only a **released** release can go on the public store, where everybody can listen. A release counts as released if it was entered as **already released** (a back-catalogue album), or it was **delivered and its release date has come**. A **target date never counts**. Unreleased music stays private. You choose how visitors hear it: **Preview clips** (75 seconds) or **Full songs**. Only the store owner's own studio — or an artist org connected to a label the store owner owns — can list. A label's own releases never show the card.

**Where.** Release detail → card **On the store** (shown for delivered releases). Releases board → **Add released music** (owners/admins only). Public: `/store` → a **Released** strip; `/store/releases/<id>`.

**Do this.** The easiest path is the artist org: finish 4.15 first (Nova Solo connected to Night Shift, which `uche` owns and which is the store owner). Then sign in as `nova-owner`. (The studio org also works, but it has no artists of its own: add one first with `POST /api/org/<studio id>/contacts` and `{ name: 'Rhea', category: 'artist' }`, and its board has no menu entry; type `/o/uche/releases`.)
1. Go to `/o/nova-solo/releases`. Click **Add released music**: title, artist, type, "Came out on" date in the past → **Add release** (toast "Release added"). You land on the release page; upload a song to Nova Solo's inbox (Artists page → Upload audio) and add it in Tracklist ("Add a song…").
2. On the release card **On the store**: it says "Not on the store". Choose **Preview clips**, press **Put on the store**. Toast "On the store".
3. Open `/store` signed out at **1440 px** and at **390 px**: a "Released" strip with the cover; click through to `/store/releases/<id>`: Play/Preview works; the page does not scroll sideways at 390 px.
4. Switch to **Full songs** (owner/admin only) and **Save playback**: the button now reads "Play" instead of "Preview".
5. **Take off the store**. If the music was not yet publicly out you are asked "Delete the public previews too?" with **Delete previews / Keep them**. The strip disappears.

**Try to break it**
- [ ] Deliver a release with **only a target date** (no release date), then open its **On the store** card: blocked with a sentence; `/store` shows nothing. A delivered release with a *future* release date: "This release is not out yet; it can be listed from its release date".
- [ ] Open a **label** release (Night Shift): no "On the store" card at all (labels' own stores come later).
- [ ] In Nova Solo, invite a plain **Member** and, in Members → **Abilities**, switch on the ability to create and edit releases. On an imported release that person must see "This release was entered as already out, so only an owner or an admin can put it on the store or take it off." (An artist org has no A&R function, so the ability switch is how to give them release writing.)
- [ ] In the label: as `ar` there is no **Add released music** button, and adding a track to an imported release returns 403 ("Only an owner or an admin can change a release that was entered as already out").
- [ ] With the release on the store, try to add/remove/reorder tracks: "Take this release off the store to change its tracklist".
- [ ] Try to change the release date of a delivered or imported release (console `PATCH`): 409 "The release date of a release that went out is fixed". If it has no release date, only an owner/admin can state it once.
- [ ] A release id in **UPPER CASE** in the public audio address behaves exactly like the lower-case one and shares its rate limit (see 5, test 4).
- [ ] A failed or refused listing leaves nothing public behind, and taking a release off the store puts playback back to **Preview clips** (see 5, tests 16 to 20).
- [ ] Open `/store/releases/<id>` for an unlisted release: "This release is not on the store."
- [ ] Look at the public page's data in the browser network tab: no org id, no internal track id, no storage address, no emails.

**Looks wrong if…** unreleased music is playable publicly; "Full songs" can be picked by an A&R; the 75 s clip is replaced by the whole master in preview mode.

### 4.17 Organization export, deletion and retention — LABEL-39 (#98)

**What changed.** An owner can download everything the org holds, or delete the org with a **30-day** grace period (restorable), after which everything is removed. Everyday activity older than **2 years** is pruned; audit records (members, invitations, deliveries…) are kept for the life of the org. Both acts need a sign-in from the last **10 minutes**.

**Where.** `/o/night-shift/settings/data` ("Export & deletion"; link from Members). Restore: `/restore/<org id>`.

**Do this**
1. As `uche` (fresh cookie) click **Download JSON** and **Download CSV (zip)**. Toast "Export downloaded — audio and files are not inside it; the manifest lists their keys." Open the JSON: members, people, projects, songs, comments, tasks, releases, activity. **Search it for** any webhook address or secret: none.
2. As `admin` open the page: "Owners only…"; no buttons.
3. `as uche /o/night-shift/settings/data 3600` (old sign-in): both acts ask you to sign in again ("Confirm it is you"). Locally the emailed link does not exist; use a fresh `as uche …`.
4. Type the org name exactly, press **Delete this organization…**, confirm. You land on the restore page with a countdown. `/o/night-shift` for everyone else: Not found.
5. **Restore** on that page: the org is back with everything.
6. Delete again, then age it: `UPDATE organizations SET deleted_at = now() - interval '31 days' WHERE slug = 'night-shift';` and run the purge job (`curl -H "Authorization: Bearer local-cron" http://localhost:3457/api/cron/purge-deleted-orgs`). Rows and files are gone; **other orgs and the producer's old catalogue are untouched**.
7. Retention: `UPDATE activity_events SET created_at = now() - interval '25 months' WHERE audit = false;` then run `/api/cron/prune-org-events`. Everyday events vanish; rows with `audit = true` remain.

**Try to break it**
- [ ] Type the name with a wrong letter or wrong case: the delete button stays disabled.
- [ ] As a member (`ar`), call `DELETE /api/org/<id>` from the console: 403, even with a fresh sign-in.
- [ ] Run the purge job on an org that is **not** deleted: nothing happens. Run it without the secret: 401.
- [ ] Studio (producer) org's data page: the Danger zone shows a notice instead of a Delete button.
- [ ] Delete → restore → delete: no duplicate members or events.

**Looks wrong if…** a deleted org's audio is still reachable; export contains another org's rows; the purge deletes your producer catalogue.

### 4.18 The retired old team / invite flow — LABEL-40 (#95)

**What changed.** The old "Team members / Invite collaborator" feature granted nothing and is removed. Real invitations are the new `/join/<token>` ones (4.1).

**Where.** `/invite/<anything>`; `/settings` (cards removed).

**Do this**
1. Open `/invite/abc`: "This invite has expired. Ask for a new one…" and a "Go to sign in" button. No error screen, works with the flag off too.
2. `/settings`: no Team members and no Invite collaborator cards.
3. In the console, `fetch('/api/invite')` and `fetch('/api/team')`: both 404 now.

**Try to break it**
- [ ] An old invite email you still have in your inbox: the link shows the expired page, never a sign-up.
- [ ] Nothing in the app still links to "Invite collaborator".

**Looks wrong if…** an old invite link lets someone in.

---

## 5. Known weak spots to test on purpose

These come from the independent reviews of the work, including the final reviews of LABEL-37, 38 and 42. Each is turned into one concrete test. All of them are on the one Label OS branch now; the tests that need real cloud storage say "staging with R2", the Slack test needs a throwaway Slack workspace.

| # | The worry | The test | Pass looks like |
|---|---|---|---|
| 1 | An album entered as "already released" skips every gate. Someone with a lower role could slip an unreleased demo in as a "song" | As `ar` (A&R, not owner/admin): open `/o/night-shift/releases` (no "Add released music"); from the console `POST /api/org/<id>/releases` with `imported_released:true`; on an imported release try to add a track, list it, change playback | 403 each time with "Only an owner or an admin can change a release that was entered as already out" |
| 2 | A delivered release that only has a **target** date must not be sold as "released" | In `nova-solo` create a release with the console snippet (target date only), mark it delivered with "Deliver anyway, as an owner"; open **On the store**; then visit `/store` | The card says it cannot list (a sentence), the Released strip does not show it. Same for a future release date |
| 3 | Changing the release date **after delivery** would change what counts as released | Console: `PATCH /api/org/<id>/releases/<rid>` with a new `release_date` on a delivered / imported release | 409 "The release date of a release that went out is fixed". The Details box is read-only after delivery |
| 4 | The same release id in **UPPER CASE** is treated as a different one and dodges the per-person limit (90 requests a minute). Final-review fix: the counter now uses the lower-case id on every store release address (page data, audio, cover) | Get a listed release id and an item id (open `/store/releases/<id>` and read the audio address in the browser's network tab). In a terminal send 100 requests to `/api/store/releases/<id>/audio/<item>` and watch for HTTP 429. Then send 100 more with the **ids in UPPER CASE** | UPPER CASE hits the **same** counter (the 429 comes at the same point in the combined 200, i.e. after about 90 in total, not after 90 of each), or is rejected; never an extra 90 free requests. Also try the item id in upper case, and `/api/store/releases/<ID IN UPPER CASE>` and `…/cover`: same results as lower case, never a 500 |
| 5 | **Full playback** streams the whole master. It must only happen when allowed | (a) Preview mode: the public audio address serves only the short clip, never the master. (b) Full mode: as `ar` the "Full songs" button is disabled with "Only an owner or an admin can choose full songs". (c) After **Take off the store**, the audio address answers 404. (d) Unlisted or unreleased release: 404 | Master bytes only flow for a listed, released release whose owner/admin chose Full |
| 6 | The weekly digest only reached the first 100 members | Migration 160 applied. Add 130 members and opt them in (SQL below), run the cron by hand (`/api/cron/weekly-digest`), count emails at `http://127.0.0.1:54400/emails`; run it again | 130 recipients get exactly one each; the second run sends 0 |
| 7 | Slack text could ping the whole channel (`@channel`) | A throwaway Slack workspace. Name a song `<!channel> @here & <test>`; run the digest | The Slack post shows the title as plain text, nobody is pinged, no raw `<!channel>` formatting |
| 8 | The Slack webhook address must never be shown after saving | Save a webhook. Reload the digest page; open the response of `GET /api/org/<id>/digest` in the network tab; download the org export (4.17) | The page only says "A webhook is saved."; the address is in no response and not in the export; the field is empty; typing a new one replaces it |
| 9 | Calendar links must stop working after rotate or revoke | 4.9 steps 3–4, plus: remove and re-add the person | The old address fails after Replace / Turn off / leaving |
| 10 | A scoped member must never learn out-of-scope **names or counts** | As `ar-nova`: ⌘K search "Kilo"; Overview (rows, "restricted" counts, activity); the weekly digest; the calendar address; the export request; the board | No Kilo name, title or number anywhere. Export answers 403 (owners only). "N songs restricted" may appear only for Nova's own songs that the role cannot hear |
| 11 | **Unlisting** must keep or delete public previews exactly as the question promised | Staging with R2. List a release that was never publicly out, unlist and choose **Keep them**: the clips stay in the public bucket. Do it again choosing **Delete previews**: they are removed. List a release that already came out and unlist: you are *not* asked | Result matches the button you pressed; nothing is asked when the answer would not matter |
| 12 | **Purging an org** must remove its **public copies** too | Staging with R2. List a release, delete the org, age it past 30 days, run the purge | The `store-releases/<release>/…` objects are gone from the public bucket; `/store` no longer shows it |
| 13 | **Empty or invalid input** must be refused politely everywhere | Try these in every form you meet: empty; only spaces; 1 character; the maximum +1; emoji; Arabic/Hebrew (right-to-left); `<script>alert(1)</script>`; `' OR 1=1 --`; a date `2026-02-30`; a negative number; a number with a comma; a pasted 5 MB text; a URL with spaces | A message in plain words, nothing saved, no blank white screen, no raw database or code text, markup shown as plain text |
| 14 | Double submits | Double-click: Send invitation, Mark delivered, Circulate, Put on the store, Create calendar link, Add (task) | One result each, never two |
| 15 | A signed-out visitor or a stranger guessing addresses | Signed out: `/o/night-shift`, `/o/night-shift/songs/<id>`, `/shared`, `/api/org/<id>/export`. As `bea`: same | Signed out → sign-in page. Stranger → Not found (never "forbidden", never "this exists") |
| 16 | A delivered release that has **only a target date** (no release date) must not be listed, even by calling the server directly | In `nova-solo` (connected, 4.15) deliver a release that has only a target date (test 2). Then in the console, signed in as `nova-owner`: `await fetch('/api/org/<nova-solo id>/releases/<rid>/store', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({listed:true})})` | `409` with a sentence that the release is not out yet or only a released release can be listed; `/store` and `/store/releases/<rid>` show nothing. Give it a release date in the past (an owner/admin states it once) and it can be listed |
| 17 | The weekly digest cron now runs **every day**. Every opted-in member must be reached over the days (a run that stops early leaves the rest for the next day) and nobody gets two in a week | Migration 160. With the 130 members from test 6, run the cron by hand (`/api/cron/weekly-digest`). Then simulate "missed" members: `UPDATE org_digest_members SET last_sent_week = '' WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'bulk1%@local.test')`, and run it again. Run it three more times | First run: every opted-in member gets one email (read them at `http://127.0.0.1:54400/emails`). Second run: only the members you reset get one; everyone else gets nothing more. The extra runs send nothing. Slack (if set) posts once per week per organization. The answer of each run (JSON) says how many were sent. I could not make the 45-second time budget run out locally, so "the run stopped early and tomorrow finishes it" is checked by the reset above, not by the clock |
| 18 | A **failed or refused listing** must leave no public copies behind | Staging with R2. List a release in Preview mode where one song has no preview ready yet (a fresh upload, before it is processed), or race it: in two windows, press **Put on the store** while changing the release in the other. Look in the public bucket under `store-releases/<release id>/` | The failed listing says why (for example that a preview is not ready yet; try again in a few minutes) and `/store` shows nothing. No `store-releases/<release id>/…` objects remain unless the release was already publicly listed before |
| 19 | **Taking a release off the store** puts playback back to **Preview clips** | Put a release on the store with **Full songs** (as owner/admin), take it off, then put it on again without touching the playback choice | The card says **Preview clips** after relisting, and the public audio address serves the 75 s clip, never the master. A release is never silently public as Full songs after a relist |

Bulk-member SQL for tests 6 and 17 (after the demo label exists; the last statement needs migration 160):

```sql
INSERT INTO auth.users (id, email)
SELECT ('0b0e1a57-0000-4000-8000-' || lpad(to_hex(1048576 + g), 12, '0'))::uuid, 'bulk' || g || '@local.test'
FROM generate_series(1, 130) g ON CONFLICT DO NOTHING;
INSERT INTO public.org_members (org_id, user_id, role, functions, scope)
SELECT '0b0e1a57-0000-4000-8000-00000000a001', id, 'member', '{a_and_r}', 'org'
FROM auth.users WHERE email LIKE 'bulk%@local.test' ON CONFLICT DO NOTHING;
-- needs migration 160:
INSERT INTO public.org_digest_members (org_id, user_id, enabled)
SELECT '0b0e1a57-0000-4000-8000-00000000a001', id, true
FROM auth.users WHERE email LIKE 'bulk%@local.test' ON CONFLICT DO NOTHING;
```

(The first two statements were run on a fresh database and added 130 members. The digest cron also needs Resend configured; locally `env.sh` does that.)

---

## 6. Open product decisions (you decide; I have not decided for you)

For each one: what the app does **today**, where to see it, then your answer.

### 6.1 Artist-org releases on the producer's store without the store owner's approval
- **Today:** a release of an artist org that is *actively connected* to a label the store owner owns can be put on the owner's public store by whoever in the artist org holds the release-writing ability. The store owner does not approve each release (code: `orgMayListOnStore`).
- **See it:** connect `nova-solo` to `night-shift` (4.15) with `uche` owning the store, then on a Nova Solo delivered release open **On the store**.
- **Your decision: ____________________________________________**

### 6.2 When full playback is allowed
- **Today:** a release on the store plays a 75 s preview by default; "Full songs" can be chosen **only by an owner or admin**. It does not depend on whether the release is out; listing already needs "released".
- **Your note:** full playback should depend on whether the release is going out / is out.
- **See it:** 4.16 step 4, and test 5 above.
- **Your decision (what exactly should decide it?): ____________________________________________**

### 6.3 What a roster artist (role Artist) may edit
- **Today:** the Artist role holds the "edit catalogue" ability, so a roster artist can edit **their own** creative direction and artist-visible references, upload and edit their songs. They can never see internal references, business notes or contracts.
- **See it:** `as nova`, Direction tab (4.5); song page edit boxes.
- **Your decision (team-only, or allowed?): ____________________________________________**

### 6.4 What the legal gate "off" means
- **Today:** there is no screen for it. In the org's database settings, `legal_gate: "off"` turns the Legal gate into "Not required": it no longer blocks delivery and approvals are not asked. The same exists for marketing. Credits & splits still apply.
- **See it:** `UPDATE organizations SET settings = settings || '{"legal_gate":"off"}' WHERE slug='night-shift';`, then open a release's Gates.
- **Your decision (hidden? still shown as "skipped"? who may switch it?): ____________________________________________**

### 6.5 Delivery audit should be atomic
- **Today:** marking delivered is two steps — the release is claimed as delivered, then the audit entry is written; if the second fails the first is put back. Members/invitation changes already use a single all-or-nothing database action; delivery and store listing do not.
- **Your note:** make it atomic.
- **See it:** `src/app/api/org/[orgId]/releases/[releaseId]/deliver/route.ts` (comment at the top); behaviour in 4.8.
- **Your decision (confirm, and priority): ____________________________________________**

### 6.6 A studio (producer) org can never be deleted from its data page
- **Today:** its Danger zone reads "This is your producer workspace. It is not deleted from here; your producer account and everything in it are managed from Settings." I found no way to delete the producer account in Settings (only "erase a buyer's data").
- **See it:** `as uche /o/uche/settings/data`.
- **Your decision (should there be a delete? where?): ____________________________________________**

### 6.7 Artist view vs producer view, and "what you can do depends on your role and the account you pay for"
- **Today:** one org shell; what you see and do depends on org kind + role + function + per-person switches + artist scope. There is no plan, tier or billing code. A returning label member (not a producer) lands on the buyer account page after a normal sign-in, not on their label.
- **See it:** section 2, "To verify".
- **Your decision (separate artist/producer/label experiences? paid tiers? default landing for members?): ____________________________________________**

### 6.8 Smaller questions I noticed
- Should the Needs-attention windows (30 days) be editable in a screen? **Decision: ______**
- Should a screen exist to create a label/artist org and add roster artists, or stay manual until launch? **Decision: ______**
- Should Masters, Artwork, Marketing and Metadata approvals get buttons on the release page (today only Legal has one)? **Decision: ______**

---

## 7. Bug report template and sign-off

### Bug report (copy for each problem)

```
Title (one line):
Which test (section number):
Logged in as (name from section 2) and which org:
Browser and width (desktop 1440 / phone 390):
Address (URL) when it happened:
What I clicked, in order:
 1.
 2.
 3.
What I expected:
What happened instead:
Screenshot or screen recording attached: yes / no
Did it happen again after reload? yes / no
Is it a data leak (someone saw what they should not)? yes / no   <- mark these URGENT
Anything in the red toast or on the page (exact words):
```

Rules of thumb for severity: **URGENT** = someone sees or hears what their role should hide, or the old app breaks with the flag off. **High** = a step cannot be completed. **Normal** = wrong wording, layout, a missing button. **Idea** = you would like it to work differently.

### Sign-off checklist

Tick a line only when every "Do this" step and every "Try to break it" line in that section passed on desktop **and** phone.

- [ ] 1. Setup done; demo label exists; every person in section 2 can be logged in
- [ ] 2. "To verify" list in section 2 answered (and the returning-member landing noted)
- [ ] 3a. Flag off: old app unchanged
- [ ] 3b. Flag on: old app still the same, plus the four expected changes
- [ ] 4.1 Org, members, invitations
- [ ] 4.2 Roster and artist scopes
- [ ] 4.3 Songs, stages, reviews, A&R inbox
- [ ] 4.4 Uploads and audio (working vs finished)
- [ ] 4.5 Creative direction
- [ ] 4.6 Credits, parties, split sheets
- [ ] 4.7 Legal readiness, approvals, legal queue
- [ ] 4.8 Releases, gates, board, delivery
- [ ] 4.9 Metadata export and calendar link
- [ ] 4.10 Overview, Needs attention, digest
- [ ] 4.11 Search and palette
- [ ] 4.12 Filters and saved views (Music, Releases, the seven queries, sharing, scope, no leaks)
- [ ] 4.13 Comments, tasks, notifications
- [ ] 4.14 Outside project members
- [ ] 4.15 Artist ↔ label connection
- [ ] 4.16 Released → store bridge (1440 and 390)
- [ ] 4.17 Export, deletion, retention
- [ ] 4.18 Old team/invite flow retired
- [ ] 5. All nineteen weak-spot tests run (list any skipped, and why)
- [ ] 6. Every open decision has your answer written in
- [ ] Bugs filed: ____ URGENT, ____ High, ____ Normal, ____ Ideas

**Not ready to merge into `main` until:** no URGENT bug is open, section 3 passes, and the decisions in section 6 that change behaviour (6.2, 6.4, 6.5, 6.7) are answered.

*Reminder: apply migrations 136 to 161 to production only at the final merge, and only after this roadmap is signed off. They are all on `claude/happy-bardeen-rnosf3`; nothing else is waiting on another branch.*
