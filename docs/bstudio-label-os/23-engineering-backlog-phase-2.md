# 23 — Engineering Backlog, Phase 2 (LABEL-43 … LABEL-77)

**Written 2026-10-14 from the owner's answers (doc 22 §8) and the review findings (doc 21).**
Continues `14-engineering-backlog.md` (LABEL-01..42, all Done). Same rules: one task = one child
session = one PR into `claude/happy-bardeen-rnosf3` (**never `main`**), merged by the orchestrator
when CI is green. Status lines are owned by the orchestrator.

## Standing requirements (every task inherits these; they are not repeated below)

- Everything in `14-engineering-backlog.md` "How to read this backlog", and the child prompt in
  `16-execution-runbook.md`. Behind `LABEL_OS_ENABLED`. Zod contract, org-access helpers (no
  `user_id` under `/api/org/*`), `errorMessage`, `createLogger`, two-org test, two-scope test.
- **Pure logic in `src/lib/labelos/*` with Vitest first.** Every new org table goes into
  `labelOsTables()` in `rls-final-state.test.ts`; every SQL capability change keeps the TS↔SQL
  parity test green (`has_org_cap` vs `capabilitiesFor`).
- Every mutating `/api/org/**` handler records an event (`recordEvent`) or goes through an
  `auditRpc` function (`coverage.test.ts` enforces it). New verbs: add to `DEFAULT_VISIBILITY` and
  `VERB_PHRASES`. New direct asks: only through the closed union in `lib/labelos/notify.ts`.
- **A gate or a field only counts if a human can satisfy it in the UI.** Every task that adds a
  field ships its editor, validator, audit event, the role allowed to write it, and a Playwright
  journey that does NOT seed the field with the service key.
- Reviewer lessons that now bind: no unpaged reads and no long `.in()` lists (use
  `lib/labelos/paged-read.ts`); no per-row SECURITY DEFINER in RLS (R-08); producer routes must
  never reach org rows (`withoutOrgRows`); counts of things a viewer may not see are not shown;
  a migration that changes a policy gets a `supabase/local/checks/NNN_*.sql` that proves it as
  `anon` and `authenticated`, plus a rollback in `supabase/rollback/`.
- Migrations are **never applied** to Supabase and never added to `supabase/apply/pending.sql`;
  they are applied at the final merge. Numbers below are reservations; the orchestrator confirms
  the number when the task starts (`git log --all -- supabase/migrations/`), and updates the
  "next new migration" sentence in `CLAUDE.md` and `supabase/MIGRATIONS.md`.
- Design: `docs/design-direction.md`; no new colours; 1440 and 390 px; reduced motion.
- Plans / paid tiers are NOT in this phase (owner: "we will see together after"), but every
  module is gated through the entitlement object built in LABEL-47 so plans plug in later.

## Owner decisions that shape this phase (binding; doc 22 §8, doc 21 §5)

1. **Two faces:** an **independent artist/producer** (one person who is both) or a **label**
   (an organisation with artists, beatmakers, producers, rappers, collaborators and staff).
   Studio is dropped as a separate type. The owner (platform operator) licenses the software to
   either face, and **the access the owner grants decides which setup screens, departments and
   modules the licensee gets**.
2. **Every contract type has a template.**
3. **All principal departments exist on day one and are actionable in the app:** finance,
   marketing/PR, CEO ("the big boss"), artistic direction, producers, rappers, collaborators,
   legal, A&R, operations. The label should not need any other application.
4. **The artist always has the final say** on store listing and showcases. Where a release has
   several artists, any one artist's "no" withdraws it (orchestrator's choice under delegation).
5. Splits and contracts are integrated. The artist must be able to see the splits of their own
   songs (scoped), without co-writer contact details.

## Order of execution

