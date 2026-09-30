# 12 — Phased Roadmap

**Discovery 01 · 2026-09-30**

- Task ids refer to `14-engineering-backlog.md`.
- **No calendar estimates are given.** Scope is expressed as atomic tasks, and each phase ends on **exit criteria**, not a date.
- Everything is behind `LABEL_OS_ENABLED` until Phase 3 exit, at the earliest.

**Global testing rule** for every phase: `npx tsc --noEmit && npm test && npm run build` green (CI order). Pure modules have Vitest tests written first. Every new `/api/org/*` route has a **two-org test**: org B's member gets 403/404 on org A's object. UI flows that change get a Playwright spec at 1440 and 390 px (repo convention).

---

## PHASE 0 — Discovery ✅ (this deliverable)

| | |
|---|---|
| Objective | Research-backed blueprint + atomic backlog |
| Output | `docs/bstudio-label-os/*` |
| Exit criteria | Product owner answers D1–D10 (`00-executive-summary.md`) and approves the MVP boundary. **No implementation until then** |

## PHASE 1 — Foundation

| | |
|---|---|
| Objective | Organizations, members, invitations, capabilities, secure gates, with **zero change to producer behaviour** |
| Tasks | LABEL-01 → LABEL-09 |
| Dependencies | Phase 0 approval (D1, D2, D4, D10 especially) |
| Database | `organizations`, `org_members`, `org_invitations`, `user_profiles`, `activity_events` (schema); SQL helpers `org_role`, `has_org_cap`; personal-org backfill |
| Backend | `src/lib/labelos/capabilities.ts`, `src/lib/auth/org-access.ts`, `/api/org`, `/api/org/[orgId]/{members,invitations}`, `/api/org/join`; api-gate change; feature flag |
| Frontend | `(label)` route group; org switcher; Members settings; `/join/[token]` |
| Security | Membership gate on `/api/org/*` only; producer routes provably unchanged (gate test); hashed, email-bound, rate-limited invitations; audit events for membership changes via `recordEvent` (LABEL-05), atomic audit RPCs arrive in LABEL-19 |
| Testing | Capability table unit tests; SQL↔TS parity test; RLS replay assertions; gate test over all existing `/api/*` prefixes; invitation accept/expire/revoke/email-mismatch route tests; e2e join flow |
| Migration risk | **Low.** Additive tables only; one gate function change |
| Exit criteria | (1) A second account can be invited, accept, and see the empty label org. (2) That account gets 403 on every producer API route and a redirect on every `(dashboard)` page. (3) A buyer account gets 403 on `/api/org/*`. (4) The producer sees no UI change with the flag off. (5) CI green |

## PHASE 2 — Music Workspace

| | |
|---|---|
| Objective | Artists, songs, recordings, files and releases (structure only), browsable per artist |
| Tasks | LABEL-10 → LABEL-18 |
| Dependencies | Phase 1; **LABEL-13 (per-object audio) before any member can stream**; D6, D7, D8 |
| Database | `artists`, `member_artist_scopes`, `songs`, `song_recordings`, `project_songs`, `files`, `releases`, `release_items`; `tracks.org_id/isrc/created_by`, `projects.org_id/artist_id` (nullable) + `org_member_read` policies |
| Backend | Org upload wrapper; private previews for org recordings; presigned file routes; identifiers validators |
| Frontend | Roster; artist workspace tabs (Overview, Music, Releases, Projects, Files); song detail v1 (recordings stack, A/B); Org Overview v1 |
| Security | Per-object audio; artist scope enforcement; restricted files; org-prefixed keys; producer rows (`org_id IS NULL`) unreachable by `org_member_read` (test) |
| Testing | Two-org and two-scope (artist-scoped member) tests on every route; the upload wrapper sets `org_id`; the preview is private; e2e: artist uploads 3 demos → A&R sees 3 songs |
| Migration risk | **Medium**: first change to `tracks` / `projects` (nullable columns + an additive policy) |
| Exit criteria | Canonical scenario data can be entered: 5 artists, songs with demo/mix/master recordings, files, a release with items. An artist-scoped member sees only their artist. The producer library is unchanged |

## PHASE 3 — Collaboration

