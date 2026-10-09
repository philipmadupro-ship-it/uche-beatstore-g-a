# 14 — Engineering Backlog

**Discovery 01 · 2026-09-30**

## How to read this backlog

- **Each task is independently executable** by one agent or engineer in its own PR, **after** its dependencies merge.
- **Migration numbers are allocated at implementation time.** 122 is the next free number as of 2026-09-29. Run `git log --all -- supabase/migrations/` before naming, and register the migration in `supabase/MIGRATIONS.md`.
- **Every route task inherits the standard requirements:**
  - A Zod contract in `src/lib/contracts/`.
  - `org-access` helpers; no `user_id` filters under `/api/org/*`.
  - `errorMessage(err)` and `createLogger('api.org.…')`.
  - A two-org test and, where scoped, a two-scope test.
- **Every UI task inherits the standard requirements:** `docs/design-direction.md`, the existing primitives, reduced-motion gating, and 1440 / 390 px e2e.
- **Rollback for additive work** = feature flag off (`LABEL_OS_ENABLED`) + revert PR + optional down-script (drop new objects). Tasks state only what differs.

## Recommended execution order

```
Phase 1: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09
Phase 2: 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18
Phase 3: 19 → 20 → 21 → 22 → 23 → 41
Phase 4: 24 → 25 → 26
Phase 5: 27 → 28 → 29 → 30 → 31
Phase 6: 32 → 33 → 34 → 35 → 42
Phase 7: 36 → 37 → 38
Cross-cutting: 39 (before first external org), 40 (after 08)
Phase 8 (later, needs its own discovery): chat, workflow builder, contract generation, multi-org store — see `15-product-decisions.md`
```

Parallelisable once dependencies land: 22 ∥ 23; 25 ∥ 26; 33 ∥ 34; 37 ∥ 38; 39 alongside Phase 3+.

---

# LABEL-01 — Record product decisions D1–D10

**Area:** Product / Architecture
**Priority:** P0
**Risk:** Medium
**Workstream:** L — BStudio Label OS
**Dependencies:** Discovery 01 (this package)
**Status:** Done (2026-09-30) — see `15-product-decisions.md`

## Objective
Capture the product owner's answers to decisions D1–D10 as ADRs, so implementation tasks stop depending on open questions.

## Current State
Decisions are listed in `00-executive-summary.md` §Decisions with recommendations, but are unanswered.

## Required Change
Record the decisions. Done as one file, `docs/bstudio-label-os/15-product-decisions.md`, rather than ten ADR files. Update any backlog task whose scope changes as a result.

## Starting Code Surfaces
`docs/bstudio-label-os/00-executive-summary.md`, `05`, `06`, `10`.

## Data Changes
None.

## Security
D2 (split visibility) and D8 (private previews) are security decisions and must be explicit.

## UX
None.

## Acceptance Criteria
- Ten ADRs exist, each marked Accepted or Rejected, with the owner's name and date.
- The affected backlog tasks are amended.

## Tests
None (documentation).

## Out of Scope
Any code.

## Rollback
Revert the docs PR.

---

# LABEL-02 — Capability model as a pure module