```
A Hardening        43 → 44 → 45 → 46
B Accounts/setup   47 → 48 → 49 → 50 → 51 → 52
C Business data    53 → 54 → 55 → 56
D Contracts        57 → 58 → 59 → 60
E Finance          61 → 62 → 63 → 64
F Marketing / PR   65 → 66
G Leadership       67 → 68
H Collab + views   69 → 70
I Consent/playback 71 → 72
J Reliability      73 → 74 → 75 → 76 → 77
K Finish           78
```
Task numbers continue from 42; the table keys above use LABEL-nn = nn.

Migration reservations: 162–167 (A), 168–171 (B), 172–175 (C), 176–179 (D), 180–183 (E),
184–185 (F), 186 (G), 187 (I), 188 (J). Unused numbers are simply skipped.

---

## A. Hardening (from the independent review; small, no UI)

### LABEL-43 — Security hardening migrations
**Priority:** P0 · **Risk:** High · **Deps:** none · **Migrations:** 162, 163, 164 · **Status:** In Progress (session_01XomWvrxzd67FGQzax9EyM4)
- **162** `split_sheets`: `REVOKE SELECT … FROM anon, authenticated`; column-level `GRANT SELECT (id, org_id, track_id, kind, version, status, circulated_at, signed_at, superseded_at, created_at)`. Check asserts `note`, `created_by`, `circulated_by`, `document_asset_id` are unreadable for an own-line reader on their own JWT (doc 21 / G6 F1, the D2 breach).
- **163** trigger refusing UPDATE and non-cascade DELETE of `activity_events` rows with `audit = true`, service role included (G1 F6).
- **164** replace `org_members_member_read` and `user_profiles_self_or_co_member_read`: a caller whose org role is `artist` reads only their own row and rows with `role <> 'artist'`; staff limited to some artists do not read artists outside their list; uncorrelated (R-08), proved with `EXPLAIN` (G1 F1).
- Acceptance: the three checks fail on the old policies and pass on the new; roster-artist e2e still sees staff and themselves; parity and rollbacks pass.
- Out of scope: any UI.

### LABEL-44 — Integrity migrations
**Priority:** P1 · **Risk:** Medium · **Deps:** 43 · **Migrations:** 165, 166, 167 · **Status:** Not Started
- **165** `playlist_tracks` same-owner / same-org trigger (G3). **166** partial unique index: one artist contact per artist-kind org (G2 D1). **167** `release_items`: extend `release_items_store_lock` (158) to refuse add/remove on a non-draft release (exempt `imported_released AND NOT store_listed`) and take `FOR SHARE` on the release (G4/G7/G10 amendments); `labelos_audit_member_update` compares expected old values (G4).
- Acceptance: concurrent-add and tracklist-race checks in `supabase/local/checks/`; routes map the DB errors to 409s with a plain message.

### LABEL-45 — Search tokenization
**Priority:** P2 · **Risk:** Low · **Deps:** none · **Migration:** 168 · **Status:** In Progress (session_011ULZD1PDrEVrwr2TKj2iDr)
- `translate(file_name, '_.-@/', '     ')` in the generated tsvector columns; `[\p{L}\p{M}\p{N}]+` in `org-search.ts` `WORD`; apply D4 in the query (or page until 6 visible hits) so common words do not starve scoped members (G8 F2, F3).
- Acceptance: `mix` finds `final_mix.wav`, `x com` finds `a@x.com`, Hindi/Thai words match; tests for each.

### LABEL-46 — Per-org "since your last visit"
**Priority:** P2 · **Risk:** Low · **Deps:** none · **Migration:** 169 · **Status:** Not Started
- `last_seen_overview_at` per (user, org), written only by `POST /api/org/[orgId]/overview/seen`; backfill from the user-level value (G5).
- Acceptance: visiting org A does not clear org B's feed; two-org test.

---

## B. Accounts, licensing, setup