| | |
|---|---|
| Objective | External contributors, comments, activity, tasks: the "Uche × Producer X" flow end to end |
| Tasks | LABEL-19 → LABEL-23 |
| Dependencies | Phase 2; D3 |
| Database | `project_members`, `comments`, `tasks`; `notifications.org_id`; audit RPC functions |
| Backend | `recordEvent` + audit RPC; project invite/accept/revoke; comment + task routes; direct-ask notifications |
| Frontend | "Shared with me"; project members panel; region comments on song detail; artist activity tab; overview digest |
| Security | External members confined to one project; no token contributions; audit events append-only; revocation effective on the next request |
| Testing | External member cannot list org artists, other projects, or restricted files; revoked member 403; digest grouping tests; e2e Producer X flow |
| Migration risk | **Low** (additive) |
| Exit criteria | Producer X (a separate account with their own org) uploads mix v4 into a label project, comments, proposes a credit; the label sees it in the activity digest; revoking X ends access |

## PHASE 4 — A&R

| | |
|---|---|
| Objective | Demo review at volume and creative direction memory |
| Tasks | LABEL-24 → LABEL-26 |
| Dependencies | Phase 3 (comments, activity); D5 |
| Database | `song_reviews`; `artists.direction`, `artist_references` |
| Backend | Stage transition route (validated by the pure machine); reviews |
| Frontend | A&R inbox with keyboard review; stage dropdown of allowed transitions; Direction tab |
| Security | `internal` visibility hides reviews/notes from artists; per-reviewer rows |
| Testing | Transition table exhaustive test; the artist cannot read internal reviews; keyboard e2e |
| Migration risk | **Low** |
| Exit criteria | Canonical "10 demos" case: two A&Rs review independently; shortlist → development → selected; the artist sees coarse stage only |

## PHASE 5 — Credits + Legal

| | |
|---|---|
| Objective | Legal-grade credits and splits; Legal Readiness; legal handoff |
| Tasks | LABEL-27 → LABEL-31 |
| Dependencies | Phase 4; D2, D7; **115 applied on prod** if importing `track_collaborators` |
| Database | `parties`, `credits`, `split_sheets`, `split_lines`, `approvals` |
| Backend | Credit/party/split routes; split validation (numeric, sum = 100); immutability triggers; legal pack export |
| Frontend | Credits & Rights tab; readiness popover; legal queue; approve/request changes |
| Security | `rights.*`, `contracts.read`; restricted docs audited; externals see their own lines only (D2) |
| Testing | Readiness requirement table tests (L1–L14); sum edge cases (33.3333 × 3 ≠ 100 → blocker); approval snapshot staleness; export content tests |
| Migration risk | **Low** |
| Exit criteria | "Track 04 · Legal 82%" renders with named gaps; legal approves; changing a split afterwards marks the approval stale |

## PHASE 6 — Release Operations

| | |
|---|---|
| Objective | Release gates, approvals, metadata, delivery marker; owner visibility complete |
| Tasks | LABEL-32 → LABEL-35 |
| Dependencies | Phase 5 |
| Database | `organizations.settings` gate switches (a column from Phase 1, schema validated here) |
| Backend | Release readiness module; deliver route; metadata export; ICS; needs-attention cron |
| Frontend | Release board; release detail gate strip; Org Overview v2 (needs attention) |
| Security | Deliver override owner-only + audited; export requires `release.write` |
| Testing | Gate matrix tests; export snapshot tests against ERN-aligned field list; e2e release to "delivered" |
| Migration risk | **Low** |
| Exit criteria | The owner opens Overview and sees every release's blocking gate with a named person, without asking anyone |

## PHASE 7 — Intelligence

| | |
|---|---|
| Objective | Relational search, saved views, digests |
| Tasks | LABEL-36 → LABEL-38 |
| Dependencies | Phase 6 |
| Database | `tsvector` columns + GIN; `org_saved_views` |
| Backend | Org search API; filters module; weekly digest (email / Slack webhook) |
| Frontend | Palette provider; saved views |
| Security | Search results pass the same scope checks (no `count` leaks across scope) |
| Testing | Each §A2 example query as a test; scope leak tests on search |
| Migration risk | **Low** |
| Exit criteria | All seven example queries in `08` §A2 answered correctly and scope-safely |

## Cross-cutting (schedule alongside the phase noted)

- **LABEL-39** Org export/deletion + event retention cron (before any external customer: Phase 3+).
- **LABEL-40** Remove the dead invite flow (after LABEL-08 ships).

---

## Consistency checks

- Every task's dependencies point only to earlier-numbered tasks, or to tasks in earlier phases. Verified when writing 14.
- No phase requires M7 (the producer catalogue backfill); the ISOLATE boundary holds through Phase 7.
- Security prerequisites precede exposure. LABEL-06 (gate) comes before LABEL-08 (first second-user). LABEL-13 (per-object audio) comes before LABEL-14 (org uploads) and LABEL-17 (UI that streams).
