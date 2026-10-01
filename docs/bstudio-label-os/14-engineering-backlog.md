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
**Status:** In Progress (branch label-os/LABEL-07)

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
  - Roster = the org contacts that `isWorkspaceMode` accepts, plus any contact with an artist role in an org (Q2 default: label orgs have their own directory).
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
**Status:** Not Started

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
- **Rule helper:** `ensureInboxProject(org, contact)` makes sure every org song belongs to ≥1 project (Q1 default: one "Inbox" project per artist contact).
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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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
**Status:** Not Started

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

---

# LABEL-23 — Org tasks + direct-ask notifications

**Area:** Work
**Priority:** P2
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-19
**Status:** Not Started

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

---

# LABEL-24 — Song stage machine

**Area:** A&R
**Priority:** P1
**Risk:** Low
**Workstream:** L
**Dependencies:** LABEL-20
**Status:** Not Started

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
**Status:** Not Started

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