### LABEL-47 — Account faces, entitlements, platform console
**Priority:** P0 · **Risk:** High · **Deps:** 43 · **Migration:** 170 · **Status:** Not Started
**Objective:** the owner can license the software to an independent artist/producer or to a label, and decide what each licensee gets.
- Two faces map to existing kinds: **independent** = org kind `artist` (one person, functions `producer`/`engineer` allowed, no roster); **label** = org kind `label`. Do not rename kinds; add a derived `accountFace(org)` in `lib/labelos/account.ts`. The `producer`-kind org stays the studio's personal org for the producer dashboard.
- `org_entitlements(org_id, modules text[], max_seats int null, max_artists int null, setup_done bool, granted_by, granted_at)`; `lib/labelos/entitlements.ts#orgEntitlements(org)` returns the module set (`contracts, finance, marketing, pr, executive, artistic, store, search, digest, export`…). **Default = everything the face allows**; plans later narrow it. `requireOrgCapability` ANDs it in; `navGroupsFor` reads it.
- **Platform console** `/platform` (platform operator only; a `platform_admins` table, seeded for the owner by SQL, never self-service): list licensees, create a licensee org with a face, set modules and seat caps, send the owner-invite. Every action audited.
- Acceptance: a licensee without `finance` gets 404 on finance pages/routes and no nav entry; the operator console is unreachable by any org member (two-org + member tests); parity and RLS-final-state tests updated.
- Out of scope: billing, plans, payment.