**Area:** Permissions
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-01
**Status:** Done (2026-09-30) — [PR #47](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/47)

## Objective
A single, tested source of truth mapping role + functions → capabilities.

## Current State
No capability concept exists. Authorization is ownership (`src/lib/auth/ownership.ts`).

## Required Change
Create `src/lib/labelos/capabilities.ts`. It exports:
- The `Role`, `OrgFunction` and `Capability` unions.
- `capabilitiesFor(orgKind, role, functions)`: org kind (`artist` | `producer` | `label`) × role × functions, per `06` §2.4 and §2.4b (D1, D4).
- `recordingClass(kind)` → `finished` | `working`, deciding between `audio.finished` and `audio.working` (D4).
- `can(member, cap)`.
- The external project-role table.

The mapping follows `06-permission-model.md` §2.4 and §2.6, as amended by LABEL-01.

## Starting Code Surfaces
`src/lib/labelos/` (new), `src/lib/auth/ownership.ts` (reference only).

## Data Changes
None.

## Security
This is the permission contract. Unknown roles or functions must grant nothing.

## UX
None.

## Acceptance Criteria
- Every cell of the §2.4 and §2.6 tables is asserted.
- An unknown role or function grants nothing.
- `owner` ⊇ `admin` ⊇ any member.
- Marketing and legal never get `audio.working`; A&R never gets `rights.write`, `contracts.read` or legal approval (D4).
- A role or function the org kind does not offer grants nothing (e.g. `a_and_r` in an `artist` org).
- An external role never includes `rights.write`, `contracts.read`, `release.*` or `members.manage`.

## Tests
`src/lib/labelos/capabilities.test.ts`: a table-driven test covering every cell, plus the negative cases above.

## Out of Scope
SQL, routes, UI.

## Rollback
Revert.

---

# LABEL-03 — Org core schema + RLS helpers

**Area:** Database / Permissions
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-02
**Status:** Done (2026-10-01) — [PR #49](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/49)

## Objective
Create the tenant tables and SQL authorization helpers.

## Current State
Tenancy is `user_id`. `team_members` / `invites` are dormant (`01` §2.3).

## Required Change
Add migration `NNN_labelos_org_core.sql`:

- **Per-member overrides (from LABEL-02):** `org_members.cap_grants text[]` and `org_members.cap_revokes text[]` (default `'{}'`). Only owner/admin (`members.manage`) may write them.
- **Tables:** `organizations` (kind CHECK `artist` | `producer` | `label`; incl. `settings jsonb default '{}'`, `deleted_at`), `org_members`, `org_invitations`, `user_profiles`, and `activity_events` (schema only; used by LABEL-05/08/19).
- **Functions:** SECURITY DEFINER STABLE `org_role(uuid)` and `has_org_cap(uuid, text)` (mapping mirrors LABEL-02 exactly: org kind → roles/functions offered, function presets, role grants, implication closure, per-member grants, revokes that also remove everything implying the revoked capability, and `NEVER_GRANTABLE`), owned by `postgres`, with `search_path` set and EXECUTE granted as `is_producer()` is in 119.
- **Triggers:** "≥1 owner per org".
- **RLS:**
  - Members read their orgs and co-members.
  - Only `members.manage` writes members.
  - `activity_events`: SELECT for members; no UPDATE/DELETE policy.
- Indexes on `org_members(user_id, org_id)`.
- End with `NOTIFY pgrst`.

## Starting Code Surfaces
`supabase/migrations/`, `supabase/MIGRATIONS.md`, `supabase/migrations/119_producer_only_catalogue_writes.sql` (helper pattern).

## Data Changes
Five new tables and two functions. No existing table is touched.

## Security
There must be no policy granting INSERT on `org_members` to `authenticated` for self-join. Joining only happens through the service-role accept route.

## UX
None.

## Acceptance Criteria
- Idempotent on replay.
- `rls-final-state.test.ts` passes, with new assertions:
  - Every new-table policy references `org_id` or a membership helper.
  - `activity_events` has no UPDATE/DELETE policy.
  - `org_members` has no self-insert.

## Tests
- Extend `src/lib/security/rls-final-state.test.ts`.
- Add `src/lib/labelos/capabilities.sql.test.ts`: parse the `has_org_cap` mapping from the migration and assert it equals LABEL-02's tables (`FUNCTION_PRESETS`, `ROLES_BY_ORG_KIND`, `FUNCTIONS_BY_ORG_KIND`, `IMPLIES`, `NEVER_GRANTABLE`). Where the SQL encodes rules rather than data (override closure), also assert with fixture cases that SQL-side and TS-side results agree, via a documented pure mirror of the SQL logic if running Postgres in CI is not available.

## Out of Scope
Artists and scopes (LABEL-10); any existing table.

## Rollback
Down-script drops the five tables and two functions (no dependants yet).

---

# LABEL-04 — RLS replay guards for Label OS tables

**Area:** Security testing
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-03
**Status:** Done (2026-10-01) — [PR #53](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/53)

## Objective
Make the policy-replay test fail on the Label OS–specific mistakes before they ship.

## Current State
`rls-final-state.test.ts` guards NULL-owner and open-write mistakes only.

## Required Change
Add a reusable assertion helper, `labelOsTables()`, a list maintained in the test. For each listed table:
- RLS is enabled.
- There is no `USING (true)` policy.
- There is no policy without an `org_id` / helper / parent-EXISTS predicate.

Also add a "no new use of `is_team_member()`" assertion.

## Starting Code Surfaces
`src/lib/security/rls-final-state.test.ts`.

## Data Changes
None.

## Security
Defence in depth for every later schema task.

## UX
None.

## Acceptance Criteria
- A deliberately bad fixture migration (in-test string) fails each assertion.
- The real migrations pass.

## Tests
The same file.

## Out of Scope
Runtime DB tests.

## Rollback
Revert.

---

# LABEL-05 — Server-side org access helpers + event writer

**Area:** Backend / Permissions
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-02, LABEL-03
**Status:** Done (2026-10-01) — [PR #55](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/55)

## Objective
Route-level authorization for service-role routes, plus a single event writer.

## Current State
`requireRowOwnership` / `requireProducer` only. There is no event table writer.

## Required Change
1. `src/lib/auth/org-access.ts`:
   - `requireOrgMember(orgId)`
   - `requireOrgCapability(orgId, cap)`
   - `requireObjectAccess({ table, id, cap })`, which loads `org_id` / the artist `contact_id` / `project_id` and checks scope (`17` R3). Artist scope is a no-op until LABEL-10.
   - `scopedOrgQuery(admin, table, ctx)`.
2. `src/lib/labelos/activity.ts`: `recordEvent(admin, ctx, verb, subject, payload, { audit })`, with a closed `Verb` union.
3. Add a source-guard test: files under `src/app/api/org/**` must not contain `.eq('user_id'` or `user_id.eq`, and must import from `@/lib/auth/org-access`.

## Starting Code Surfaces
`src/lib/auth/ownership.ts` (pattern), `src/lib/security/`, `src/lib/labelos/`.

## Data Changes
None.

## Security
Membership is read live on every call. No caching in JWT or cookie.

## UX
None.

## Acceptance Criteria
- Helpers return 401 (no session), 403 (not a member / lacking the capability), 404 (object missing), and never 200 across orgs.
- The guard test fails on a fixture violation.

## Tests
- `org-access.test.ts` (vi.mock the Supabase client, as `ownership.test.ts` does).
- `activity.test.ts`.
- `org-api-source-guard.test.ts`.

## Out of Scope
Routes.

## Rollback
Revert.

---

# LABEL-06 — API gate + feature flag for Label OS namespaces

**Area:** Security / Routing
**Priority:** P0
**Risk:** Critical
**Workstream:** L
**Dependencies:** LABEL-05
**Status:** Done (2026-10-01) — [PR #56](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/56)

## Objective
Admit org members to `/api/org/*` and `/o/*` only, behind `LABEL_OS_ENABLED`, without changing any existing route's gate.

## Current State
`src/proxy.ts` 403s signed-in non-producers on all non-allowlisted `/api/*` paths and redirects them out of `(dashboard)`.

## Required Change
- `src/lib/security/api-gate.ts`: add `isLabelOsApiPath()`. For those paths the proxy requires "has any `org_members` or `project_members` row", not producer. For all other paths, behaviour is unchanged.
- `src/proxy.ts`: when the flag is off, `/api/org/*` and `/o/*` return 404. `/o/*` pages require a session and any membership.
- `/api/org/*` returns 503 when Supabase is not configured.

## Starting Code Surfaces
`src/lib/security/api-gate.ts`, `src/lib/security/api-gate.test.ts`, `src/proxy.ts`.

## Data Changes
None.

## Security
This is the boundary between the producer app and Label OS (R-03).

## UX
None.

## Acceptance Criteria
- A table test over every existing `src/app/api/*` top-level folder: a member-only user is 403 on all non-public ones.
- A buyer is 403 on `/api/org/*`.
- The producer is unaffected everywhere.
- Flag off → 404.

## Tests
- Extend `api-gate.test.ts`.
- Add a proxy unit test with a mocked `isProducer` / `hasMembership`.

## Out of Scope
Routes behind the gate.

## Rollback
One-function revert; flag off.

---

# LABEL-07 — Personal org for the existing producer

**Area:** Data migration
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-03
**Status:** Done (2026-10-01) — [PR #57](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/57)

## Objective
Give the producer an `owner` membership of a `producer`-kind org, so they can invite people and switch orgs.

## Current State
One `creator_profiles` row identifies the producer.

## Required Change
Add an idempotent data migration. For each `creator_profiles.user_id` without an org, insert an `organizations` row (name = `display_name` or "My studio", `kind = producer`) and an `org_members` owner row. Also make `/api/profile` POST ensure the same, via an idempotent helper.

## Starting Code Surfaces
`supabase/migrations/`, `src/app/api/profile/route.ts`.

## Data Changes
Rows in the two new tables only. **No `org_id` is written to existing tables** (that is M7, out of scope).

## Security
Only `creator_profiles` owners get orgs. Buyers do not.

## UX
None yet.

## Acceptance Criteria
- A replay creates no duplicates.
- Exactly one owner membership per producer.

## Tests
- Migration replay in the local DB script.
- A route test for the profile helper.

## Out of Scope
Backfilling `tracks.org_id` / `projects.org_id`.

## Rollback
Delete the org rows where `kind = 'producer'` and no other members exist.

---

# LABEL-08 — Org invitations: create, accept, revoke

**Area:** Membership
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-05, LABEL-06, LABEL-07
**Status:** Done (2026-10-02) — [PR #58](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/58)

## Objective
A working invitation flow for org members.

## Current State
The `invites` flow is non-functional (`01` §2.3).

## Required Change
- **`POST /api/org/[orgId]/invitations`** (`members.manage`):
  - 32-byte token; store its sha-256.
  - Email normalised with `normalizeEmail`.
  - Role, functions and `contact_ids` (the artists, validated later by LABEL-10). **Only the roles and functions the org kind offers** can be invited (`06` §2.4b); anything else → 400.
  - 7-day expiry.
  - Rate limit via `rate_limits`.
  - Send email through Resend.
- **`DELETE`** revokes.
- **`POST /api/org/join`** requires a session whose email equals the invited email, then writes `org_members` (and scopes). Marks the invite accepted. Records `member.joined` (audit).
- **Page `src/app/(label)/join/[token]/page.tsx`:** signs in via the existing magic link/Google, then calls join.

## Starting Code Surfaces
`src/app/api/invite/route.ts` (pattern, Resend usage), `src/lib/contacts/email.ts`, `src/lib/security/rate-limit.ts`.

## Data Changes
Rows only.

## Security
R-06:
- The token is never logged.
- An email mismatch returns 403 without revealing the invite's email.
- Accepting twice is idempotent.

## UX
One modal for invite. The join page follows auth-page styling with correct contrast (fixes R-22 by replacement).

## Acceptance Criteria
- Accept, expired, revoked, mismatched-email and reused-token paths all behave correctly.
- A buyer account accepting becomes a member but is still 403 on producer routes.

## Tests
- Route tests for each path.
- e2e: invite → magic link (stubbed) → org visible.

## Carried from LABEL-06 (#56)
`src/proxy.ts` sends any signed-in non-producer who opens `/login` to `/store/account/me`. A member-only user (an invitee, a buyer who joined) who signs in through `/login?next=/o/...` is therefore bounced away from Label OS. The OAuth callback honours `next`, but the `/login` page itself is gated. The join flow must land the invitee on `/o/...` after sign-in. Either sign in from the join page itself, or let `/login` honour a `next` under `/o/` or `/join/` for users with a membership. Do not loosen the rule for any other `next`.

## Out of Scope
External project invites (LABEL-21); removing the old flow (LABEL-40).

## Rollback
Flag off; revert.

---

# LABEL-09 — Label shell: route group, org switcher, members page

**Area:** Frontend
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-06, LABEL-08
**Status:** Done (2026-10-02) — [PR #59](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/59). **Phase 1 complete.**

## Objective
A navigable Label OS shell with member management.

## Current State
Nav is a single hub set (`src/components/nav/model.ts`).

## Required Change
- `src/app/(label)/o/[orgSlug]/layout.tsx` (mounts `PlayerBar`, per the `CLAUDE.md` player rule).
- `navGroupsFor(orgKind, caps)` in `model.ts` (pure).
- An org switcher in `TopBar`.
- `/o/[orgSlug]/settings/members`: list, change role/functions/scope, remove (`confirmToast`), invite (modal).
- Routes `GET /api/org`, `GET/PATCH/DELETE /api/org/[orgId]/members`.

## Starting Code Surfaces
`src/components/nav/model.ts`, `src/components/nav/TopBar.tsx`, `src/components/ui/*`.

## Data Changes
None.

## Security
The last owner cannot be removed or demoted (DB trigger + route 409).

## UX
- The producer org renders the existing hubs unchanged.
- The switcher is hidden when the user has exactly one org and no shared projects.

## Acceptance Criteria
- With a producer-only account, the UI is identical to today (snapshot of nav model output).
- An admin can change a member's functions.

## Tests
- `model.test.ts` for `navGroupsFor`.
- Route tests.
- e2e at 1440 and 390.

## Carried from LABEL-05 (#55)
`org-api-source-guard.test.ts` forbids every `user_id` equality filter under `src/app/api/org/**`, but changing a member's role or removing a member addresses an `org_members` row by `(org_id, user_id)`. Add a helper for that in `src/lib/auth/org-access.ts` (for example `memberRowQuery(admin, ctx, userId)`, always org-filtered and capability-checked). Do not add an allowlist to the guard.

## Carried from LABEL-07 (#57)
The producer's personal org is named once, from `display_name` (or "My studio"), when it is created. Renaming the producer does not rename the org. The switcher shows the org name, so an owner needs to be able to rename it. Add `PATCH /api/org/[orgId]` `{ name }` (capability `org.manage`, `org.settings_changed` audit event) with an inline rename in settings. Keep it to the name; the slug stays.

## Carried from LABEL-08
- Mount `src/components/labelos/InviteMemberModal.tsx` (built and tested in LABEL-08) on the members page; it posts to `POST /api/org/[orgId]/invitations`. List pending invitations there with a Revoke action (`DELETE /api/org/[orgId]/invitations/[invitationId]`); the GET listing is this task's.
- `/join/<token>` ends on "Open <org>" → `/o/<slug>`. Until this task adds `(label)/o/[orgSlug]`, that link 404s (behind the flag).

## Out of Scope
Artist scope UI (LABEL-10).

## Rollback
Flag off.

---

# LABEL-10 — Org-scoped contacts as the artist roster + artist scopes

**Area:** Roster / Permissions
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-09
**Status:** Done (2026-10-02) — [PR #65](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/65)

## Objective
The artist roster is the org's contacts in workspace mode (`17` R3), and members can be limited to some artists.

## Current State
- `main` (#44): an artist is a contact in workspace mode (`lib/contacts/relationship.ts#isWorkspaceMode`), with role tabs (`lib/contacts/roles.ts`).
- Contacts are producer-owned (`user_id`) and know nothing about orgs.

## Required Change
- **Migration (expand):**
  - `contacts.org_id` (nullable FK, indexed).
  - `member_artist_scopes(org_id, user_id, contact_id)`.
  - SQL `can_see_artist(org uuid, contact uuid)`.
  - An additive SELECT policy `org_member_read` on `contacts`: `org_id IS NOT NULL AND has_org_cap(org_id,'catalog.read') AND can_see_artist(...)`.
  - A same-org trigger on `member_artist_scopes`.
  - **No change to producer rows** (`org_id IS NULL`) or to existing policies.
- **Routes:**
  - `/api/org/[orgId]/contacts[/id]` CRUD for org contacts.
  - Roster = the org contacts that `isWorkspaceMode` accepts, plus any contact with an artist role in an org (Q2 answered yes on 2026-10-02: label orgs have their own directory).
- **Artist orgs (D1):** creating an `artist`-kind org creates one contact for the owner, which is that org's single roster entry.
- **Wiring:** `requireObjectAccess` artist scope becomes live (by `contact_id`). Invitations accept `contact_ids` (renamed from `artist_ids`).

## Starting Code Surfaces
`src/lib/contacts/relationship.ts`, `src/lib/contacts/roles.ts`, `src/lib/auth/org-access.ts`, `docs/bstudio-label-os/17-reconciliation-with-artist-workspace.md`.

## Data Changes
One nullable column, one table, one function, one additive policy.

## Security
- R-04 pattern: `org_member_read` must require `org_id IS NOT NULL`, and the replay test asserts it.
- An artist-role member is always scoped. `scope = 'artists'` with zero contacts sees nothing.

## UX
None beyond the roster list (it reuses the `/contacts` Artists card components).

## Acceptance Criteria
- An artist-scoped member lists only their contacts and gets 404 on others.
- Producer contacts (`org_id IS NULL`) are never visible to members.
- Cross-org ids are rejected.

## Tests
Two-org and two-scope route tests; RLS replay entries; producer CRM e2e unchanged.

## Carried from LABEL-08
- An invitation limited to named artists stores them as `org_invitations.artist_ids` (roster CONTACT ids, 17 R3; the column keeps 136's name) and the API calls them `contact_ids`. Accepting sets `org_members.scope = 'artists'` but there is no `member_artist_scopes` yet, so the list is NOT copied onto the membership. When this task adds `member_artist_scopes`, (1) make `labelos_accept_invitation` (138) insert one row per `artist_ids` entry in the same transaction, (2) backfill members whose accepted invitation carries `artist_ids`, and (3) validate `contact_ids` on `POST /api/org/[orgId]/invitations` as contacts of THAT org (today they are only checked to be uuids). Until then `artistScopeAllows` is a no-op, so such a member sees the whole org.

## Carried from LABEL-09 (#59)
- The members page already shows a member's scope ("Selected artists"), and `PATCH /api/org/[orgId]/members` already accepts and audits `scope`. This task adds the roster picker and `member_artist_scopes`, then makes `artistScopeAllows` in `org-access.ts` read it. Combined with LABEL-08's carried note, that is everything artist scope needs.
- Org shells for label and artist orgs list only Members today (`navGroupsFor`). Add the Artists hub here, gated on its capability, once its page exists.

## Out of Scope
Org-scoping the producer's existing contacts (M7); direction (LABEL-26).

## Rollback
Drop the policy, table and column (nullable, no backfill).

---

# LABEL-11 — Songs on tracks: song stage, identifiers, master/demo links, recording-kind adapter

**Area:** Music model
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-10
**Status:** Done (2026-10-02) — [PR #66](https://github.com/philipmadupro-ship-it/uche-beatstore-g-a/pull/66)

## Objective
Use `main`'s song model (a `tracks` row with `type = 'song'`, plus `song_beats` and `track_links`) as the Label OS song (`17` R1).

## Current State
- **Songs** are tracks with `type = 'song'`, built on beats (`song_beats`, mig 132), with linked instrumental / loop / topline / version (`track_links`, mig 133).
- **Read model:** `mergeLinks` (`lib/tracks/links.ts`) is the single way links are read.
- **Missing:** there is no A&R stage, ISWC, or master/demo marker.

## Required Change
- **Migration:**
  - `tracks.song_stage` (CHECK = the `04` W3 stages, nullable; default `inbox` set by the app for org songs);
  - `tracks.iswc`;
  - widen the `track_links_relation_check` constraint to add `master` and `demo` (drop + re-add the constraint, idempotently).
- **Pure module `lib/labelos/recording-kind.ts`:**
  - `recordingKindOf(track, relationFromSong)` per the `17` R1 table, feeding `recordingClass` / `audioCapabilityFor` from `capabilities.ts`;
  - `songRecordings(song, mergeLinksResult)` returns the classified list.
- **Rule helper:** `ensureInboxProject(org, contact)` makes sure every org song belongs to ≥1 project (Q1 answered yes on 2026-10-02: one "Inbox" project per artist contact).
- **Links code:** `lib/tracks/links.ts` learns the two new relations: labels, `suggestRelation`, and `rankCandidates`.

## Starting Code Surfaces
`src/lib/tracks/links.ts`, `src/lib/tracks/song-beats.ts`, `src/lib/labelos/capabilities.ts`, `supabase/migrations/133_track_links.sql`.

## Data Changes
Two nullable columns on `tracks`; the CHECK constraint is widened. No new tables (**do not create `songs` / `song_recordings` / `project_songs`**).

## Security
Writing `song_stage` requires `catalog.write` in scope (enforced in LABEL-24's route). The adapter is pure.

## UX
None (the drawer's Linked panel shows the new relations by label only).

## Acceptance Criteria
- Every row of the `17` R1 mapping table is asserted.
- Old links still read correctly.
- The `links` tests from `main` stay green.

## Tests
`recording-kind.test.ts`; extend `links.test.ts`; a migration replay check that exactly one relation CHECK survives (the verify pattern from mig 133).

## Orchestrator note (2026-10-02)
`projects.org_id` arrives in LABEL-12, so `ensureInboxProject` cannot write an org project yet. Build its rule here as a pure, tested planner (which project an org song belongs in, and when an inbox project must be created). LABEL-12/14 wire the write. Widening `track_links_relation_check` touches a producer table: the producer's Linked panel must keep working exactly as before for the existing relations (the #44 links tests plus `npm run e2e:real-db` linked-material flows).

## Out of Scope
Stage transitions (LABEL-24); uploads (LABEL-14).

## Rollback
Restore the old relation CHECK (only if no `master` / `demo` rows exist); drop the nullable columns.

---

# LABEL-12 — Expand tracks / projects and #44 child tables with org access (additive read policies)

**Area:** Database
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-10, LABEL-04
**Status:** Done (2026-10-02) — PR #68. Migration 141, not applied. Adds RESTRICTIVE `org_member_guard` SELECT policies and a service-role-only write trigger on org rows (accepted by the orchestrator: they only tighten access).

## Objective
Let org songs, projects and their #44 material live in the existing tables without changing producer behaviour (`17` R11).

## Current State
- `tracks` and `projects` are `owner_only` (097/119).
- The #44 tables (`project_contacts`, `artist_portals`, `project_assets`, `song_beats`, `track_links`, `artist_messages`, `contact_track_states`, `project_comments`) are owner-only with same-owner triggers.

## Required Change
- **Migration (columns and indexes):**
  - `tracks.org_id`, `tracks.isrc`, `tracks.created_by`, `projects.org_id` (nullable FKs).
  - Indexes on `(org_id, created_at desc)`.
- **Migration (policies):**
  - An additive SELECT policy `org_member_read` on `tracks` and `projects`: `org_id IS NOT NULL AND (select has_org_cap(org_id,'catalog.read'))`.
  - Parent-based `org_member_read` SELECT policies on each #44 child table, using `EXISTS` on its parent row with the same predicate.
  - No write policies. Org writes go through the service role in `/api/org/*`.
- **Migration (trigger compatibility):** the #44 same-owner triggers must also accept same-**org** rows. Extend each trigger function with "or both rows have the same non-null `org_id`", without weakening the owner case.
- **Code:** producer routes and `scopedList` are unchanged.

## Starting Code Surfaces
`supabase/migrations/097_strict_owned_rows.sql`, `119_producer_only_catalogue_writes.sql`, `122`–`133`, `src/lib/security/rls-final-state.test.ts`.

## Data Changes
Nullable columns, additive policies, trigger functions extended. **No backfill.**

## Security
- R-04. The replay test asserts every `org_member_read` policy contains `org_id IS NOT NULL`, directly or through its parent.
- Trigger changes are tested for "different owner, no org → still refused".

## UX
None.

## Acceptance Criteria
- The producer library, store, artist workspace and portal behave identically (existing e2e and real-DB suites green).
- A member cannot read `org_id IS NULL` rows via PostgREST.

## Tests
Replay assertions; trigger tests on the local real-DB harness (`scripts/local-db/`); `npm run e2e:real-db` unchanged.

## Carried from LABEL-11 (#66)
- `tracks.isrc` belongs here (R1 puts it on the master track; 140 did not add it). Validators stay LABEL-16.
- `planInboxProject` (`lib/labelos/inbox-project.ts`) takes `inboxForContactId`, but nothing stores which project is an artist's inbox. Persist that marker here, either as a column on `projects` or as a `project_contacts` role value, and say which in the PR. LABEL-14 wires `ensureInboxProject`.

## Orchestrator note (2026-10-02): the read policy must not bypass scope or audio class
`org_member_read` on `tracks` as written above (`org_id IS NOT NULL AND has_org_cap(org_id,'catalog.read')`) would let any member with `catalog.read` read EVERY org track row directly through PostgREST. That includes rows of artists outside their scope, and working material (demos, toplines, loops) that D4 hides from marketing. The policy must therefore also respect:
- **artist scope:** `can_see_artist`, reached through the track's artist. Use the project → `project_contacts` path or whatever artist key this task adds, and state which.
- **working vs finished audio (D4, `audioCapabilityFor`):** gate on the matching capability (`audio.working` / `audio.finished`), or narrow the policy so that working material is not readable without `audio.working`.

If an exact SQL twin of `recordingKindOf` is too heavy for RLS, choose the narrower rule. Leave the finer split to the routes, and document it. Add two-scope and marketing-vs-A&R cases to `supabase/local/checks/141_*.sql`. A member must never be able to read through PostgREST what the `/api/org/*` routes would refuse them.

## Out of Scope
M7 backfill; org-scoping `contacts` (LABEL-10 did it).

## Rollback
Drop the policies, restore the trigger functions, drop the nullable columns.

---

# LABEL-13 — Per-object org audio route

**Area:** Storage security
**Priority:** P0
**Risk:** Critical
**Workstream:** L
**Dependencies:** LABEL-05, LABEL-11, LABEL-12
**Status:** Done (2026-10-02) — PR #69. It streams through `lib/audio/stream-source` with Range support and issues no presigned URL. It classifies from the raw inbound link rows, not `mergeLinks`, so the strictest reading wins. An unlinked loop or topline is now its own recording kind (working).

## Objective
Stream or presign a recording only if the caller may access that specific recording.

## Current State
`/api/audio` checks `requireProducer`, not the object (R-01). Portals stream through signed preview grants (`main`).

## Required Change
Add `GET /api/org/[orgId]/audio/[trackId]?variant=preview|full|wav|stem:<name>`:
1. Load the `tracks` row. It requires `org_id = orgId`.
2. Find its song context: either it is a song, or it is linked to one via `song_beats` / `track_links`, using `mergeLinks`. Find its project(s) and artist contact through `project_tracks` / `project_contacts`.
3. Required capability: `audioCapabilityFor(recordingKindOf(...))` (LABEL-11), plus scope via `requireObjectAccess`. External project members are allowed only for recordings in their project, per `externalCan`.
4. Stream with Range support (`lib/storage` helpers), or 302 to a presigned URL that expires in ≤5 minutes. Record `recording.downloaded` for external members (audit).

**`/api/audio` and the portal media routes are not changed** in this task.

## Starting Code Surfaces
`src/app/api/audio/route.ts` (reference), `src/lib/storage/upload.ts`, `src/lib/share-media-token.ts`, `src/lib/tracks/links.ts`.

## Data Changes
None.

## Security
Never accept a raw `src` / `r2://` from the client; only a track id. Marketing gets 403 on a topline or loop and 200 on a master (D4).

## UX
None.

## Acceptance Criteria
- Every combination of role × scope × recording kind × variant from `06` returns the right status.
- A producer-era track (`org_id IS NULL`) → 404.

## Tests
Route test matrix; Range header test.

## Carried from LABEL-11 (#66)
`recordingKindOf` returns `null` for unlinked loop / topline / instrumental / remix / song tracks (no R1 row). Null means no audio capability, so the route fails closed. Decide whether such org tracks need a kind (for example a standalone loop in an artist's inbox). If they do, extend the R1 mapping and its test.

## Carried from LABEL-12 (#68)
- **The route applies D4 itself.** `requireObjectAccess({ table: 'tracks' })` checks scope and capability, not the audio class. Use `audioCapabilityFor(recordingKindOf(...))` per the task. The DB row rule (`orgTrackReadClass` / `orgRowAudioAllows` in `lib/labelos/org-read.ts`, SQL `can_read_org_track`) is deliberately narrower. It may hide a row the route would stream, but the route must never stream a recording to someone who lacks the audio capability for its kind.
- **Scope goes through the project path:** the track's projects of its OWN org, then the project's `inbox_for_contact_id` or `project_contacts`, then `can_see_artist` (TS: `scopeAllowsAnyContact`; SQL: `can_see_org_track`). A track in no project is whole-org only.
- Load the track with the service role, filtered by `org_id = orgId`. A member's PostgREST read is now guarded, so do not rely on it to find a row the route then refuses; answer 404 either way.

## Out of Scope
Hardening `/api/audio` for multiple producers.

## Rollback
Revert.

---

# LABEL-14 — Org upload wrapper + private previews

**Area:** Upload pipeline
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-11, LABEL-12, LABEL-13 (D8 decided: private until released)
**Status:** Done (2026-10-02) — PR #70. Migration 142, not applied. It adds the `project_tracks` same-owner/same-org trigger and the ownerless-org-row constraints.

**Orchestrator decision (2026-10-02, on #70): org rows carry no `user_id`.** This is the same rule 139 set for org contacts (`contacts_org_or_owner`). The uploader is recorded in `created_by`, and org writes set `user_id` NULL.
- **Why:** every producer route filters on `user_id`, so NULL makes an org row unreachable to all of them, including hand-written queries (search, analytics, store-editor beats, bulk routes, `/api/audio`). That beats an `org_id IS NULL` pass over each query.
- **Enforced by 142:**
  - `projects_org_or_owner ((org_id IS NULL) = (user_id IS NOT NULL))`;
  - `tracks_org_or_owner (org_id IS NULL OR user_id IS NULL)` (legacy NULL-owner producer tracks stay legal);
  - `track_links.user_id` is nullable, and its trigger's org path requires NULL.
- **Defence in depth:** `requireRowOwnership` and `scopedList` exclude org rows.
- **Applied migrations:** 049 / 050 / 053's orphan backfills skip org rows on replay. The edit is file-only and a no-op on production (same pattern as 111 in LABEL-10).

## Objective
Upload audio into an org as a song, or as material linked to a song, with previews that are not publicly addressable.

## Current State
`/api/upload/*` is producer-only and writes public previews (`099_track_preview_assets.sql`). Songs and links are created through `main`'s track, beats and links routes.

## Required Change
- **Routes:** add `/api/org/[orgId]/upload/{init,part,complete,abort}`. Each checks `catalog.write` in scope, then calls the same `lib/storage` / `lib/upload` functions.
- **`complete`:**
  - sets `tracks.org_id`, `created_by`, and `user_id` (= the uploader);
  - creates either a song track (`type = 'song'`, `song_stage = 'inbox'`, placed in the artist's inbox project via `ensureInboxProject`), or a track linked to an existing song with a relation (`demo` / `master` / `instrumental` / `loop` / `topline` / `version`), through `links-store.ts`.
- **Private previews:** previews for org tracks go to the private bucket under `orgs/<org_id>/previews/`. Peaks are private too, served via the LABEL-13 route or an HMAC grant.
- **Processing job:** `lib/upload/processing.ts` branches on `org_id` for the destination bucket only.

## Starting Code Surfaces
`src/app/api/upload/*`, `src/lib/upload/processing.ts`, `src/lib/storage/*`, `src/lib/tracks/links-store.ts`.

## Data Changes
None (columns from LABEL-11/12).

## Security
R-05: an org preview key must never land in the public bucket (tested). Producer uploads are unchanged.

## UX
The uploads tray works unchanged. In org context it offers "new song / add to song as…" (W3).

## Acceptance Criteria
- An org upload creates a song in the inbox project, or a linked track.
- The preview object is in the private bucket.
- Producer uploads behave exactly as before.

## Tests
Route tests with mocked storage; processing-branch unit test; e2e: upload 3 files → 3 songs in the artist's inbox project.

## Carried from LABEL-12 (#68)
- **Put linked material in the song's project.** A master, demo or other linked track is in a scoped member's scope only through a project of the song's org that it sits in, so `complete` must add it to the song's project(s) (`project_tracks`). Otherwise a scoped A&R member sees the song but not its master.
- Writing `user_id` = the uploader on org rows is safe now: the 141 guards stop that user_id granting a read, and the trigger blocks PostgREST writes. All org writes must go through the service role; an `authenticated` client write raises `insufficient_privilege`.
- **`project_tracks` has no same-owner / same-org trigger** (pre-existing). The 141 scope path ignores mismatched rows, but this task writes the first org `project_tracks` rows: add the trigger as migration **142** (same shape as 141's section 4: owner case, or every parent in one non-null org), with a local check and a rollback.
- **Name PostgREST embeds explicitly.** `projects.inbox_for_contact_id → contacts` is a direct FK now, so a bare `projects?select=contacts(…)` resolves through it. Use `contacts!project_contacts(…)` or the FK name.
- `scopedOrgQuery` still returns nothing for projects / tracks to an artists-scoped member (fail-closed). If this task adds a list read, narrow it by the project path; do not widen the helper to the whole org.

## Carried from LABEL-13 (#69)
- **Previews (D8).** `GET /api/org/[orgId]/audio/[trackId]?variant=preview` streams whatever `preview_url` holds. Once this task writes org previews to the private bucket (`orgs/<org_id>/previews/`), that route serves them unchanged, through `stream-source`'s bucket allowlist. Check that the allowlist accepts the new prefix, and add a route test that an org preview never resolves to the public bucket.
- **Play through the LABEL-13 route.** Any org player or tray link plays `/api/org/[orgId]/audio/[trackId]`, never `/api/audio?src=`.
- **Classification follows links.** An upload added "as" a relation (`demo`, `master`, …) gets its D4 class from that link, so write the link in the same request that creates the track. A track with no link and no song type is unplayable to everyone in the org (null kind fails closed), except beats, loops and toplines.

## Out of Scope
Non-audio files (LABEL-15).

## Rollback
Revert the wrapper. Org rows remain and are harmless.

---

# LABEL-15 — Org assets on `project_assets` (sensitivity, kinds, org access)

**Area:** Storage
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-10, LABEL-11
**Status:** Done (2026-10-03) — PR #71. Migration 143 is not applied. Org files are ownerless `project_assets` rows with a `sensitivity` of normal or restricted. Contracts and split sheets are always restricted and never appear in a portal. `track_stem_files` gets the guard and the trigger.

**Orchestrator decisions on #71 (accepted as implemented):**
- **Who can see what.** Visual kinds (artwork, lyrics, photo, video) need only `catalog.read`. Legal kinds (contract, split sheet) also need `contracts.read`. Everything else counts as working material and also needs `audio.working`.
- **Who can write.** A member writes only what they can open. Restricted files additionally need `contracts.read` plus `catalog.write` or `rights.write`.
- **Audit.** A restricted download is audited (`file.restricted_downloaded`) before any byte is sent, and the download fails closed if the audit write fails.

## Objective
Artwork, photos, video, documents and contracts as org assets, by extending `main`'s `project_assets` (`17` R2). **No new `files` table.**

## Current State
`project_assets` (mig 127) already provides:
- the private bucket;
- an extension allowlist;
- presign + register;
- `kind ∈ reference, artwork, lyrics, document, audio, other`;
- producer-owned rows.

## Required Change
- **Migration:**
  - `project_assets.org_id` (via its project; it may be set by trigger from the project);
  - `sensitivity` (`normal` | `restricted`, default `normal`);
  - widen the `kind` CHECK with `photo`, `video`, `contract`, `split_sheet`, `session`, extending the allowlist accordingly. `.html` / `.svg` stay refused.
- **Routes:** `/api/org/[orgId]/projects/[id]/assets` wraps `lib/projects/assets.ts` + `lib/storage/project-assets.ts` with the org capability checks. `restricted` assets require `contracts.read`, and each download is logged as an audit event.

## Starting Code Surfaces
`src/lib/projects/assets.ts`, `src/lib/storage/project-assets.ts`, `supabase/migrations/127_project_assets.sql`.

## Data Changes
Columns and widened CHECKs on an existing table.

## Security
`projectAssetKeyOf` registration rules unchanged. Org keys are prefixed `orgs/<org_id>/`.

## UX
The project Files section is reused in org context.

## Acceptance Criteria
- A restricted download without the capability → 403.
- The audit event is written.
- Producer project files are unchanged (`artist-workspace-phase2` e2e green).

## Tests
Route tests; existing assets tests stay green.

## Carried from LABEL-13 (#69)
- `track_stem_files` (mig 080) and older `track_versions` snapshots are not addressable through the org audio route, and `track_stem_files` has no `org_member_guard` in 141. Before any org surface lists stem files or versions, add the guard and the service-only write trigger to `track_stem_files` (same shape as 141 §3b/§3c, next free migration), and extend the audio route's variants if needed.

## Carried from LABEL-14 (#70)
- **Ownerless org rows.** An org `project_assets` row has `user_id` NULL, and the uploader goes in a created_by-style column. In this task's migration (143):
  - make `project_assets.user_id` nullable;
  - add a CHECK or trigger so that an org asset has no `user_id` and a producer asset must have one (the asset's project decides);
  - have the 127 same-owner trigger's org path require NULL.
- Files go to the private bucket under `orgs/<org>/assets/…`, following `lib/storage/org-media.ts` / `org-upload.ts`. Never the public fallback.
- `upload_processing_jobs.user_id` is still the uploader for org uploads. Nothing producer-facing lists jobs, so leave it.

## Out of Scope
Thumbnails / image processing.

## Rollback
Restore the CHECKs (only if no new kinds are used); drop the columns.

---

# LABEL-16 — Releases, release items, identifier validators

**Area:** Release model
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-11, LABEL-15
**Status:** Done (2026-10-03) — PR #72. Migration 144, not applied: org-only `releases` and `release_items` tables, a `project_contacts.user_id` that can be NULL, and "on a release" makes a mix finished in SQL and in both TS twins.

**Orchestrator decisions on #72 (accepted as implemented):**
- A cancelled release does not count as "on a release".
- A `version` chosen as an item's master stays working material. Link a released alternate mix as `master` instead. Widening this is a D4 product call.
- Artwork must be a file of the release's own project.
- `releases.contact_id` is NOT NULL, and deleting that contact returns 409.
- The tracklist is editable only while the release is a draft. A delivered or imported release cannot be deleted; cancel it instead.
- Deleting a release keeps its project.
- Items expose ids only.

## Objective
The release entity and its tracklist, built on song tracks (`17` R1/R2).

## Current State
None. `projects.price_usd` is a store bundle, not a release.

## Required Change
- **Migration:**
  - `releases`, with `project_id NOT NULL` (created with the release if not given), `artwork_asset_id` → `project_assets`, `contact_id` (the artist), and the `05` release fields.
  - `release_items(release_id, position, song_track_id, master_track_id, version_title, explicit)`.
  - A trigger enforcing two rules:
    - the song is `type = 'song'`;
    - the master is the song itself, or linked to it as `master`, `instrumental` or `version`.
- **Pure module:** `src/lib/labelos/identifiers.ts` (ISRC / UPC / ISWC / IPI format + normalisation).
- **Routes:** release CRUD; items reorder (contiguous positions).

## Starting Code Surfaces
`src/lib/labelos/`, `src/lib/tracks/links.ts`.

## Data Changes
Two tables.

## Security
`release.write`.

## UX
None (LABEL-17 / 33).

## Acceptance Criteria
- Invalid identifiers → 400 with the field named.
- Positions stay contiguous after delete.

## Tests
`identifiers.test.ts`; route tests.

## Carried from LABEL-13 (#69)
- **"On a release" makes a mix finished** (06 §2.3). Until this task, `audioCapabilityFor('mix', { currentMixOfSelectedSong })` treats only `song_stage = 'selected'` as finished. When release items exist, extend that flag (in `lib/labelos/org-audio.ts#recordingContexts`) and the SQL twin `labelos_track_is_finished` (141) together, and add both to their tests. The two must not drift.

## Carried from LABEL-14 / LABEL-15 (#70, #71)
- **Ownership.** `releases` and `release_items` are new Label OS tables. They are org-only: `org_id NOT NULL` and no `user_id`. Add them to `labelOsTables()` in `rls-final-state.test.ts`. Writes go through the service role only, using the `labelos_org_rows_service_only` shape.
- **Artwork.** `artwork_asset_id` must point at an org `project_assets` row of the release's own org with a visual kind (artwork or photo). Enforce this with a trigger.
- **Read rule.** The read policy follows `catalog.read` plus project scope (`can_see_org_project`), the same as 141/143.
- Migration number: **144**.

## Out of Scope
Gates (LABEL-32); export (LABEL-34).

## Rollback
Drop the tables.

---

# LABEL-17 — Org artist workspace (reusing #44 components) + song detail

**Area:** Frontend
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-14, LABEL-15, LABEL-16
**Status:** Done (2026-10-04) — PR #74. Migration 145, not applied: org rows on the #44 workspace tables have no owner.

**Built (for the orchestrator's merge gate):**
- **Pages.** `/o/<slug>/artists/<id>`, `/songs/<id>` and `/projects/<id>` are server pages. Anything out of scope or missing is a real 404, the same answer as the API (`/api/org/[orgId]/artists/[contactId]/workspace`, `/songs/[trackId]`, `/projects/[id]`). The roster cards link to the workspace.
- **Tabs.** Overview · Projects · Songs · Releases · Files. The tab strip is the producer workspace's own (`WorkspaceTabBar` / `useUrlTab`, extracted with the same DOM), so `/contacts/[id]` is unchanged. Beats, Activity, Notes and Messages are not here: they belong to later tasks (22–28).
- **Song view.** Recordings come from `songRecordings`, play through `usePlayer` from the LABEL-13 org audio route, and A/B switches at the same moment (`abSeekFraction`).
- **Restricted, not empty.** What a role may not hear (D4) is absent from the payload; the page says how many are restricted (07 §3.4). Marketing gets no demos, loops, toplines or songs still in development.
- **Org project page** mounts `ProjectFilesSection` in its `org` mode (the LABEL-15 carry).
- **Migration 145.** `user_id` is nullable on `contact_track_states`, `artist_portals`, `artist_messages` and `song_beats` (`project_contacts` since 144). The rule is in each same-owner trigger's org path (an org row has no owner), because a CHECK cannot see the parent. The producer path is unchanged. The 141 / 143 / 144 local checks now write org links ownerless.
- **Scope walk.** `artistProjects` is now the one "this artist's projects" read (workspace and upload targets). `org-access-scope-parity.test.ts` holds it, `orgProjectIdsInScope` and the single-object walk equal to each other and to the written rule of `can_see_org_project`; the SQL side is in the 145 local check.

**Verification:** `tsc`, `vitest` (385 files), `npm run db:local:check` (145 and its rollback), `e2e/label-org-workspace.spec.ts` against the real-database stack (6 tests: tabs at 1440 and 390, A/B at both, scoped member 404s, marketing restricted), and the existing `e2e:real-db` flows, including the artist-workspace ones.

**Not done / carried:**
- A/B keeping the moment is proven by the unit tests (`abSeekFraction`, `OrgSongView.test.tsx`), not in the browser: the local stack has no audio files, so the e2e asserts the UI state and the URL.
- `requireObjectAccess` / `orgAssetRow` still read the asset row twice (optional fold from LABEL-15). Not touched.
- No DB guard for "exactly one roster artist" in an artist org (optional from LABEL-10). Not added.
- Two e2e flows (`artist-workspace-phase2` 1, `label-org-members` 3) failed once in a full 58-test run and passed when run alone. Timing under load, not this change.

**Found, not fixed (from the `/code-review` of the whole Label OS branch against `main`; none is in this task's diff, all need a decision before the final merge):**
- **Producer routes still treat `user_id IS NULL` as the producer's own**, while org tracks and projects have been ownerless since 142. Three routes can therefore reach org rows with the service role:
  - `src/app/api/activity/route.ts` — `ownerFilter` and the track / project helpers: org activity can appear in the producer's feed (only the contacts helper was made strict, in #65);
  - `src/app/api/tracks/[id]/similar/route.ts` — the candidate pool is `select('*')` with `user_id.is.null` and no `org_id` filter, so org tracks (with their `r2://` references) can come back;
  - `src/app/api/tracks/tags/bulk/route.ts` and `src/app/api/tracks/tags/route.ts` — the "owned tracks" check includes `user_id IS NULL`, so the producer can tag, and list tags of, org tracks.
  The fix is to add `org_id IS NULL` (or drop the null-owner allowance, as mig 097 intended) to each; one small task, ahead of the final merge.
- **Producer reads now select `org_id`** (`src/lib/auth/ownership.ts#requireRowOwnership`, `src/lib/db.ts#scopedList`). On a database where 141 is not applied they return 500. The runbook order (apply Label OS migrations, then merge) covers it; if the code is ever deployed first, the library and projects pages fail.

## Objective
The org artist workspace and song view, built from `main`'s workspace components (`17` R12), plus the Releases tab.

## Current State
`components/artists/ArtistWorkspaceTabs` (overview, projects, beats, songs, files, activity, notes) runs on `/contacts/[id]` for the producer.

## Required Change
- Render `ArtistWorkspaceTabs` under `(label)/o/[orgSlug]/artists/[contactId]`, fed by org-scoped APIs (an org data source, not producer routes).
- Add a **Releases** tab.
- Song view: song track, its classified recordings (`songRecordings`), stage, and A/B between recordings through `usePlayer`, playing via the LABEL-13 route.
- Hide what the viewer's capabilities exclude. For example, marketing does not see loops / toplines.

## Starting Code Surfaces
`src/components/artists/*`, `src/components/ui/*`, `src/hooks/usePlayer.ts`.

## Data Changes
None.

## Security
Restricted sections render "restricted", not empty (`07` §3.4).

## UX
Same components and design as the producer workspace. No new pattern.

## Acceptance Criteria
- At 1440 and 390 px, the tabs work and A/B switches without a restart.
- An artist-scoped member cannot open another artist (404).
- The producer's own workspace is unchanged.

## Tests
jsdom tests for the capability-filtered tabs; Playwright spec; existing artist-workspace e2e green.

## Carried from LABEL-10 (#65)
- The org roster page (`/o/[orgSlug]/artists`) renders `ArtistsCardView` with `linkFor` returning null, because there is no org artist workspace yet. When this task builds it, point `linkFor` at it.
- Org contacts deliberately take no `notes` / `crm_status`: those are the CRM's private fields, and a roster artist reads their own contact (D5). If the workspace needs internal notes about an artist, store them separately with visibility (business-internal vs artist-visible). Never put them on the contact row.
- An artist org's "exactly one roster artist" rule is checked only in the route. A DB guard is optional.

## Carried from LABEL-14 (#70)
- **Ownerless org rows.** The first org writes to `project_contacts`, `artist_portals`, `song_beats`, `artist_messages`, `contact_track_states` and `project_comments` follow the rule set on #70:
  - nullable `user_id`, NULL on org rows;
  - the same-owner trigger's org path requires NULL;
  - a CHECK or trigger keeps producer rows owned.
  This needs one migration (next free number).
- **No org UI lists songs yet.** The upload panel's "Add to song as…" uses `/api/org/[orgId]/upload/targets`, which is narrowed by the project path. The song list and song detail built here should reuse that scope rule.
- The `complete` rollback leaves a newly created Inbox project in place. That is deliberate: the next upload reuses it.

## Carried from LABEL-15 (#71)
- **Files section.** `ProjectFilesSection` already has an `org` mode (org routes, org kinds, a Restricted marker, capability-aware controls), but nothing mounts it yet. The org project page built here mounts it.
- **Duplicate read.** Item routes read the asset row twice: once in `requireObjectAccess`, once in `orgAssetRow`. Fold these together if this task touches `requireObjectAccess`.

## Carried from LABEL-16 (#72)
- **`project_contacts`.** Migration 144 made `project_contacts.user_id` nullable, and release-created links are ownerless. Add the CHECK in this task's migration (**145**): an org project's link has no `user_id`, and a producer link must have one. Do this through the same-owner trigger's org path, because the CHECK cannot see the project. Then amend the 141–143 local checks, which still write org links with the acting member. The "ownerless" carry from LABEL-14 above covers the other #44 tables.
- **Song titles.** Release items expose track ids only. The Releases tab joins titles through the track routes, so the scope rules and D4 still apply.
- **Scope walk.** There are two TS copies of the project-scope walk: `orgProjectIdsInScope` (list) and `artistsThroughProjects` (single object). Add a test holding them equal to each other and to SQL `can_see_org_project`, or merge them, while this task touches org-access.

## Out of Scope
Reviews, credits, direction tabs (later tasks).

## Rollback
Flag off.

---

# LABEL-18 — Org Overview v1

**Area:** Frontend
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-17
**Status:** Done (2026-10-05) — PR #76. No migration. `GET /api/org/[orgId]/overview` and the Overview page at `/o/<slug>` (one row per roster artist: songs by stage, next release, a restricted count that never carries a title). Reuses the LABEL-17 reads, so the scope-parity test needed no new walk.

**Orchestrator decisions on #76 (accepted as implemented):**
- Overview columns: Demos = inbox + in review + shortlisted; Dev = in development; Selected = selected. On hold / passed / archived count only in the totals (07 §2.1 names three columns but not the mapping).
- Next release = the earliest dated draft (undated after dated, then oldest). Delivered and cancelled are never "next".
- A song in a project shared by two artists counts on both rows; `totals.songs` counts it once.
- The roster excludes workspace-mode contacts with no artist role, as `/artists` does, so the two agree.
- Reads are chunked (200 ids) and paged with `range`, because PostgREST caps a response silently at `max-rows`.

**Open before the final merge (found, not fixed — decide when the Label OS branch is readied for `main`):**
- **R-08 guard cost.** An `authenticated` PostgREST read of all 10k org `tracks` rows takes 7.8 s (the member read policy runs a SECURITY DEFINER lookup per row, about 0.8 ms each). Nothing in the app issues that read today, since org routes use the service role. The fix is a migration (wrap the helper as `(SELECT fn(col))` or index the lookup); never drop the guard.
- **Producer routes that treat `user_id IS NULL` as the producer's own** (see LABEL-17's "Found, not fixed"): `api/activity`, `api/tracks/[id]/similar`, `api/tracks/tags/bulk`, `api/tracks/tags`.

## Objective
The owner's roster-level view: artists × songs by stage, next release.

## Current State
None.

## Required Change
- `GET /api/org/[orgId]/overview` (aggregates in one scoped query set).
- A pure `summarizeRoster()` in `lib/labelos/overview.ts`.
- The page at `/o/[orgSlug]`.

## Starting Code Surfaces
`src/lib/dashboard/action-digest.ts` (pattern).

## Data Changes
None.

## Security
Counts respect scope; no leak of out-of-scope artist counts.

## UX
`07` §2.1 without "Needs attention" (LABEL-35) and without the digest (LABEL-20).

## Acceptance Criteria
- Counts match fixtures.
- A scoped member sees only their artists.

## Tests
`overview.test.ts`; route test.

## Carried from LABEL-12 (#68)
- **R-08 explain-plan pass.** 141 adds a SECURITY DEFINER lookup per row on producer PostgREST reads of the guarded tables (`project_tracks`, `play_head_pings`, `track_licenses`, …) and on member reads of org rows. Most producer routes use the service role and skip RLS. Before Phase 2 closes, run `EXPLAIN ANALYZE` at catalogue scale (10k tracks, the `test:scale` fixtures) for the Overview's queries and for one producer PostgREST read of a guarded table. Record the numbers in the PR. If a guard dominates, wrap the helper as `(SELECT fn(col))` or index the lookup; never drop the guard.
- Overview lists for an artists-scoped member must narrow by the project path (see LABEL-14's note on `scopedOrgQuery`).

**Built (for the orchestrator's merge gate):**
- **`GET /api/org/[orgId]/overview`** (`catalog.read`): one scoped query set, `loadOrgOverview` (`lib/labelos/overview-store.ts`), then the pure `summarizeRoster` (`lib/labelos/overview.ts`, tests written first). Roster from `scopedOrgQuery`, projects from `orgProjectIdsInScope`, songs through `orgTrackFacts` + `partitionSongs`, stage counts through `stageCounts`: no scope walk of its own, so `org-access-scope-parity.test.ts` needed no new walk. The route test also holds every row equal to that artist's workspace payload for owner, marketing and a scoped member.
- **Page `/o/<slug>`** (server, `catalog.read`; without it the old redirect to Members stays). Rows are `ListRow`s opening the artist's workspace; columns Demos (inbox + in review + shortlisted) · Dev (in development) · Selected; on hold / passed / archived are in the totals only. Next release = the earliest dated draft (undated after, then oldest); delivered and cancelled are not "next". A restricted count is a number on the row, never a title.
- **Not in it:** Needs attention (LABEL-35) and the digest (LABEL-20), as scoped.

**Verification:** `tsc`, `vitest`, `next build`, `e2e/label-org-overview.spec.ts` (owner at 1440 and 390, scoped member sees no Kilo in page or API, marketing sees "1 song restricted" and no title) and the full `e2e:real-db` run against the real-database stack. `label-org-members` 3 asserted the old redirect to Members and now asserts the Overview first.

**R-08 explain pass (carried from LABEL-12), 10k org songs, 40 artists, 200 projects, local Postgres 16:** the Overview's reads are service-role and cheap (projects 0.1 ms; `project_tracks` for 200 projects 1.7 ms; one 200-id `tracks` chunk 2.4 ms, 50 chunks for 10k songs; link lookups index-backed). Not cheap: a PostgREST read as `authenticated` of ALL 10k org `tracks` rows takes **7.8 s** (member read policy, a SECURITY DEFINER lookup per row, ~0.8 ms each); 200 ids take 126 ms and one project's `project_tracks` 4.5 ms. Nothing in the app issues the 10k-row member read today (org routes use the service role), so no migration here ("Data Changes: None"). Before Phase 2 closes, wrap the helper as `(SELECT fn(col))` or index the lookup in a migration; never drop the guard.

## Carried from LABEL-17
- **Reuse the reads.** `lib/labelos/org-workspace.ts` has `stageCounts` and `partitionSongs`; `org-workspace-store.ts` has `artistProjects`, and `orgProjectIdsInScope` (`lib/auth/org-access.ts`) narrows lists for a scoped member. `summarizeRoster()` should call these, not re-derive the scope walk (the parity test in `org-access-scope-parity.test.ts` holds the three equal).
- **Restricted counts.** A member's songs are filtered by D4 (finished music only for marketing). The overview must count only songs the member may see, and may show the restricted count the way the workspace does, but never a title.
- **Releases.** `OrgArtistWorkspace.releases` already lists an artist's releases with state and target date; "next release" is the first draft.

## Out of Scope
Needs attention; digest.

## Rollback
Flag off.

---
# LABEL-19 — Activity event coverage + audit RPC

**Area:** Activity
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-18
**Status:** Done (2026-10-06) — PR #78. Migration 146, not applied: audit-class mutations (member update/remove, artist scope, invitation create/revoke) are functions that write the change and its `activity_events` row in one transaction (`SECURITY DEFINER`, `service_role` only); every mutating `/api/org/**` handler records an event, held by a source coverage test; `org.created` is backfilled.

**Orchestrator decisions on #78 (accepted as implemented):**
- Default visibility per verb: creative record (songs, recordings, projects, credits, releases) = `artist`; business side (members, invitations, contacts, sharing, access, split sheets, approvals, settings) = `internal`; files default `internal` and are `artist` only for a file that never was restricted.
- `org.created` backfill is in 146, idempotent, one event per org lacking one (`source: 'backfill'`).
- Six reasoned coverage exemptions (presign, upload init/part/abort — storage plumbing). A stale exemption fails the test.
- The members routes read, plan, then call the function; two admins at once can record a stale `from` value (the DB still keeps one owner). Accepted for now.

**Found, not fixed — carried to LABEL-20 as a requirement:** `activity_events` RLS (136's policy) has no artist-scope predicate, so a scoped member or roster artist reading the table with their own JWT can see `artist` events of artists outside their scope (`song.created` carries the title). The app never exposes that read, but LABEL-20 must close it before any feed ships (see "Carried from LABEL-19" under LABEL-20).

## Objective
Every Label OS mutation records an event, and audit-class mutations are atomic with their event.

## Current State
The `activity_events` table exists (LABEL-03) and `recordEvent` exists (LABEL-05). Coverage is partial.

## Required Change
- Add Postgres functions (RPC) for audit-class verbs (membership, scope, split transitions, approvals, delivered), performing mutation + insert in one transaction.
- Add `recordEvent` calls to all Phase 1–2 routes.
- Add a coverage test: every `POST|PATCH|DELETE` handler under `src/app/api/org/**` references `recordEvent` or an audit RPC.

## Starting Code Surfaces
`src/lib/labelos/activity.ts`, `src/app/api/org/**`.

## Data Changes
SQL functions only.

## Security
The RPC is `SECURITY DEFINER`, granted to `service_role` only. `authenticated` has no execute grant.

## UX
None.

## Acceptance Criteria
- If the audit insert fails, the mutation is rolled back.
- The coverage test fails on a fixture handler without an event.

## Tests
- A local DB test for the RPC.
- The source coverage test.

## Carried from LABEL-05 (#55)
`recordEvent` defaults `visibility` to `internal`, and 136's RLS shows those rows only to holders of `business.read.internal`. So A&R, producers and engineers cannot see everyday events like `song.created` unless the route passes `visibility: 'artist'`. Decide a default per verb here, in `src/lib/labelos/activity.ts`, consistent with D4 and D5. Audit events are not yet atomic with their mutation; the RPC in this task fixes that.

Also from LABEL-07 (#57): orgs created by migration 137's backfill have no `org.created` event (only orgs created through `POST /api/profile` record one). Backfill them here if the feed needs a complete history.

**Built (for the orchestrator's merge gate):**
- **Migration 146 (not applied; SQL functions only).** `labelos_audit_member_update`, `_member_remove`, `_member_artists_set`, `_invitation_create`, `_invitation_revoke`, each doing the mutation and the `activity_events` insert in one transaction; a private `labelos_audit_insert` helper. SECURITY DEFINER, owner postgres, `EXECUTE` for `service_role` only. `/api/org/[orgId]/members` (PATCH, DELETE), `…/members/artists` (PUT) and `…/invitations` (POST, DELETE) call them through `auditRpc` (`lib/labelos/audit-rpc.ts`) and lost their compensating writes (undo-the-update, restore-the-member, delete-the-invitation). `invitation_create` also decides "one pending invitation per address" under an advisory lock, replacing the insert / re-check / delete dance. A missing function answers 503 naming 146, like the other routes before their migration. `member.joined` was already atomic in 138.
- **Events on the routes that had none:** `PATCH|DELETE …/assets/[assetId]` (`file.updated`, `file.deleted`), `PATCH|DELETE …/releases/[id]` and the tracklist routes (`release.updated`, `release.deleted`; one verb for item add / reorder / edit / remove, the payload says which), `POST …/upload/complete` (`song.created` for a new song, `recording.uploaded` for linked material). New verbs: `file.updated`, `file.deleted`, `release.updated`, `release.deleted`.
- **Coverage test.** `lib/labelos/event-coverage.ts` (pure; fixtures prove it fails a handler with no event, ignores comments and sibling handlers, flags a stale exemption) + `src/app/api/org/coverage.test.ts` over the real routes. `NO_EVENT_HANDLERS` has six entries, each with its reason: presign, and upload `init` / `part` (POST, PATCH, PUT) / `abort`, which are storage plumbing — the event is `…/upload/complete`'s.
- **Carried decision (a): default visibility per verb** (`DEFAULT_VISIBILITY`, `lib/labelos/activity.ts`, total over `Verb`, tested). `artist` = what was made, moved on or credited (songs, recordings, projects, credits, releases): A&R / producers / engineers (catalog.read, no business.read.internal) and the song's artist read it (D5). `internal` = members, invitations, contacts, sharing, who downloaded what, split sheets, approvals, org settings, connections (D4). Files default `internal`; the file routes pass `artist` only for a file that is not, and was not, restricted. A route still may pass `visibility` for one event.
- **Carried decision (b): `org.created` backfill — done**, in 146: one event per org without one (`source: 'backfill'`, dated to the org's own `created_at`, actor `created_by`), so LABEL-20's feed has a complete history. Idempotent; the rollback removes exactly those rows.

**Verification:** `tsc`, `vitest` (5,300 tests), `next build`, `npm run db:local:check` (146's check: grants asserted for service_role / authenticated / anon through `has_function_privilege` and by calling as each role; for every function a trigger that makes the `activity_events` insert fail proves the mutation is NOT there afterwards, including the cleared artist list and the removed member; the backfill; the rollback). `e2e/label-org-audit.spec.ts` (registered in `e2e:real-db`) drives the real routes and PostgREST: audit events written with the change, the last owner refused with nothing recorded (also through the function, via 136's deferred trigger), `authenticated` refused on the RPC, an A&R member reading the creative events and none of the business ones under the real RLS policy.

**Not done:**
- **Split transitions, approvals, delivery.** No mutating route exists for them yet (credits LABEL-30, approvals LABEL-32, delivery LABEL-33), so there is nothing to make atomic. Each adds its function (same `labelos_audit_insert` helper, same grants) with its route; the `Verb` list and `AUDIT_VERBS` already hold them. `recording.downloaded` / `file.restricted_downloaded` are audit verbs written by `recordEvent` before the bytes stream; they read, so there is no mutation to bundle.
- Events carry `artist_id` only where the route knows it cheaply (release events, upload of a new song). Project-file events and `recording.uploaded` for linked material carry the project / song, not the artist; LABEL-20 can join through them.
- **`activity_events` RLS has no artist-scope predicate** (136's policy: `catalog.read` + `visibility = 'artist'` or `business.read.internal`; its comment defers scope to "once LABEL-10 exists", and 139–146 never added it). Now that creative verbs default to `artist`, an artists-scoped member or a roster artist who queries the table directly with their own JWT can read `artist` events of artists outside their scope (`song.created` carries the title). The app never exposes that read (feeds are service-role routes), so it belongs to LABEL-20 ("events filtered by current scope"): add a scope predicate to the policy there, before any feed ships, failing closed for scoped members on events with no `artist_id`.
- The member routes read the member, plan the change and then call the function; two admins acting at once can record a `from` value the other change already moved (the database still keeps one owner). Unchanged from before 146; an expected-old-values compare inside the functions would close it.
- The producer routes `api/activity`, `api/tracks/[id]/similar`, `api/tracks/tags/bulk`, `api/tracks/tags` still treat `user_id IS NULL` as the producer's own, and the R-08 guard cost on member reads stands (PR #76); neither is touched here.

## Out of Scope
Feeds (LABEL-20).

## Rollback
Revert the functions; routes fall back to `recordEvent`.

---

# LABEL-20 — Digest module + activity feeds

**Area:** Activity / Frontend
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-19
**Status:** Done (2026-10-06) — PR #80. Migration 147, not applied: `activity_events` read policy gains the artist-scope predicate. `GET /api/org/[orgId]/activity` (artist / project / song feeds), `POST /api/org/[orgId]/overview/seen`, the pure `lib/labelos/digest.ts`, "Since your last visit" on the Overview and an Activity tab on the artist workspace.

**Orchestrator decisions on #80 (accepted as implemented):**
- Scope rule (`eventVisibleTo`, the SQL policy and the route agree): `catalog.read`; `internal` rows need `business.read.internal`; whole-org members read everything; an event naming an artist is judged by that artist alone, one naming only a project by the project's scope; an event naming neither (members, invitations, settings) is whole-org only.
- D4 on top, in the route: events about a song the member may not read are counted as "restricted", never listed (the song feed answers 404).
- The policy uses three hashed uncorrelated subplans, with no per-row SECURITY DEFINER call (100k events: whole-org read unchanged at about 7 ms, scoped read 29 ms and now correct).
- One assertion in 136's local check changed on purpose: a roster artist no longer reads an org-level event.

**Open before the final merge (owner decisions, not blocking):**
- `last_seen_overview_at` is one value per user, not per org (opening org A's Overview marks org B's digest seen). The fix is a schema change (the column on `org_members`, or a jsonb map).
- The `activity_events` policy has no D4 song-row predicate (the route has it). A member reading the table with their own JWT could read a working song's `song.created` title. No app route issues that read.


## Objective
Grouped, scope-safe feeds for the org overview, artist, project and song.

## Current State
`/api/activity` derives a producer feed from five tables.

## Required Change
- `lib/labelos/digest.ts` (pure): group by artist → day → actor → verb, with collapse rules.
- `GET /api/org/[orgId]/activity?artist|project|song&since`, applying `08` §B4 visibility.
- `user_profiles.last_seen_overview_at`.
- UI: the Overview "Since your last visit" section and the artist Activity tab.

## Starting Code Surfaces
`src/lib/dashboard/action-digest.ts`, `src/app/api/activity/route.ts`.

## Data Changes
One column on `user_profiles`.

## Security
Events are filtered by *current* scope and by internal visibility.

## UX
One grouped line per actor per day. No per-event toasts.

## Acceptance Criteria
- 10 uploads within 10 minutes render as one line.
- An artist does not see internal events.

## Tests
- `digest.test.ts`.
- Route visibility tests.

## Carried from LABEL-19
- **Visibility is decided at write time per verb** (`defaultVisibility`, `lib/labelos/activity.ts`): the feed reads `activity_events` under 136's policy, so an A&R member already sees only `artist` rows. Apply `08` §B4's *current-scope* rule on top (artist scope via `can_see_artist` / the route helpers); do not re-derive visibility from the verb in the digest.
- **Verbs added:** `file.updated`, `file.deleted`, `release.updated`, `release.deleted`. A tracklist edit is `release.updated` with `payload.items` ∈ `added | removed | reordered | edited`; a cancel is `payload.state`. The digest's collapse rules should group these rather than print five lines for one reordering.
- **Context keys:** release and new-song events carry `artist_id`; project-file events carry `project_id` only.
- **History is complete from creation:** orgs from 137 have a backfilled `org.created` (`payload.source = 'backfill'`).

**Built (for the orchestrator's merge gate):**
- **Migration 147 (not applied).** Closes the carried gap: `activity_events_member_read` now has the artist-scope predicate. Whole-org members (`scope = 'org'`, never role `artist`) read every event of their org; a scoped member or roster artist reads an event that names one of their artists (`member_artist_scopes`), or that names only a project in their scope (`labelos_scoped_projects()`); an event naming an artist is judged by the artist alone (a visible project does not widen it); **an event naming neither (members, invitations, settings, contact removals) is whole-org only**, and a `song_id` alone does not place an event (song events carry an artist or a project; a future song-only event stays hidden from scoped members until it names one). `catalog.read` and the internal class are unchanged. No per-row SECURITY DEFINER call: every scope disjunct is an uncorrelated subquery. Also two partial indexes (feeds by project and by song). `user_profiles.last_seen_overview_at` already existed since 136, so 147's `ADD COLUMN IF NOT EXISTS` is a no-op. Producer-era behaviour untouched. Rollback file and local check added; 136's check had one assertion edited (a roster artist can no longer read a context-free event, which is the point).
- **`lib/labelos/digest.ts` (pure, written test-first, 33 tests).** artist → day → actor, ONE line per actor per day, `describeLine` words ("Sam added 3 demos, created a project and added a file"). 10 uploads inside 10 minutes are one line (so are 10 spread over the day: the per-day rule subsumes the 10-minute one). A release's events are one part: `release.updated` with `payload.items` (added | removed | reordered | edited) reads "edited the tracklist of ‘EP’", `payload.state.to = cancelled` reads "cancelled ‘EP’", a created release absorbs its first edits, a delete absorbs everything. Views: overview, artist, project (day → actor) and song (one line per event, the audit view). Days are calendar days in the viewer's zone (UTC on the server and for hydration, the browser's zone right after). `VERB_PHRASES` is total over `Verb` (a test holds it).
- **`lib/labelos/activity-feed.ts` + `activity-store.ts`.** `eventVisibleTo` (the TS twin of 147's policy; the route filters with it because the service role bypasses RLS), `toFeedEvent` (field by field, a whitelisted payload summary — never the payload, an email or a token), D4 on top (`withholdHiddenSongs`: events about a song whose row the member may not read are counted as `restricted`, never listed; the song feed answers 404), `projectArtistsFor` (a project-only event is filed under the artists the member holds, so a heading never names an artist outside their scope). Reads reuse `orgProjectIdsInScope`, `artistProjects`, `orgTrackFacts` + `memberSeesTrackRow` and `scopedOrgQuery` (for contact names). Paging is a `(created_at, id)` keyset cursor (`<created_at>_<id>`), so events written in one transaction are never split by a page boundary; the scan is bounded (3000 rows) and never silent (`hasMore` + `nextBefore`). `asOf` trails the clock by 10 s (the database stamps a row with its transaction start).
- **`GET /api/org/[orgId]/activity`** (`?artist|project|song`, `since`, `before`, `limit`; Zod contract `OrgActivityQuerySchema`) and **`POST /api/org/[orgId]/overview/seen`** (the session's own `last_seen_overview_at`, monotonic and atomic by two plain conditional updates — PostgREST rejects `or=` on a PATCH — never past now, the body cannot name a user; on `NO_EVENT_HANDLERS` with its reason).
- **UI.** The Overview's "Since your last visit" (`OverviewDigest`, server-read for this member, "Show earlier" paging, "Mark all seen", marks the digest seen through `asOf` when the member LEAVES — not on alt-tab — and never toasts) and the artist **Activity** tab (`ArtistActivityTab`, a new tab in `OrgArtistWorkspaceTabs`). The digest failing never takes the roster down.

**Verification:** `tsc`, `eslint --quiet`, `vitest` (5,398 tests, +98), `next build` (CI stub env) and `check-store-dynamic`; `npm run db:local:check` (147's check: as `authenticated` with each member's own claims — scoped A&R, roster artist, owner, another org's owner, a non-member, the producer and anon — the events each reads, the scope sets equal to `can_see_artist` / `can_see_org_project`, current-scope follow-through, append-only, `last_seen_overview_at` unwritable and no wider to read than 136; plus the rollback). `e2e/label-org-activity.spec.ts` (registered in `e2e:real-db`; 8 tests, 1440 + 390): the real release / invitation routes write events the feed groups; a scoped member gets none of Kilo's through the route AND through RLS (the test fails on 136's policy: Kilo's and the internal rows come back); ten uploads inside ten minutes are one line; leaving marks the digest seen; the Activity tab; a paged read through real PostgREST with the cursor loses and repeats nothing across four events sharing one instant; `last_seen_overview_at` unwritable through PostgREST. `e2e:real-db` as a whole: 67 / 70 first run; the three failures (`artist-workspace-phase2` 1, `phase3` 5, `label-org-roster` 2 — the last because my own 100k-event EXPLAIN org was still in the local database) pass on re-run.
**R-08 explain (100k events, 20 artists, 200 projects, local Postgres 16, as `authenticated`):** whole-org owner, newest 100: 6.9 ms before, 7.1 ms after; full count 4.02 s → 4.09 s (unchanged: the cost is 136's two `has_org_cap` calls per row). Scoped A&R, newest 100: 13 ms before (**returning every artist's events — the leak**) → 29 ms after (only theirs); full count 10.8 s → 1.4 s. A first draft that called `can_see_artist` / `can_see_org_project` per row measured 816 ms for the newest 100, which is why the scope is three hashed subplans instead.

**Not done / found, not fixed:**
- **`last_seen_overview_at` is ONE value per user, not per org** (the column the spec names, on `user_profiles`). A member of two orgs who opens org A's Overview marks org B's digest seen too. The natural fix is `last_seen_overview_at` on `org_members` (one value per user per org), or a jsonb map; a decision for the orchestrator (it is a schema change to a column 136 created).
- **Co-members can read each other's `last_seen_overview_at`** (136's `user_profiles` SELECT policy: the user and anyone sharing a live org). Unchanged and no wider; narrowing it would need a column-level grant that also hides it from the user's own PostgREST reads.
- **The policy has no D4 song-row predicate.** The route withholds events about songs the member may not read (marketing never sees a working demo's `song.created` title); a member reading `activity_events` with their own JWT can still read it. Adding `can_read_org_track` per song event would cost a per-row definer call and hide a deleted song's history; no org route issues that read today.
- **Project and song feeds have an API and no UI** (the song history view belongs with the song page); only the Overview digest and the artist Activity tab are screens.
- A scoped member's Overview digest is a bounded scan filtered in TypeScript (the database filters only by org and visibility); an org with far more unrelated activity than theirs pages ("Show earlier") instead of narrowing in SQL.
- A `song.stage_changed` / `song.reviewed` line has generic words ("moved a song to a new stage"): LABEL-24/25 define the payloads and should extend `summarize` in `activity-feed.ts` and `VERB_PHRASES`.
- The producer routes `api/activity`, `api/tracks/[id]/similar`, `api/tracks/tags/bulk` and `api/tracks/tags` still treat `user_id IS NULL` as the producer's own while org rows are ownerless; the R-08 member-read cost on 141's guarded tables stands (PR #76). Neither is touched here.
- Lessons for the next session: after `next build`, delete `.next` before `next dev` (a stale production build made every `/api/org/[orgId]/…` route answer a Next 404); and PostgREST ANDs repeated `or=` params, but rejects `or=` on a PATCH.

## Out of Scope
Email/Slack digests (LABEL-38).

## Rollback
Flag off.

---

# LABEL-21 — External project members ("Shared with me")

**Area:** Collaboration
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-14, LABEL-19, D3
**Status:** Done (PR #84, squash 72d0c0c, 2026-10-06; migration 148, not applied — apply at final merge, after 146)

**Orchestrator decisions on #84 (accepted as implemented):**
- Gate: CI green on the latest commit (build-and-test, e2e, secret-scan); first CI run failed `type-scale.test.ts` (`text-[12px]` in `ProjectMembersPanel.tsx`), fixed by the orchestrator (11px) because the session had hit its usage limit. Diff is Label OS only (no producer route, no `pending.sql`).
- Acceptance verified by: route matrix `external-matrix.test.ts` (every org handler × 4 roles + stranger + signed-out), two-account real-DB e2e (4/4), RLS policy-state test, `db:local:check` (148 check + rollback).
- Streaming `variant=full` counts as "listen" (a viewer without downloads can capture a stream, as on token shares). Accepted; capture-proof listening needs a lossy full-length derivative (later).
- D4 audio classes do not apply to external members: the shared project is what is shared.
- Carries: comments → LABEL-22; propose-own-credit → LABEL-27; expiry control in the Members panel and an entry point for project-only users beyond the emailed link / switcher are not built.
- Still open before the final merge (unchanged): producer routes treating `user_id IS NULL` as own; R-08 guard cost.

## Objective
Invite a person with their own account into one org project as viewer, commenter, contributor or editor.

## Current State
Token `project_shares` only. The `editor` token can reorder tracks only.

## Required Change
- **Migration:** `project_members`, and a SQL `can_see_project(project)`.
- **Invitations:** support `project_id` + `project_role` (reusing `org_invitations`).
- **Join:** writes `project_members`, not `org_members`.
- **Scope:** `requireObjectAccess` project scope. External members may upload through the org upload wrapper **only into their project**.
- **UI:** a project members panel and `/shared`.

## Starting Code Surfaces
`supabase/migrations/011_project_shares.sql` (reference), `src/app/api/projects/[id]/shares`, `src/lib/auth/org-access.ts`.

## Data Changes
One table.

## Security
- External members never reach artist, org or other-project objects.
- Revocation takes effect on the next request.
- External downloads are audited.
- Token shares remain listen/comment only.

## UX
The external member sees the project, not the org chrome. The org switcher lists "Shared with me".

## Acceptance Criteria
The Producer X flow (W4) end to end; revoked → 403.

## Tests
- A route matrix (external × every org route → 403/404 except project-scoped ones).
- e2e with two accounts.

## Carried from LABEL-13 (#69)
- The org audio route answers 404 to anyone who is not an org member. Wire `externalCan` into `GET /api/org/[orgId]/audio/[trackId]` (recordings in their project only) and record `recording.downloaded` for external members, as LABEL-13's spec intended.

**Built (for the orchestrator's merge gate):**
- **Migration 148 (not applied).** One table, `project_members` (role `viewer | commenter | contributor | editor`, `allow_downloads`, `expires_at`), RLS on with two SELECT policies and no write grant; `can_see_project(project)`; `labelos_user_has_cap`; three audit functions (`labelos_audit_project_invitation_create`, `_project_member_update`, `_project_member_remove`) atomic with their `activity_events` row; and `CREATE OR REPLACE` of `labelos_accept_invitation` (139's — a project invitation writes `project_members`, never `org_members`, records `project.member_added`, and needs the inviter to STILL hold `share.external`) and of `labelos_audit_invitation_create` (146's — its pending lookup ignores project invitations). Local check + rollback in `supabase/local/checks` / `supabase/rollback`.
- **No policy on any other table gives an external member a read path** (`rls-final-state.test.ts` asserts every pre-148 policy is byte-identical and none mentions `project_members` / `can_see_project`). Their material is read through service-role routes under `externalCan` (06 §2.6), cell for cell.
- **Access helpers** (`lib/auth/org-access`): `requireExternalProject` / `requireExternalTrack` (404 for everything but a live membership of THAT project, read on every request), `requireProjectActor` / `requireTrackActor` (an org member keeps exactly the org answer; else a live external membership), `requireUploadActor`, `myExternalProjects`, `projectMemberRows`. `lib/labelos/project-members.ts` (pure): liveness, listening vs downloading, the upload plan, invitation and change validation.
- **Routes.** `GET /api/org/shared`; `GET /api/org` fills `shared`; `GET …/projects/[id]` serves an external member a shared view built field by field (`lib/labelos/shared-project`: no stored reference, stage, artist id or member id); `…/projects/[id]/members` (GET, POST), `…/members/[userId]` (PATCH, DELETE) and `…/invitations/[invitationId]` (DELETE), all behind `share.external` on the project; `/api/org/join` previews and accepts project invitations. **Audio** (`GET …/audio/[trackId]`): recordings of their project only; stream = `listen`; `download=1`, the WAV and a stem = `download_masters` (viewer / commenter only with `allow_downloads`); **every handed-over file is a `recording.downloaded` audit event written BEFORE the first byte** (if it cannot be written the file is not served; HEAD records nothing). **Upload wrapper**: a contributor / editor adds a NEW VERSION of a song in their own project, landing in THAT project only (never the song's other projects), credited to them (`tracks.created_by`, D3); new songs for an artist and master / instrumental / demo material are refused. Project invitations are listed and revoked on their project, not on the org members page.
- **UI.** The members panel on `/o/<slug>/projects/<id>` (invite, role, downloads, expiry-aware removal with a confirmation, revoke); `/shared` and `/shared/<project>` in their own `(label)/shared` layout with no org chrome (player + uploads tray + the switcher, whose "Shared with me" list is now filled); the join page names the project and the role.
- **The matrix.** `src/app/api/org/external-matrix.test.ts` walks EVERY handler under `src/app/api/org` as each of the four roles (with the member's own project's ids in every path param), a stranger and a signed-out caller: all 403/404/401 except the thirteen handlers (ten route files) named, with reasons, in `lib/labelos/external-routes.ts`. A new org route that forgets to refuse an external member fails it (proved by mutating one).
- **A proxy fix that mattered:** `src/proxy.ts`'s matcher excluded any path starting with `share`, which also excluded `/shared` — it would have skipped the flag, the session refresh and the membership gate. `share` is now a whole segment (`proxy-matcher.test.ts`).

**Verification:** `tsc`, `eslint`, `vitest`, `next build`, `npm run db:local:check` (148's check: RLS and grants as `anon` / `authenticated` / `service_role`; an external member reads only their own row and none of the project's tracks, files, comments, contacts, activity or org rows; `can_see_project` for an external member, a whole-org member, an artists-scoped member, a stranger and anon, plus expiry and a soft-deleted org; each audit function rolls its mutation back when its event cannot be written; accept for every refusal (mismatch, unverified, revoked, expired, inviter without `share.external`, used) and the happy path with no `org_members` row; the org path of accept still 139's; D3), unit + route tests, the parity test `org-access-project-parity.test.ts` (every user × every project: the TS walks equal `can_see_project`), and **`e2e/label-org-external-members.spec.ts` with two accounts on the real-database stack** (registered in `e2e:real-db`): the producer invites X from the members panel, X signs in and accepts, sees the project and not the org (404 on `/o/<slug>`, no org link), is refused on ~15 org routes, listens, downloads (one audit event), uploads a version (lands in P1 only, credited, `recording.uploaded`), is demoted to Viewer (download and upload 403 on the next request), removed ("revoked → 403"; the upload stays), an expired membership, a withdrawn invitation, and a signed-out caller with a share token reaches nothing.

**Not done:**
- **Comments and "propose own credit"** are LABEL-22 / LABEL-27. `externalCan('comment' | 'propose_own_credit')` is ready; the shared page says comments arrive later for roles that hold them, so the page never promises a control it lacks. LABEL-22's org comments route must use `requireProjectActor` and `externalCan('comment')`, and portal / share views keep hiding `internal` rows.
- **`edit_metadata` (editor)** has no org song PATCH route to wire (no org member can edit song metadata yet either); `externalCan('edit_metadata')` is ready for the route that adds it.
- Project **files** (`project_assets`) are not shown to external members: their sensitivity classes are LABEL-15's and §2.6 lists none of them.
- A person whose ONLY membership is a project reaches `/shared` through the emailed link, the switcher or a bookmark; `/login` still sends a non-producer to the buyer account (no change to store behaviour here).
- The external member's role summary (`projectRoleSummary`) states the §2.6 permission, which is wider than what is built today (see above).
- A membership has `expires_at` in the table and every check, but no screen sets it yet (the PATCH route takes it; the panel does not offer it).
- **Decisions a reviewer may want to revisit:**
  - **Streaming is `listen`, handing the file over is `download_masters`** (06 §2.6, W4 step 4). `variant=full` is the player's stream of the master, so a viewer without `allow_downloads` can still capture a stream, exactly as on a token share page with downloads off; what is blocked and audited is `download=1`, the WAV and the stems. A listen-only role that cannot capture a master needs a lossy full-length private derivative — an infrastructure choice, not made here.
  - **The audit is written BEFORE the first byte, and once per request.** A failed stream after it still leaves the event (it overstates, never understates), and the ranged requests a download manager makes each leave one. Deduplicating by `Range` would let a client that starts at byte 500 take most of the file unrecorded.
  - **D4's audio classes do not apply to an external member.** The project is what was shared: they can hear every recording in it, including working material and unclassified files that an org member without `audio.working` / `audio.finished` could not. §2.6 has no "finished only" column.
  - **A new invitation renews an EXPIRED membership** (invited role and downloads, expiry cleared); an invitation never changes a live one. Nothing in the panel sets an expiry yet.
  - `labelos_user_has_cap` asks the one `has_org_cap` about the inviter by setting the transaction's JWT claims for the call and putting them back, rather than copying 136's capability tables into a second function; the cost is that an unset claim reads back as `'{}'` for the rest of the transaction (`auth.uid()` is NULL either way).
- **Carried, not touched:** the producer routes `api/activity`, `api/tracks/[id]/similar`, `api/tracks/tags/bulk`, `api/tracks/tags` still treat `user_id IS NULL` as the producer's own; the R-08 guard cost on member reads of org rows stands.

## Out of Scope
Credits proposal UI (LABEL-27).

## Rollback
Drop the table; flag off.

---

# LABEL-22 — Org comments on `project_comments` (region-pinned)

**Area:** Collaboration
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-21
**Status:** In Progress (branch label-os/LABEL-22; runs in parallel with LABEL-25, migration 150 reserved)

## Objective
Threaded, region-pinned comments for org members, by extending `project_comments` (`17` R5). **No new `comments` table.**

## Current State
`project_comments` has track pins, `region_start` / `region_end`, threads, guest authors via share token, and portal threads via `contact_id` (mig 128).

## Required Change
- **Migration:** `project_comments.org_id` (set from the project), `visibility` (`internal` | `artist`, default `artist`), `resolved_at`.
- **Routes:** `/api/org/[orgId]/projects/[id]/comments` (CRUD, resolve, visibility).
- **Visibility:** portal and share views keep their existing filters, and also hide `internal` rows.
- **Carry-forward:** unresolved comments on a superseded version show on the current one, labelled "from mix v2".
- **UI:** reuse the region comment layer.

## Starting Code Surfaces
`src/app/api/projects/share/[token]/comments/route.ts`, `src/components/share/*`, portal comment code in `src/lib/artist-portal/`.

## Data Changes
Columns on an existing table.

## Security
`internal` comments never reach a portal, a share page or an artist-role member.

## UX
Inline. No modal.

## Acceptance Criteria
- An internal comment is absent from the portal and share JSON.
- Carry-forward shows exactly the unresolved comments.
- Portal comment e2e green.

## Tests
Route tests; the redaction test covers the portal view; jsdom test for carry-forward.

## Out of Scope
Release-level comments outside the release's project.

## Rollback
Drop the columns.

**Built (for the orchestrator's merge gate):**
- **Migration 150** (`org_id` set by a trigger from the project, `visibility` `artist` | `internal`, `resolved_at` / `resolved_by`; no new table). CHECK: an internal comment is an org comment with no share token and no contact, so a share-link or portal thread can never hold one. Trigger: a reply under an internal comment is internal, and a reply stays in its parent's project. `labelos_can_read_internal_comments(org)` = owner / admin / member of the org — never role `artist`, whatever override they hold. 141's `org_member_read` / `org_member_guard` on `project_comments` re-created with that one extra line.
- **Routes** `/api/org/[orgId]/projects/[id]/comments` (GET list / POST) and `…/[commentId]` (PATCH words, visibility, resolve / reopen; DELETE soft). Served to org members AND external project members through `requireProjectActor`. `?trackId=` returns that recording's comments plus carry-forward. The list query itself excludes `internal` for anyone who may not read it, and `visibleToActor` checks again; the response is built field by field (`toOrgComment`: no user id, org id, share token, contact id).
- **Pure rules** `lib/labelos/org-comments.ts` (who may read / comment / edit / delete / resolve / change visibility; `versionChain`, `carryForward`, `commentsForView`) with 31 tests; reads in `org-comments-store.ts`.
- **Carry-forward:** a song's own recording is `mix v1`; each `version` link FROM it appends the next, oldest first; the newest is the current mix. Only the current one carries, and only UNRESOLVED ROOT threads on its earlier versions (with their replies), labelled "from mix vN". A resolved thread, a native comment, a project-level one and another song's are not carried.
- **Portal / share / producer views** keep their filters and add `visibility = 'artist'` (`lib/labelos/comment-visibility`: the read steps down to the old filters on a database before 150). The pulse fingerprint ignores internal rows.
- **Activity:** `comment.created` / `.updated` / `.resolved` / `.deleted` in `VERBS`, `DEFAULT_VISIBILITY` and the digest phrases; the events name the comment and never its words, and the event of an internal comment is `internal`.
- **UI** (`OrgComments`, `OrgProjectComments`; inline, no modal): threads, replies, Resolve / Reopen, Edit / Delete, a pin at the playhead that seeks, "from mix v1" and "Team only" chips; the Team-only control exists only for someone who may write one. Mounted on the org project page (recording picker) and on the external member's project page (per recording + whole project; the "comments arrive later" note is gone).
- **A security hole closed on the way:** `GET /api/activity` (producer feed) still treated `user_id IS NULL` as the producer's own, and org rows are ownerless — any producer could read an org's project comments (internal notes included) and song titles. Org rows are now excluded (falls back before 141).

**Verification:** `tsc`, `eslint`, full `vitest`, `next build`, `npm run db:local:check` (150's check as `anon` / `authenticated` / `service_role`: roster artist with a `business.read.internal` override, external member, another org, anon, a stranger read no internal row; CHECK and trigger refusals; org_id from the project; rollback and replay), route tests on an in-memory database (access matrix per role, D4, carry-forward, events, revocation), external-route matrix, redaction tests for the portal list / pulse and the share list, `activity` leak test (fails without the fix), jsdom tests for the panel and the shared page, and `e2e/label-org-comments.spec.ts` (real database: the same bar by route, by PostgREST with each person's own JWT, and by the public share endpoint; carry-forward; revocation). Portal comment e2e (`artist-workspace-phase2` test 2) green.

**Not done:**
- Comments on an org SONG page (`/o/<slug>/songs/<id>`): a song can sit in several projects, so which project's thread to show there is a product choice; the project page and the external member's page carry the panel.
- A guest's share-link comment on an ORG project is not part of the org list (`share_token` rows are another conversation); org share links themselves are a later task.
- No realtime: the panel polls every 30 s while the tab is visible and refetches after each action.
- No notification or @-mention on a comment (LABEL-23 owns direct asks).
- **Decisions a reviewer may want to revisit:**
  - **Who may comment (org):** `review.comment` OR `catalog.write` — so producers and engineers (who give notes on mixes) can, marketing and finance cannot. No new capability, so no SQL parity change.
  - **Team-only = owner / admin / member of the org** (a role rule, not a capability): A&R and producers read and write them; a roster artist and an external member never. The event of a team-only note is `internal`, which `eventVisibleTo` reads through `business.read.internal`.
  - **A thread flipped to team-only takes its replies with it;** a reply cannot be made visible under a team-only root (409).
  - **"Current version" = the newest `version` link from the song.** There is no explicit current pointer in the model yet; swap `versionChain` if one arrives.
  - **Comments on a recording the member may not hear (D4) are hidden from them** (same rule as the audio route); an external member hears every recording of their project, so sees all its comments.
  - `api/activity` is fixed for projects and tracks only; the other carried producer routes listed under LABEL-21 are untouched.

---

# LABEL-23 — Org tasks + direct-ask notifications

**Area:** Work
**Priority:** P2
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-19
**Status:** Done (PR #90, squash e71f419, 2026-10-06; migration 151, not applied — apply at final merge, after 149 and 150)

**Orchestrator decisions on #90 (accepted as implemented):**
- Gate: CI green on the latest commit (build-and-test, e2e, secret-scan); diff is Label OS plus the intended producer-route touch (`/api/notifications` now reads `org_id IS NULL`, with a fallback before 151) and the org bell in `TopBar`.
- Acceptance verified by: route tests (exactly one notification row, to the assignee), real-DB e2e `label-org-tasks.spec.ts` (5/5, each person's own JWT via PostgREST), `db:local:check` (151 check, hashed subplans only per R-08, rollbacks), source-scan test forbidding `notifyDirectAsk` outside the task routes.
- `label-org-members` test 3 changed from "no bell" to "the org's own bell" for a non-producer member — intended by this task.
- Carries: the Label OS paragraph of CLAUDE.md still said a non-producer member's shell has no bell (folded in by the orchestrator); releases have no page, so a release task opens the Overview; `invitation` / `approval_requested` / `mention` / `credit_named_you` are in the closed union but nothing writes them yet (their own tasks do).

## Objective
Assignable tasks on artist/project/song/release, and notifications only for direct asks.

## Current State
`contact_tasks` (095) and `notifications` (064) are producer-scoped.

## Required Change
- **Migration:** `tasks` (typed nullable FKs, CHECK that at most one is set) and `notifications.org_id`.
- **Routes:** task CRUD.
- **Notifications:** `lib/labelos/notify.ts` exposes a closed union of **direct-ask** kinds (task_assigned, approval_requested, mention, credit_named_you, invitation). A test forbids broadcast kinds.
- **UI:** "My work" panel; tasks inline on song/release.

## Starting Code Surfaces
`src/lib/contacts/tasks.ts`, `src/lib/notifications/*`, `src/components/nav/TopBar.tsx`.

## Data Changes
One table and one column.

## Security
Notifications are scoped to the recipient plus the org.

## UX
The bell shows org notifications under the active org.

## Acceptance Criteria
- Assigning a task notifies only the assignee.
- The owner receives nothing for uploads.

## Tests
`notify.test.ts`; route tests.

## Out of Scope
Migrating `contact_tasks`.

## Rollback
Drop the table and column.

### Built (LABEL-23 implementer's note — the Status line above is the orchestrator's)
- **Migration 151** (not applied): `tasks` (typed nullable FKs `artist_id` / `project_id` / `song_id` / `release_id`, CHECK at most one; integrity trigger; service-role writes only; ONE read policy: creator, assignee or owner/admin, inside the member's artist scope, uncorrelated hashed subplans — `EXPLAIN` asserted in the local check) and `notifications.org_id` (nullable; RESTRICTIVE member-only SELECT policy; the 141 service-only trigger, so no member forges or edits an org notification through PostgREST). New helper `labelos_scoped_releases()`.
- **Who sees a task (D1 "each side its own"):** its maker, its assignee and an owner/admin — never "everyone who can read the song". Assignment needs `tasks.write`, and the assignee must be a live member who can reach the task's object exactly as opening it would (artist scope; D4 for a song's row), so a task never names something its assignee cannot see. A task is 404 (not 403) to anyone it is not visible to; the assignee may tick it off, only its maker or an owner/admin deletes it.
- **Routes:** `GET|POST /api/org/[orgId]/tasks` (`?view=mine|asked`, or `?kind=&id=` for one object), `PATCH|DELETE …/tasks/[taskId]`, `GET …/tasks/assignees`, `GET|PATCH …/notifications` (the bell under an org; recipient AND org in every query, `lib/labelos/notification-store.ts`). New activity verbs `task.created|updated|completed|deleted` (internal visibility, digest phrases, subject type `task`).
- **`lib/labelos/notify.ts`:** closed union `task_assigned | approval_requested | mention | credit_named_you | invitation`; `notifyDirectAsk` takes ONE recipient, never notifies the asker, never throws; `notify.test.ts` fails a broadcast-sounding kind, and a source scan fails any `notifications` insert under `lib/labelos` / `api/org` outside it and any caller outside the task routes. Only `task_assigned` has a caller today — the others are written by their tasks (approvals LABEL-32, credits LABEL-26/27, invitations, mentions).
- **Producer bell untouched:** `/api/notifications` now reads `org_id IS NULL` (it falls back to the old query if migration 151 is not applied), so a Label OS ask never reaches it or its badge; its tests assert the filter and the fallback.
- **UI:** "My work" (+ "Waiting on others") on the org Overview, tasks inline on the song view and on each release in the artist workspace's Releases tab, and the TopBar bell is the org's own under `/o/<slug>` (the producer's store-attention and activity log stay producer-only).

### Verification
`npm run db:local:check` (151's check as `authenticated` / `anon` + rollbacks), the route tests against the real `org-access` and an evaluating in-memory database, the extended external-member matrix (no external role reads or changes a task or notification even when rows name them), `e2e/label-org-tasks.spec.ts` against the real database (added to `e2e:real-db`).

### Not done
- Releases have no page of their own, so a `task_assigned` ask about a release opens the Overview ("My work").
- `invitation`, `approval_requested`, `mention` and `credit_named_you` are in the union and the bell's icon/link vocabulary but nothing writes them yet.
- No due-date reminders, recurrence or email for tasks (direct ask = the bell and, with the existing opt-in, an OS notification while a tab is open).
- `CLAUDE.md`'s Label OS paragraph is not extended here (LABEL-22 edits the same line in parallel); this note and the PR carry the conventions until the orchestrator folds them in.

---

# LABEL-24 — Song stage machine

**Area:** A&R
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-20
**Status:** Done (2026-10-06) — PR #83. No migration. `POST /api/org/[orgId]/tracks/[id]/stage` (song tracks only, `catalog.write`, compare-and-set, illegal move → 409, records `song.stage_changed` `{ from, to }`), the pure transition table in `lib/labelos/song-stage.ts`, `isReleased` derived from `countsAsOnRelease`, a digest line ("Sam moved Midnight to Selected", collapsed per actor per day) and `SongStageControl` on the org song view and the artist workspace.

**Orchestrator decisions on #83 (accepted as implemented):**
- **Exits from `on_hold`, `passed` and `archived`:** 04 W3's diagram has none, but says passed demos "are regularly revisited". `on_hold | passed | archived → in_review` is allowed (one line in `STAGE_TRANSITIONS` plus its test), so a song is never stranded. `selected` leaves only by archiving, as in the diagram.
- A roster artist may move their own songs only `inbox → in_review`.
- `isReleased` is `countsAsOnRelease`, so a song on a draft release counts. Nothing renders a "Released" badge yet.

**Open (not blocking, for later tasks):**
- The table does not consult release state: a song on a delivered release can still be passed, held or archived.
- A stage move refreshes its own control only; the workspace Overview stage counts are stale until reload.
- An event files under the song's first project (Inbox first) and that project's artist, so a song in several artists' projects is visible in one artist's scoped feed.
- Bulk move (the A&R Inbox keys and `BatchActionBar`) and the project page's read-only stage chip belong to LABEL-25's inbox screen; each song there goes through this route.

## Objective
Validated stage transitions with history.

## Current State
`tracks.song_stage` exists (LABEL-11; default `inbox` for org songs), with no transition rules.

## Required Change
- `lib/labelos/song-stage.ts`: `allowedTransitions(stage, caps)`, `transition(song, to)`. The `released` state is derived via `isReleased(song, releases)`.
- `POST /api/org/[orgId]/tracks/[id]/stage` (song tracks only) records `song.stage_changed`.
- UI: the stage `Dropdown` lists allowed transitions only.

## Starting Code Surfaces
`src/lib/library/triage.ts` (derived-state pattern).

## Data Changes
None.

## Security
`catalog.write` in scope. Artists can move their own songs only `inbox → in_review`. Artists **see** every stage change on their songs (D5).

## UX
Per `07` §2.3.

## Acceptance Criteria
- An exhaustive transition table test.
- An illegal transition → 409.

## Tests
`song-stage.test.ts`; route test.

**Built (for the orchestrator's merge gate):**
- **`lib/labelos/song-stage.ts` (pure, tests written first: 960 cases).** `STAGE_TRANSITIONS` is 04 W3's diagram as data; `allowedTransitions(stage, caps, role?)` and `transition(song, to, who?)` (`ok` + `from`/`to`, or a `reason`: `not_a_song` / `unknown_stage` / `same` / `forbidden` / `illegal`, with a message that names both stages). Nothing without `catalog.write`; a roster artist (role `artist`) gets `inbox → in_review` and nothing else. `isReleased(song, releases)` is `countsAsOnRelease`, the audio classifier's rule, so the two cannot drift; `released` is never stored. The test checks the table against an independent edge list and every stage × every capability set the 06 matrix names (owner, admin, each function, a function-less member, a roster artist, an artist with `catalog.write` revoked), both through `allowedTransitions` and through `transition` for every (from, to) pair. `SONG_STAGE_LABEL` moved here (re-exported from `org-workspace.ts`) so the module has no import cycle.
- **`POST /api/org/[orgId]/tracks/[id]/stage`** `{ to, from? }` (Zod `OrgSongStageBodySchema`; `released` is a 400). `requireObjectAccess` on the track + `catalog.write` (404 outside the member's scope, 403 read-only), then 404 for a row that is not a song with a stage or that D4 hides from the member. Illegal = 409 naming from and to. The write is a compare-and-set on the stage read (`moveSongStage`) and, when the client sends `from`, on what its screen showed: of two people moving one song the loser gets 409. Records `song.stage_changed` `{ from, to }` through `recordEvent`, with the song, its first project (an Inbox first) and that project's artist, so a feed scoped to an artist finds it; `DEFAULT_VISIBILITY` already gave it `artist` (D5) and `activity.test.ts` holds it.
- **Digest.** `song.stage_changed` with `{ from, to }` now reads "Sam moved Midnight to Selected"; several moves of one song by one actor in one day are ONE part with the first `from` and the last `to`; more than two songs in one line fold into "moved 5 songs to new stages" (a bulk move is not a list of titles). Titles come from a new optional `names.songs`, resolved in `activity-store.ts` for the songs the visible events name. The other collapse rules are untouched; an event without a usable `{ from, to }` keeps the generic words.
- **UI.** `SongStageControl` (a `Dropdown` of `allowedTransitions`, a plain chip when the member has none or outside the org shell; a failed move toasts the server's reason and leaves the stage as it was) on the org song view and on the artist workspace's Songs tab.

**Verification:** `tsc`, `vitest` (404 files, 6,395 tests), `next build` (CI stub env); `e2e/label-org-song-stage.spec.ts` (registered in `e2e:real-db`; 6 tests against the real stack): the owner walks inbox → … → selected → archived → in review; an illegal move and a stale `from` are 409 and change nothing; the Dropdown on the song page lists `Shortlisted / Passed / On hold / Archived` for an In review song and moves it (also shown on the Songs tab); a member scoped to Nova moves Nova's songs and gets 404 for Kilo's; a roster artist does `inbox → in_review` and every other move is 409 (the page then shows a plain chip); every move wrote `song.stage_changed` `{ from, to }` with `visibility = artist`, Nova and her Inbox, and refused moves wrote nothing. `label-org-workspace`, `-activity`, `-overview`, `-upload` and `-releases` re-run green beside it.

**Not done / found, not fixed (decisions for the orchestrator):**
- **04 W3's diagram has no way OUT of `on_hold`, `passed` or `archived`**, yet says passed demos "are regularly revisited". I added `on_hold → in_review`, `passed → in_review` and `archived → in_review` (the one reading beyond the diagram, a one-line edit in `STAGE_TRANSITIONS` and its test) rather than strand a song. Also by the diagram, `selected` leaves only by archiving (not passed or held), and `inbox → shortlisted` is not a move.
- **`isReleased` is `countsAsOnRelease`, as the task says: a song on a DRAFT release counts** (the audio classifier's rule: "not cancelled"). Nothing renders a "Released" badge yet; when something does, decide whether a draft should read as released (04 says "a release that is delivered").
- **The table does not consult release state.** A song on a delivered release can still be moved to passed, on hold or archived by a member with `catalog.write`; 04 W3 only says `released` is derived, not that it locks the stage. Whether a released song's stage should freeze is a product decision (`isReleased` is ready to gate it).
- **A move refreshes its own control, not the rest of the page**: the workspace Overview's stage counts are stale until the page reloads (the control does not call `router.refresh()`; the tabs' jsdom tests render without an app router).
- The song's artist is the first project's inbox / linked artist; a song in several projects of different artists files its event under one of them.
- Bulk move (07 §2.4 A&R Inbox `S` / `H` / `P` keys and `BatchActionBar`) is not built: it belongs with the A&R Inbox screen, and each song there goes through this route.
- The project page's song list (`/o/<slug>/projects/[id]`) still shows the stage as a read-only chip.

## Out of Scope
Reviews (LABEL-25).

## Rollback
Revert.

---

# LABEL-25 — Song reviews + A&R inbox

**Area:** A&R
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-24
**Status:** Done (PR #88, squash 436b2c7, 2026-10-06; migration 149, not applied — apply at final merge, after 148)

**Orchestrator decisions on #88 (accepted as implemented):**
- Gate: CI green on the latest commit (build-and-test, e2e, secret-scan). The orchestrator removed two stray `data/upload-staging/*/_meta.json` test artefacts that the base merge had committed (not on the base branch). Diff otherwise Label OS only.
- Acceptance verified by: route tests, real-DB e2e `label-org-song-reviews.spec.ts` (route AND PostgREST with each artist's own JWT), `db:local:check` as `authenticated` with each member's claims; EXPLAIN at 6,000 reviews shows no per-row SECURITY DEFINER (R-08).
- Read policy gates on `review.comment` + artist scope (narrower than the task's `catalog.read`): accepted — with `catalog.read` alone a whole-org marketing/legal member could read ratings and notes on working demos with their own JWT. Write needs `review.write`; a roster artist reads every review of their song and cannot rate.
- Extra `R` key (start review: inbox → in review) accepted: the stage table has no Inbox → Shortlisted move.
- Carries: tags / assign bulk actions of 07 §2.4 and a review panel on the song page are not built; a song in projects of two artists is readable by both artists' reviews (same rule as `can_see_org_track`).

## Objective
Per-reviewer ratings and verdicts, and a fast keyboard review queue.

## Current State
`rating_history` exists for the producer only.

## Required Change
- **Migration:** `song_reviews`.
- **Routes:** upsert my review; list reviews. **The song's artist sees every review, rating and verdict** (D5).
- **UI:** `/o/[orgSlug]/ar` inbox with J/K/Space/1–5/S/H/P/C shortcuts and `BatchActionBar` bulk actions.

## Starting Code Surfaces
`src/hooks/usePlayerKeyboardShortcuts.ts`, `src/components/ui/BatchActionBar*`.

## Data Changes
One table.

## Security
`song_reviews` is keyed by the song's `track_id` (`17` R7; distinct from `main`'s `contact_track_states`, which is the recipient's decision on a beat). Reviews are visible to org members in scope and to the song's artist (D5). Never to other artists or to external project members.

## UX
Keyboard hints spell out "Shift" / "Alt" (the Panchang glyph gotcha).

## Acceptance Criteria
- Two reviewers' ratings coexist.
- The song's artist sees all reviews; another artist in the same label sees none.

## Tests
Route tests; keyboard e2e.

## Out of Scope
Discovery analytics.

**Built (for the orchestrator's merge gate):**
- **Migration 149 (`song_reviews`, one table; not applied).** PK (`track_id`, `reviewer_id`); rating 1–5, verdict, note, any one required. The READ policy is the security core: `review.comment` (implied by `review.write`, implies `catalog.read`) in the row's org AND (whole-org member OR the song in the caller's artist scope) via the new `labelos_scoped_tracks()` (the songs of 147's `labelos_scoped_projects()`), so the song's artist reads every review of their song (D5) and another artist of the same label none; keyed on org membership only, so an external project member (LABEL-21) has no path to it. No per-row SECURITY DEFINER call (R-08): at 6,000 reviews the scoped member's newest 100 read in 7.9 ms against 3,186 ms for a per-row `can_see_org_track` policy, whole-org 2.0 ms against 1,273 ms (a first version with `has_org_cap(org_id, …)` on the row was correlated and cost 564 ms; the capability is now asked of the caller's memberships, a hashed subplan). Writes service role only (141's trigger) plus an integrity trigger (the song is a song of the row's org; identity never changes). Added to `labelOsTables()`, 141's service-only trigger list, `supabase/local/checks/149_*.sql` (as `authenticated` with each member's own claims: owner, whole-org and scoped A&R, the song's artist, another artist, other org, non-member, producer, anon) and `supabase/rollback/149_*.down.sql`.
- **Pure rules, tests first (`lib/labelos/song-review.ts`).** `mergeReview` (omitted keeps, null clears), `validReview`, `mayReview` (= `review.write`), `summarizeReviews`, `sortInbox` (inbox + in_review, oldest first), `inboxKeyAction` (what a key does; nothing while typing or with a modifier), `offeredStageKeys` (LABEL-24's `allowedTransitions` filtered to the keyed stages: nothing re-implemented), `cursorAfterRemoval`.
- **Routes.** `GET` / `PUT /api/org/[orgId]/tracks/[id]/reviews`: GET lists every review (reviewer names, never emails) for anyone who reads the song, PUT upserts MY review. **Capability: PUT needs `review.write`** (06 §2.6: owner/admin, A&R, project manager, artist manager); **a roster artist holds only `review.comment` and so READS every review of their song but cannot rate (403)**; marketing and legal have neither. Both 404 outside scope or for working material D4 hides. PUT records `song.reviewed` `{ rating, verdict, noted }` through `recordEvent` (visibility `artist`, D5): **never the note text**. `GET /api/org/[orgId]/ar` is the inbox read (`catalog.read`, scope, D4 `restricted` count).
- **Digest.** `song.reviewed` with a usable summary reads "Sam reviewed Midnight: 4 of 5, Shortlist"; one actor's re-reviews of a song in a day are one part; more than two songs fold into "reviewed 5 songs"; one without a rating or verdict keeps the generic words. `activity-feed.ts` whitelists `rating` and `verdict` only; `activity-store.ts` names the songs.
- **UI.** `/o/[orgSlug]/ar` (`ArInboxView`): J/K, Space (usePlayer + the org audio route), 1–5, S/H/P, C (note: Ctrl or Cmd + Enter saves, Escape cancels), plus **R** (start review: the transition table has no Inbox → Shortlisted move, so a review has to begin before S is allowed) and **X** (select), `BatchActionBar` bulk stage moves (songs the table refuses are reported, not sent), the focused song's reviews listed under the list (what its artist reads too). Stage moves run through LABEL-24's route one after another, each judged against the stage the one before left, update the row at once, drop it from the queue and call `router.refresh()` (so the workspace's stage counts follow). Nav: an "A&R inbox" entry in the Artists hub for members with `review.write` only (the page itself is open to `catalog.read`, so an artist reads by link). Keyboard hints spell out "Space".

**Review fixes (code review):** the PUT writes only the columns the request named (PostgREST merge), so a rating and a note saved together cannot undo each other; the inbox's saves and stage moves share one queue and a sequence guard drops an older reload; Escape does not save the note it abandons (blur guard); a cleared rating shows in the digest (the summary keeps explicit nulls); the loader chunks its `in` lists.

**Verification:** `tsc`, `eslint`, `vitest` (full: 408 files, 6,449 tests), `next build` (CI stub env), `npm run db:local:check`; `e2e/label-org-song-reviews.spec.ts` (registered in `e2e:real-db`; 6 tests against the real stack): two reviewers' rows coexist and each rewrites only their own; the song's artist reads both reviews (route and straight from PostgREST with their own JWT), cannot add one (403, and a forged POST through PostgREST fails); another artist of the same label gets 404 and zero rows by both paths, anon zero; `song.reviewed` rows carry no note text; the keyboard flow J/K/1–5/R/S/H/P at 1440 and 390 px; C and typing. `label-org-song-stage`, `-workspace`, `-activity`, `-overview`, `-roster`, `-members` re-run green beside it.

**Not done / found, not fixed:**
- **Decision for the owner: the policy gates reads on `review.comment` (+ scope), narrower than the task's `catalog.read`.** With `catalog.read` alone, a whole-org marketing or legal member could read every rating and note of a working demo straight from PostgREST with their own JWT (the routes' D4 row rule 404s them; the policy would not). `review.comment` is held by owner/admin, A&R, project manager, artist manager and the roster artist, so everyone D5 and 06 name still reads; marketing, legal and engineers read no review (GET answers 403 too). Loosening it to `catalog.read` is one word in the policy and the check.
- A song in projects of two artists (a project linking both) is readable by both artists' reviews, the same rule as `can_see_org_track`.
- The external-project-member check is in `149_*.sql` (LABEL-21 merged meanwhile): an editor on Nova's project with no org membership reads no review, even of the song in their project. The inbox / reviews ROUTES are org-member routes (`requireObjectAccess` needs an `org_members` row), so they give such a member nothing either.
- Tags and "assign" bulk actions from 07 §2.4 are not built (the task names move stage); the song page still has no review panel (the inbox lists them).
- `scripts/local-db/seed.sql` and `jwt.mjs` gain two signed-in accounts (artist-a / artist-b) for specs that need two roster artists of one label.
- `src/lib/labelos/mocks/memory-db.ts`: `upsert` now honours `onConflict` (merges into the row it names); before, it only inserted.

## Rollback
Drop the table.

---

# LABEL-26 — Creative direction

**Area:** A&R
**Priority:** P2
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-17
**Status:** Not Started

## Objective
A per-artist memory of references and direction.

## Current State
None.

## Required Change
- **Migration:** `artist_direction(org_id, contact_id PK, direction jsonb, updated_by, updated_at)` and `artist_references(…, contact_id, …)`, keyed by contact (`17` R3).
- **Routes:** CRUD, with a visibility filter.
- **UI:** the Direction tab (structured fields + references list; tracks referenced via picker; links; visual files as `project_assets` via LABEL-15).

## Starting Code Surfaces
`src/lib/share/track-picker.ts` (picker pattern).

## Data Changes
One column and one table.

## Security
Internal references are hidden from artist-role members.

## UX
No free-form wiki. Structured fields plus a list.

## Acceptance Criteria
An artist cannot read internal references.

## Tests
Route tests.

## Out of Scope
Recommendations.

## Rollback
Drop.

---

# LABEL-27 — Parties + credits on `track_collaborators`

**Area:** Rights
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-21 (D7: 115 applied on prod)
**Status:** Not Started

## Objective
Legal-grade credits by extending `track_collaborators` (`17` R8), and rights-holder parties. **No new `credits` table.**

## Current State
`track_collaborators(track_id, name, role, source, contact_id)` exists, with `groupCredits` / `visibleCredits` and credit → contact linking (`main`).

## Required Change
- **Migration:**
  - `parties` (`05` fields + `contact_id`).
  - `track_collaborators` gains `org_id`, `party_id`, `scope` (`composition` | `recording`), `status` (`proposed` | `confirmed` | `disputed`, default `confirmed` for existing rows), `role_detail`, `created_by`, `confirmed_by`.
- **Role vocabulary:** `lib/labelos/credit-roles.ts`, with RIN-aligned labels.
- **Routes:**
  - party CRUD (`rights.write`);
  - credit propose (any contributor, for themselves only), confirm, dispute, via `/api/org/[orgId]/tracks/[id]/credits`.
  - The existing producer `PATCH /api/tracks/[id]/collaborators` is unchanged.
- **UI:** the drawer's credits pills (`groupCredits`) show status and party in org context.

## Starting Code Surfaces
`src/lib/tracks/collaborators.ts`, `src/lib/upload/title-metadata.ts`, `supabase/migrations/115_track_collaborators.sql`, `124_song_beat_and_credit_links.sql`.

## Data Changes
One table and columns on an existing table.

## Security
- An external member can only propose a credit naming themselves.
- IPI and legal name are visible with `rights.read` only.

## UX
Proposed credits show "proposed", with Confirm for `rights.write`.

## Acceptance Criteria
- An external member can't propose a credit for someone else.
- Existing credits read unchanged.

## Tests
Route tests; `credit-roles.test.ts`; existing `collaborators` tests green.

## Out of Scope
Public credits on the store.

## Rollback
Drop `parties` and the new columns.

---

# LABEL-28 — Split sheets

**Area:** Rights
**Priority:** P0
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-27
**Status:** Not Started

## Objective
Versioned composition and master split sheets that validate to exactly 100%.

## Current State
None.

## Required Change
- **Migration:** `split_sheets` (keyed by the song's `track_id`), `split_lines` (`numeric(7,4)`). Triggers: lines are immutable once the sheet is circulated; the sum equals 100 on leaving draft.
- **Module:** `lib/labelos/splits.ts` (pure validation, suggested remainder).
- **Routes:** create, edit draft, circulate, record signature (upload the signed PDF as a restricted `project_assets` row (kind `split_sheet`), or an acknowledgement), supersede.

## Starting Code Surfaces
`src/lib/labelos/`.

## Data Changes
Two tables.

## Security
- `rights.write` for edits.
- Externals see their own line only (D2).
- Signed PDFs are restricted and their downloads audited.

## UX
The sum is shown live. "Add remainder" suggests the missing share.

## Acceptance Criteria
- 33.3333 × 3 cannot circulate.
- A circulated sheet cannot be edited (409, and the trigger holds).
- A new version supersedes the old one.

## Tests
`splits.test.ts` edge cases; a trigger test in the local DB; route tests.

## Out of Scope
E-signature integration.

## Rollback
Drop the tables.

---

# LABEL-29 — Legal readiness

**Area:** Legal
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-28
**Status:** Not Started

## Objective
Derived legal readiness per song, rolled up per release.

## Current State
The pattern exists in `src/lib/store/readiness.ts` and `src/lib/library/triage.ts`.

## Required Change
- `lib/labelos/legal-readiness.ts` implementing L1–L14 (`09` §3.1), the score (§3.2), and a `Reason` shape with a fix capability.
- `GET /api/org/[orgId]/tracks/[id]/legal-readiness` (song tracks).
- UI: a readiness popover on song detail and a Credits & Rights tab table.

## Starting Code Surfaces
`src/lib/store/readiness.ts`.

## Data Changes
None.

## Security
Reasons that reveal rights data require `rights.read`; otherwise only a count is returned.

## UX
The % is a display only, with named gaps (R-11).

## Acceptance Criteria
- Each requirement has a pass and a fail fixture.
- Gates use blockers, not the score.

## Tests
`legal-readiness.test.ts`.

## Out of Scope
Approvals.

## Rollback
Revert.

---

# LABEL-30 — Approvals (append-only, with snapshot)

**Area:** Workflow
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-29, LABEL-23
**Status:** Not Started

## Objective
Stored human decisions for the gates, with stale detection.

## Current State
None.

## Required Change
- **Migration:** `approvals` (INSERT only).
- **Module:** `lib/labelos/approvals.ts` (`currentDecision`, `isStale(snapshot, current)`).
- **Routes:** request (notifies the chosen approver) and decide (`release.approve.<gate>`), both through the audit RPC.

## Starting Code Surfaces
`src/lib/labelos/activity.ts`.

## Data Changes
One table.

## Security
Decide requires the gate capability. Requesters can't approve their own request unless they are owner or admin (D4 note).

## UX
Approved / Changes requested with a note (Frame.io vocabulary).

## Acceptance Criteria
Changing a split after approval → `isStale` true.

## Tests
`approvals.test.ts`; route tests.

## Out of Scope
Multi-approver quorum.

## Rollback
Drop the table.

---

# LABEL-31 — Legal handoff: queue + legal pack export

**Area:** Legal
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-30
**Status:** Not Started

## Objective
Send to legal, a legal queue, and an exportable legal pack.

## Current State
None.

## Required Change
- **Send to legal:** an approval request plus a task.
- **Legal queue page:** `/o/[orgSlug]/rights/legal`.
- **Export:** `GET …/releases/[id]/legal-pack` returning a CSV plus documents. Evaluate a zip dependency against brief §32 (`fflate` vs `archiver`: licence, maintenance, runtime, size). If rejected, return a manifest of presigned links.

## Starting Code Surfaces
`src/lib/contacts/export.ts` (CSV pattern).

## Data Changes
None.

## Security
`contracts.read`; the export is audited.

## UX
The queue is ordered by readiness, then age.

## Acceptance Criteria
- CSV columns per `09` §3.3.
- The export is denied without the capability.

## Tests
Export content test; route tests.

## Out of Scope
Contract generation.

## Rollback
Revert.

---

# LABEL-32 — Release readiness gates

**Area:** Release ops
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-30, LABEL-16
**Status:** Not Started

## Objective
Derived gate states per release.

## Current State
None.

## Required Change
- `lib/labelos/release-readiness.ts` implementing `09` §4, reading `organizations.settings` (Zod-validated in `lib/contracts/`).
- `GET …/releases/[id]/readiness`.

## Starting Code Surfaces
`src/lib/labelos/legal-readiness.ts`.

## Data Changes
None (the settings column exists).

## Security
Read requires `catalog.read`. Blocker details are filtered by capability.

## UX
None (LABEL-33).

## Acceptance Criteria
- A gate matrix test covering switches on/off and stale approvals.

## Tests
`release-readiness.test.ts`.

## Out of Scope
UI.

## Rollback
Revert.

---

# LABEL-33 — Release board + release detail + deliver

**Area:** Frontend / Release ops
**Priority:** P0
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-32
**Status:** Not Started

## Objective
Owners and PMs see every release's gates and can mark delivery.

## Current State
None.

## Required Change
- **Board:** `/o/[orgSlug]/releases`, a gate strip per release.
- **Detail:** tracklist editor, artwork, gates with blocker popovers.
- **Deliver:** `POST …/releases/[id]/deliver` requires ready (owner override with a note), records the distributor and date, and writes an audit event.

## Starting Code Surfaces
`src/components/ui/*`.

## Data Changes
None.

## Security
`release.write`. The override is owner-only.

## UX
No drag-to-stage (`07` §2.5).

## Acceptance Criteria
- e2e: a release goes from draft to delivered.
- An override without a note → 400.

## Tests
Playwright; route tests.

## Out of Scope
Distributor APIs.

## Rollback
Flag off.

---

# LABEL-34 — Metadata export + release calendar feed

**Area:** Integrations
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-32
**Status:** Not Started

## Objective
Distributor-ready metadata and an ICS feed of release dates.

## Current State
None.

## Required Change
- `lib/labelos/metadata-export.ts` (pure): release + items + contributors → CSV/JSON with ERN-aligned field names.
- `GET …/releases/[id]/export?format=csv|json`.
- `GET /api/org/[orgId]/calendar.ics`, with a signed per-user feed token.

## Starting Code Surfaces
`src/lib/labelos/identifiers.ts`, `src/app/api/calendar` (reference).

## Data Changes
None.

## Security
Export requires `release.write`. The ICS token is revocable and contains titles/dates only.

## UX
Download buttons on release detail.

## Acceptance Criteria
Snapshot test of the export for a fixture release.

## Tests
`metadata-export.test.ts`.

## Out of Scope
DDEX ERN XML; DSP delivery.

## Rollback
Revert.

---

# LABEL-35 — Needs attention + Overview v2

**Area:** Visibility
**Priority:** P0
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-33, LABEL-20
**Status:** Not Started

## Objective
The owner's exception list: blocked releases near target, songs stalled in a stage, overdue tasks.

## Current State
Overview v1 (LABEL-18).

## Required Change
- `lib/labelos/attention.ts` (pure; thresholds in settings).
- The Overview "Needs attention" section.
- An optional daily idempotent cron that only precomputes. No emails.

## Starting Code Surfaces
Store Editor "Needs attention" pattern; `src/app/api/cron/*` conventions.

## Data Changes
None.

## Security
Scope-filtered.

## UX
Each item names a person and a next action (`07` §3.2).

## Acceptance Criteria
The canonical scenario fixture yields exactly the expected 3 items.

## Tests
`attention.test.ts`.

## Out of Scope
Push/email alerts.

## Rollback
Revert.

---

# LABEL-36 — Org full-text search + command palette provider

**Area:** Search
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-35
**Status:** Not Started

## Objective
Fast, scope-safe keyword and identifier search across the org.

## Current State
`/api/search` (`ilike`, producer-only).

## Required Change
- **Migration:** generated `tsvector` (`simple`) plus GIN on org rows of `tracks` (song tracks), `contacts`, `releases`, `parties`, `projects` and `project_assets` (`17` R1–R3).
- **Route:** `GET /api/org/[orgId]/search?q=`, with identifier short-circuit via `identifiers.ts`.
- **UI:** a `CommandPalette` provider.

## Starting Code Surfaces
`src/app/api/search/route.ts`, `src/components/nav/CommandPalette.tsx`.

## Data Changes
Generated columns and indexes.

## Security
Results are post-filtered by scope. There is no count endpoint.

## UX
Results are grouped by entity.

## Acceptance Criteria
- An ISRC query jumps to the recording.
- An out-of-scope artist's songs never appear.

## Tests
Route tests with scope fixtures.

## Out of Scope
Semantic search.

## Rollback
Drop the columns.

---

# LABEL-37 — Structured relational filters + saved views

**Area:** Search
**Priority:** P2
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-36
**Status:** Not Started

## Objective
Answer the `08` §A2 example queries, and save them.

## Current State
Smart playlists and contact segments show the saved-filter pattern.

## Required Change
- `lib/labelos/filters.ts` (pure).
- **Migration:** `org_saved_views`.
- **UI:** a filter bar on Music and Releases; save view.

## Starting Code Surfaces
`src/lib/store/filters.ts`, `supabase/migrations/090_contact_segments.sql`.

## Data Changes
One table.

## Security
Shared views are visible to members, and results are still scope-filtered per viewer.

## UX
Uses the `InlineTagStrip`-style applied-filter chips.

## Acceptance Criteria
All seven example queries have passing tests.

## Tests
`filters.test.ts`.

## Out of Scope
Natural-language query parsing.

## Rollback
Drop the table.

---

# LABEL-38 — Weekly owner digest (email / Slack webhook)

**Area:** Integrations
**Priority:** P3
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-35
**Status:** Not Started

## Objective
An opt-in weekly summary for people who don't open the app daily.

## Current State
Resend exists. No Slack integration.

## Required Change
- An idempotent cron builds the digest from `attention.ts` + `digest.ts`.
- It sends via Resend, or posts to an org-configured Slack incoming webhook URL, stored encrypted or as a server-side secret per org (D-decision in LABEL-01 if needed).

## Starting Code Surfaces
`src/app/api/cron/*`, email templates in `src/lib/email/*`.

## Data Changes
`organizations.settings.digest`.

## Security
- Webhook URLs are never returned to the client after save.
- The digest respects the recipient's scope.

## UX
Opt-in per member.

## Acceptance Criteria
A second run in the same week sends nothing.

## Tests
Cron idempotency test.

## Out of Scope
Two-way Slack.

## Rollback
Disable the cron.

---

# LABEL-39 — Org export, deletion and event retention

**Area:** Compliance / Ops
**Priority:** P1
**Risk:** Medium
**Workstream:** L
**Dependencies:** LABEL-19, LABEL-15
**Status:** Not Started

## Objective
Owners can export and delete an org. Non-audit events are pruned per D9.

## Current State
`/api/privacy/erase` covers buyers only.

## Required Change
- **Owner export:** JSON + CSV of org tables, plus a manifest of object keys.
- **Soft delete:** a 30-day grace period (D10), then a hard-delete cron (rows + `orgs/<org_id>/` prefix).
- **Retention cron:** prunes non-audit events older than 24 months (D9).

## Starting Code Surfaces
`src/app/api/privacy/erase`, `src/app/api/cron/*`, `vercel.json`.

## Data Changes
None (the `deleted_at` column exists).

## Security
Owner-only, with re-authentication (fresh magic link). Audited.

## UX
A danger zone in settings, with `confirmToast` plus typing the org name.

## Acceptance Criteria
- After hard delete, no rows or objects remain for the org.
- Audit events survive until hard delete.

## Tests
Cron tests; route tests.

## Out of Scope
Per-person erasure inside an org (follow-up).

## Rollback
Disable the crons; soft-deleted orgs can be restored within the grace period.

---

# LABEL-40 — Retire the dormant team/invite flow

**Area:** Cleanup
**Priority:** P3
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-08
**Status:** Not Started

## Objective
Remove the non-functional `invites` / `team_members` surfaces, so no one builds on them.

## Current State
`src/app/(auth)/invite/[token]`, `/api/invite`, `/api/team`, `team_members`, `invites`, and `is_team_member()` exist but grant nothing (`01` §2.3).

## Required Change
- Redirect `/invite/[token]` → `/join/[token]` (the tokens are incompatible, so show "This invite has expired, ask for a new one").
- Delete the routes, the `local-store.ts` entries and the types.
- Leave the tables in place (a later migration can drop them after a quiet period).

## Starting Code Surfaces
The files above; `src/lib/local-store.ts`; `src/lib/types/index.ts`.

## Data Changes
None.

## Security
Removes a dead email-sending endpoint.

## UX
None.

## Acceptance Criteria
- No references to `/api/invite` or `/api/team` remain.
- The build is green.

## Tests
Existing tests updated; `invite/route.test.ts` removed with the route.

## Out of Scope
Dropping the tables.

## Rollback
Revert.

---

# LABEL-41 — Artist ↔ label connection

**Area:** Organizations / Collaboration
**Priority:** P1
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-10, LABEL-21
**Status:** Not Started

## Objective
An artist org can connect to a label org and share its whole catalogue or selected projects. The label sees that music through its roster, under its own staff permissions (D1).

## Current State
After LABEL-10 an artist org has one roster contact (the owner). After LABEL-21 people can join single projects. Orgs cannot see each other.

## Required Change
- **Migration:**
  - `org_connections`, with a unique active connection per (label, artist) pair.
  - `connection_projects`.
  - `contacts.artist_org_id` (`17` R3).
  - SQL `can_see_via_connection(project)`.
- **Routes:**
  - `POST /api/org/[orgId]/connections`: a label invites an artist org by slug or email, or an artist org requests a label.
  - Accept by the other side's owner or admin (`org.manage`).
  - `PATCH` share mode and selected projects: **artist side only**.
  - `DELETE` ends the connection (either side).
- **Access:** `requireObjectAccess` also admits label members to objects in shared artist-org projects, still filtered by the label member's own capabilities (marketing still gets finished audio only).
- **Beat reuse (D6):** "Use in a label song" makes a copy of a producer or artist recording into the label org, with `provenance` (`source_org_id`, `source_track_id`, `copied_at`, `copied_by`). No live cross-org references.
- **Audit events:** `connection.requested`, `connection.accepted`, `connection.ended`, `recording.copied`.

## Starting Code Surfaces
`src/lib/auth/org-access.ts`, the LABEL-21 project-members code, the LABEL-10 org contacts routes.

## Data Changes
Two tables, one column on `contacts`, a provenance jsonb column on `tracks` (nullable).

## Security
- The artist controls what is shared.
- Ending a connection removes access on the next request.
- Label members never see artist-org business-internal notes or contracts.
- A two-org **and** two-connection test matrix.

## UX
- Label roster rows show "Connected" with the artist's org.
- The artist org's settings list its labels and what each can see.

## Acceptance Criteria
- A connected label A&R hears the artist's shared demos.
- Label marketing sees only finished recordings.
- Ending the connection → 404 on the next request.
- A copied beat keeps provenance, and the source is unchanged.

## Tests
Route matrix; `org-access` unit tests for connection scope; e2e (artist org connects to label; A&R reviews a demo).

## Out of Scope
Deal terms and contracts between artist and label; multi-label conflicts beyond "the artist chooses per label".

## Rollback
Drop the connection tables; flag off.

---

# LABEL-42 — Released → store bridge

**Area:** Release ops / Storefront
**Priority:** P1
**Risk:** High
**Workstream:** L
**Dependencies:** LABEL-33, LABEL-41
**Status:** Not Started

## Objective
A release that is **released** can be put on the store, where everyone can listen, including albums already out on Spotify.

## Current State
- The storefront is single-producer (`resolveStoreOwner`, `src/lib/store/owner.ts`) and lists `tracks.store_listed` beats and featured projects.
- Label OS releases have no store presence. Unreleased org previews are private (D8).

## Required Change
1. **"Already released" import:** create a release with `imported_released = true`, a past `release_date`, UPC/ISRC optional, **skipping gates**. Owner/admin only, audited.
2. **List on store** (`release.write`, released only; unreleased → 409):
   - Sets `releases.store_listed`.
   - Promotes each item's preview from the private to the public bucket (D8).
   - Shows the release on the owning org's storefront as a project-bundle-style tile at `/store/releases/[id]`, with full-length or preview playback per a per-release setting.
3. **MVP store owner:** only releases owned by the **producer org of the current store owner**, or by an artist org connected to it, can be listed. Label/artist-owned stores are Phase 8.
4. **Unlist:** removes the release from the store. The public previews are deleted **only if** the release was never released publicly. The owner is asked.

## Starting Code Surfaces
`src/app/store/**`, `src/app/api/store/route.ts`, `src/lib/store/owner.ts`, `src/lib/store/public-media.ts`, `src/lib/store/filters.ts`, `src/lib/storage/upload.ts`.

## Data Changes
Uses the `releases.store_listed`, `store_listed_at` and `imported_released` columns (add them in this task's migration if LABEL-16 did not).

## Security
- **This touches the ISOLATED storefront.** Changes must be additive: a new section and route. Catalogue, checkout and `license_purchases` are untouched.
- `redactPublicTrackMedia` rules apply.
- New store pages must stay dynamic (`scripts/ci/check-store-dynamic.mjs`).
- Nothing new is loaded from outside the site, so no CSP change is needed.
- A preview is promoted to public only for released items.

## UX
The released badge is text plus a hairline border. Store tile per the storefront design rules; no new colours.

## Acceptance Criteria
- An unreleased release cannot be listed.
- An imported "already released" album lists and plays on `/store` at 1440 and 390 px.
- Unlisting hides it within the store's ~90 s cache window.
- Existing store e2e tests stay green.

## Tests
Route tests; `lib/labelos/store-listing.ts` pure eligibility tests; Playwright store spec.

## Out of Scope
Selling releases (checkout for label music); label/artist storefronts; streaming-service links beyond a URL field.

## Rollback
Unlist all, flag off, revert. Promoted previews stay public only for already-released music.