### LABEL-48 — Create organization + setup wizard
**Priority:** P0 · **Risk:** Medium · **Deps:** 47 · **Status:** Not Started
- `POST /api/org` (platform-licensed accounts only; independent creates kind `artist` + the owner's own artist contact, label creates kind `label`). First sign-in of a licensee with `setup_done = false` is redirected to `/setup`.
- Wizard steps (each skippable except 1): **1 Who are you** (the faces the licensee is entitled to) → **2 How you work** (pick the contract types you use; every type has a template, LABEL-57) → **3 Team and roster** (LABEL-50 window embedded) → **4 Departments** (toggle finance, marketing/PR, legal, A&R, executive, artistic direction, producers, collaborators; preset per face) → **5 Review and create** (creates org, roster, default gates from LABEL-52, optional first draft release).
- Acceptance: Playwright journeys for both faces at 1440 and 390 px; wizard is resumable; leaving mid-way creates nothing half-done (one transaction via audit RPC); `org.created` event.

### LABEL-49 — Departments and capabilities
**Priority:** P0 · **Risk:** High · **Deps:** 47 · **Migration:** 171 · **Status:** Not Started
- Add org functions and capabilities for the departments that do not exist: `finance` (`finance.read`, `finance.write`, `finance.approve`), `pr` (`pr.read`, `pr.write`), `executive` (`exec.read`, read-only across the org, no audio unless D4 allows), `artistic_director` (`creative.read`, `creative.approve`), `contracts` (`contract.read`, `contract.write`, `contract.sign`). Re-derive the matrix in `capabilities.test.ts` independently; mirror in SQL `has_org_cap`; keep the roster `artist` role unable to hold any of them.
- Acceptance: parity test green; a table of role×function×capability in the PR; mutation check on `NEVER_GRANTABLE`.
- Out of scope: the modules themselves.

### LABEL-50 — Roster and team window
**Priority:** P0 · **Risk:** Medium · **Deps:** 48, 49 · **Status:** Not Started
- One window ("Team and roster") usable from the wizard and from Organization: **add artist** (creates the roster contact, optional login invite with role `artist`), **add member** with role + functions + artist scope, **add collaborator** (beatmaker, producer, rapper, feature: a contact with a role and optional external-project invite), edit/remove with `planMemberChange` rules (last owner is 409).
- Reuses `POST /api/org/[orgId]/contacts` and invitations; adds the screens and the missing role pickers.
- Acceptance: add/remove for each role in e2e; scoped member sees only their artists; independent face shows "Your collaborators" instead of roster wording.

### LABEL-51 — Organization settings screen
**Priority:** P1 · **Risk:** Medium · **Deps:** 49 · **Migration:** 172 (audit function for settings) · **Status:** Not Started
- Owner-only screen and route for `legal_gate`, `marketing_gate`, `require_signed_master_split`, `attention_*`, departments on/off (within entitlements). Change and audit event in one transaction. `legal_gate = off` is an explicit, audited skip shown on every release it affects (decision 5).
- Acceptance: only owner can write; non-owner 403; event `org.settings_changed` names the keys, not values of notes; gate-off banner on the release page.

### LABEL-52 — Release gates v2 (policy)
**Priority:** P1 · **Risk:** Medium · **Deps:** 51 · **Status:** Not Started
- `seen` required for "Approved" (UI and API); self-approval requires an open request addressed to the decider (owners/admins exempt); song-level legal approval hidden once the song is on a release (release-level stays authoritative, UI says so); artwork size rule of spec 09 §4; restricted counts hidden from role `artist` and scoped staff.
- Acceptance: tests per rule, mutation checks, existing approval e2e updated to the UI path.

---

## C. Real music-business data

### LABEL-53 — Recording and song metadata editor
**Priority:** P0 · **Risk:** Medium · **Deps:** 49 · **Migration:** 173 · **Status:** Not Started
- Editor on the song page and tray: title, version, **ISRC**, **ISWC**, BPM, key, language, explicit, genre, recording date, **P-line**, master owner, notes. `PATCH /api/org/[orgId]/songs/[trackId]` (today GET only); ISRC needs `release.write`, creative fields `catalog.write`; validators exist (ISRC/ISWC); ASCII-only identifiers; CAS on `updated_at`.
- Acceptance: the release "Track has no ISRC" blocker offers a working link to this editor; a Playwright journey sets an ISRC with no service-key seeding; audit event names fields, never values of notes.

### LABEL-54 — Parties and payee data
**Priority:** P1 · **Risk:** Medium · **Deps:** 49 · **Migration:** 174 · **Status:** Not Started
- Parties page (G6 spec gap): legal name, stage name, address, country, tax id (restricted: `rights.write`/`finance.read` only), **PRO**, **IPI/CAE**, publisher, publisher IPI, payee details reference (no bank numbers stored in the app; a free-text "payment instructions" restricted to finance), invite-to-confirm. Credit **withdraw**. Lock `display_name`/`user_id` once a sheet naming the party is circulated, or snapshot names onto lines (G6 D-c).
- Acceptance: scoped members only see parties in scope; roster artist sees names/roles/shares only (decision: no co-writer contact data); mutation check on the lock.

### LABEL-55 — Create release, release metadata, master chooser
**Priority:** P0 · **Risk:** Medium · **Deps:** 53 · **Migration:** 175 · **Status:** Not Started
- "New release" (draft) from the releases board: title, type (single/EP/album), artists, label name, **UPC**, **C-line / P-line**, territories, distributor, genre, language, planned date, explicit. Tracklist add with **master chooser** (default = the single linked master; otherwise ask); `master_track_id` editable from the row (PATCH exists).
- Acceptance: all seven gates are satisfiable by a human in the UI; `label-org-release-board.spec.ts` rewritten so ISRC and master are set through the UI, not the service key; "Deliver anyway" stays owner-only and audited.

### LABEL-56 — Delivered-release lifecycle and draft-song class
**Priority:** P2 · **Risk:** Low · **Deps:** 55 · **Status:** Not Started
- A delivered release cannot be cancelled; it can be **withdrawn** (audited, unlists from the store, keeps the record); fix the DELETE message. Songs on a draft release stay `working` (not `finished`) until the release is ready: update `recording-kind`/org-audio class and tests.

---

## D. Contracts

### LABEL-57 — Contract model and templates (all types)
**Priority:** P0 · **Risk:** High · **Deps:** 49, 54 · **Migration:** 176 · **Status:** Not Started
- Tables `contract_templates` (platform defaults + org-editable copies), `contracts` (type, parties, artist/song/release links, status `draft|sent|signed|void`, term, territory, fields jsonb, version), same-org triggers, RLS keyed on `contract.read` + artist scope (an artist reads only their own contracts).
- **Template for every type:** recording agreement, distribution, licence (sync/sample), 360, producer agreement / work-for-hire, beat licence/lease, feature, co-writing/co-publishing, management, collaboration, session/engineer, work-made-for-hire, mixing/mastering, NDA. Each template = clauses with merge fields (parties, advance, royalty rate, term, territory, splits) in `lib/labelos/contracts/templates/*`; **text is placeholder legal wording marked "not legal advice, have counsel review"**; the owner/legal replace it in the template editor.
- Acceptance: every type has a template that renders with sample data; two-org and two-scope tests; template editor (`contract.write`) versions templates.

### LABEL-58 — Contract editor and document generation
**Priority:** P0 · **Risk:** Medium · **Deps:** 57 · **Status:** Not Started
- Create a contract from a template for an artist/song/release; fill merge fields (with suggestions from parties and splits); live preview; generate HTML/PDF stored as a restricted `project_assets` row; clause-level edits tracked in versions; "send for signature" moves to `sent`.
- Acceptance: PDF contains the filled values (test parses text); restricted download audited; 390 px usable.

### LABEL-59 — Contract ↔ split sheets
**Priority:** P0 · **Risk:** High · **Deps:** 58 · **Migration:** 177 · **Status:** Not Started
- A contract of an applicable type creates or pre-fills the split sheet (master/publishing percentages from the contract fields); a circulated sheet that disagrees with its contract shows a drift warning on both; signing the contract can require a signed sheet (`require_signed_master_split`). Splits stay integer-unit exact (no float); 33.3333×3 refusal stays.
- Acceptance: tests for prefill, drift, and the signed-sheet requirement; D2 holds (note never leaves the route).

### LABEL-60 — In-app signature and contract store
**Priority:** P1 · **Risk:** High · **Deps:** 58 · **Migration:** 178 · **Status:** Not Started
- Signing flow for members and external signers (token link like the artist portal): typed/drawn signature, timestamp, IP hash, document SHA-256 recorded in an append-only `contract_signatures` table, countersign, certificate page; void/supersede. Contract store with search and expiry reminders (calendar feed).
- Acceptance: signature rows immutable (trigger); a changed document hash invalidates earlier signatures; audit events; the page states plainly this is an in-app signature, with a field for an external e-signature provider URL (provider integration is a later decision).
- Out of scope: third-party e-signature vendors.

---

## E. Finance

### LABEL-61 — Finance schema and permissions
**Priority:** P0 · **Risk:** High · **Deps:** 49, 54, 59 · **Migration:** 179 · **Status:** Not Started
- Tables: `payees` (link to parties), `advances`, `finance_periods`, `earnings_imports`, `earnings_lines`, `statements`, `statement_lines`, `payments` (records only; **the app never moves money**). Money as integer minor units + currency; RLS on `finance.read` + artist scope (an artist reads their own statements only).
- Acceptance: money arithmetic helpers in `lib/labelos/finance/money.ts` (integer, rounding rule documented, largest-remainder allocation) with property-style tests.

### LABEL-62 — Earnings import and royalty calculation
**Priority:** P0 · **Risk:** High · **Deps:** 61 · **Migration:** 180 · **Status:** Not Started
- CSV import (generic mapper + presets for common distributor reports), idempotent by file hash; match lines to recordings by ISRC/UPC; allocate by the song's current splits (master/publishing) and contract terms; **recoupment** of advances per payee; unmatched lines queue.
- Acceptance: golden-file tests for allocation and recoupment; re-importing a file changes nothing; unmatched queue is scoped.

### LABEL-63 — Statements and payment tracking
**Priority:** P1 · **Risk:** Medium · **Deps:** 62 · **Migration:** 181 · **Status:** Not Started
- Generate a statement per payee per period (PDF/CSV), approve (`finance.approve`), mark paid with a reference, export a payout CSV. Payee statements visible to the artist/collaborator in their own view.
- Acceptance: statement totals equal the sum of allocations (test); approval is append-only; artist sees only theirs.

### LABEL-64 — Finance dashboard and advances
**Priority:** P2 · **Risk:** Low · **Deps:** 63 · **Migration:** 182 · **Status:** Not Started
- Advances ledger (recoupable / non-recoupable), per-artist position, per-release income vs cost, period close; feeds the executive dashboard (LABEL-67).

---

## F. Marketing and PR

### LABEL-65 — Marketing plans
**Priority:** P1 · **Risk:** Medium · **Deps:** 49, 55 · **Migration:** 183 · **Status:** Not Started
- Per-release marketing plan: timeline (pre-save, teaser, release, post), tasks with owners (reusing LABEL-23 tasks), budget lines, asset requests to the artist (a closed notification kind), platform checklist; calendar integration; marketing gate can require a plan.
- Acceptance: scoped to the release's artist; marketing role without audio access cannot hear working demos.

### LABEL-66 — PR and press
**Priority:** P1 · **Risk:** Medium · **Deps:** 65 · **Migration:** 184 · **Status:** Not Started
- Press kit builder (bio, photos, links, one-sheet from release data), press contacts (org contacts with role `press`), outreach tracker per release (sent/opened/replied/coverage URL), embargo date. Press-kit page shareable by token with the same grant discipline as artist portals.
- Acceptance: embargo respected on shared pages; no private audio exposed (previews of unreleased music stay private, D8).

---

## G. Leadership and creative

### LABEL-67 — Executive (CEO) dashboard
**Priority:** P1 · **Risk:** Medium · **Deps:** 64, 65 · **Status:** Not Started
- Read-only cross-roster view for `exec.read`: pipeline by stage, releases by month, blocked releases, approvals waiting, income vs cost, top songs, task load by department, exports (CSV). Respects entitlements and D4; no audio.

### LABEL-68 — Artistic direction workspace
**Priority:** P2 · **Risk:** Medium · **Deps:** 49, 53 · **Migration:** 185 · **Status:** Not Started
- `creative.read/approve`: one place across direction, references, reviews, song stages and releases; optional **creative approval** gate on a release (off by default, toggled in settings).

---

## H. Collaborators and role views

### LABEL-69 — Collaborators: producers, rappers, features
**Priority:** P1 · **Risk:** Medium · **Deps:** 50, 54, 59 · **Status:** Not Started
- Invite a collaborator to a song or project with a role (beatmaker, producer, rapper, feature, engineer); they accept their credit and their split, see their contract and statements (scoped), upload stems/versions (existing external-member rules), and ask for things through the closed notification kinds. "My sessions" list for a collaborator who has several labels.

### LABEL-70 — Role views
**Priority:** P0 · **Risk:** Medium · **Deps:** 47, 49, 69 · **Status:** Not Started
- Navigation and home driven by `accountFace` + role + functions + entitlements (`navGroupsFor`): **independent artist/producer home** ("my music, my releases, my money, my contracts"), **label shell** (current, plus finance, marketing/PR, executive, artistic direction), **roster-artist "My music"** (own songs, releases, splits, contracts, statements, open asks), **collaborator home**. Artist-org owners no longer see A&R inbox / Legal queue / roster wording.
- Acceptance: persona matrix like G10's for every role×face, at 1440 and 390 px; forbidden pages 404 (settings may explain).

---

## I. Consent and playback

### LABEL-71 — Artist consent on store listing + showcase
**Priority:** P0 · **Risk:** High · **Deps:** 55 · **Migration:** 186 · **Status:** Not Started
- `listing_consents(release_id|showcase_id, artist_contact_id, state, decided_by, decided_at)`. The label lists a release (or a "greatest moments" showcase of released songs) → every credited artist gets a notification (new closed-union kind `listing_proposed`) → **any artist's "no" withdraws it and it cannot be re-listed without their yes**; the store-owner list "Releases from connected artists" with Unlist; consent text on the connection-accept screen.
- Acceptance: a listing never serves until no artist has said no (state machine in `lib/labelos/store-consent.ts`); notification test; coverage and external-matrix updated.

### LABEL-72 — Playback rules
**Priority:** P1 · **Risk:** Medium · **Deps:** 71 · **Status:** Not Started
- Default `preview`; `preview`-only listing allowed from delivery (teaser); `full` only from the release date, auto-fall back to `preview` if the date moves; `full` and listen-only external roles stream a **lossy full-length derivative, never the master**; durable per-IP limiter (`rateLimitDurable`); `Range` handling cannot return the whole file in one request for the derivative.
- Acceptance: tests for the date rules and fallback; the master URL is unreachable from public routes; throttle test.

---

## J. Reliability and polish

### LABEL-73 — Atomic audit functions
**Priority:** P1 · **Risk:** High · **Deps:** 44, 55 · **Migration:** 187 · **Status:** Not Started
- Implement `20-review-G7-atomic-deliver.md` with G10's amendments (raw `updated_at` string, fingerprint scope, one function family): `labelos_audit_release_deliver`, plus `release.imported`, `release.store_listed/unlisted`, org delete/restore/export, digest channel verbs. `AUDIT_RPCS` entry, `AuditRpcArgs` type, a check proving the four G7 cases, a rollback. Remove the compensating writes.

### LABEL-74 — Visibility decisions
**Priority:** P2 · **Risk:** Low · **Deps:** 52 · **Status:** Not Started
- Slack channel digest from the artist-visible, non-restricted view only (+ warning when sharing a saved view name); forbidden pages 404 except settings; `ensurePersonalOrg` gated on the flag; `references` cap no longer reveals internal references.

### LABEL-75 — Lifecycle decisions
**Priority:** P2 · **Risk:** Low · **Deps:** none · **Status:** Not Started
- `org.created` becomes audit-class (never pruned); purge cron gets a 45–60 s budget; sole-owner account deletion blocked with "transfer ownership or delete the organization first"; throttle `/api/store/releases/*`; doc drift (`artist_org_id` is SET NULL; AGENTS.md `team_members`).

### LABEL-76 — UI polish
**Priority:** P2 · **Risk:** Low · **Deps:** 70 · **Status:** Not Started
- Overview at 390 px (stage counts, next release) and the 1440 px header overlap; Label OS panels use tokens so `data-theme="de-roche-archive"` is readable; `/o` app chrome (logo/home/sign-out); stop UI-asks-server-refuses 403s in the console.

### LABEL-77 — Test infrastructure
**Priority:** P1 · **Risk:** Low · **Deps:** none · **Status:** Not Started
- `e2e:real-db` expect timeout 25 s; no e2e seeds a product field with the service key where a UI exists; decide and fix or delete the 47 stale default e2e specs; add `e2e` of the default suite flag-off to CI only if green.

---

## K. Finish

### LABEL-78 — Final integration and review
**Priority:** P0 · **Risk:** Medium · **Deps:** all · **Status:** Not Started
- Migration apply-order document for 136…N (never applied until the owner says), update `18-test-roadmap.md` (new screens, both faces, departments), update `19-independent-review-prompt.md` with groups G11+ for phase 2, update CLAUDE.md/AGENTS.md product text, run the review fleet on phase 2 (4–5 tasks each) and a G10-style cross-cutting pass, write `docs/bstudio-label-os/25-phase-2-report.md`.
