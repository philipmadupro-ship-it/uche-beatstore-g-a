# 00 — Executive Summary: BStudio Label OS, Discovery 01

**Workstream:** L — BStudio Label OS · **Priority:** P0 · **Risk:** Critical
**Date:** 2026-09-30 · **Branch:** `claude/happy-bardeen-rnosf3` (isolated; nothing merged into `main`)
**Scope of this change:** documentation only. **No code, schema, or production behaviour was modified.**

---

## Deliverables in this folder

| File | Contents |
|---|---|
| `00-executive-summary.md` | This file: approval gate, decisions required, verification |
| `01-current-system-audit.md` | What BStudio is, with repository evidence |
| `02-competitive-analysis.md` | ~20 products, sourced; gap analysis; the core product question |
| `03-user-personas.md` | 14 personas mapped to role / function / scope |
| `04-core-workflows.md` | W1–W9: membership, artists, A&R, shared projects, credits, legal, release, owner visibility, producer |
| `05-domain-model.md` | Entities, classification, integrity rules |
| `06-permission-model.md` | Role + capability + scope; enforcement; storage; links; audit |
| `07-information-architecture.md` | Navigation, screens, MVP tabs, UX rules |
| `08-search-and-activity.md` | Relational search; append-only activity; notification rule |
| `09-release-and-legal-workflows.md` | Lifecycle map, Legal Readiness spec, release gates, workflow-engine decision |
| `10-technical-architecture.md` | Architecture across the ten required models; API namespace; flag |
| `11-migration-strategy.md` | KEEP / EXTEND / ABSTRACT / REPLACE / DEPRECATE / ISOLATE; expand→contract |
| `12-phased-roadmap.md` | Phases 0–7 with exit criteria |
| `13-risk-register.md` | 24 risks |
| `14-engineering-backlog.md` | 40 atomic tasks (LABEL-01…40) in the required format |
| `domain-model.mermaid`, `workflow-map.mermaid`, `permission-model.mermaid` | Diagrams |

**Documentation location.** The repo keeps design docs under `docs/` (`design-direction.md`, `codex-execution-log.md`, `design-system/`), so `docs/bstudio-label-os/` follows that convention; there is no competing structure.

---

## APPROVAL GATE

### PRODUCT THESIS
BStudio becomes the system of record for a music company's **songs and the people and rights around them**: one connected record from demo to catalogue. On that record, readiness is *computed* rather than reported, access follows music-specific rules, and the existing producer and beatstore ecosystem feeds the label pipeline instead of sitting beside it.

### ROOT PRODUCT PROBLEM
Labels already run on Slack + Notion + Drive + spreadsheets. That is a Notion "Record Label OS" template sold to 500+ users (`02` §2), with ClickUp release templates on the side. **The relationships between things live in people's heads**:

- which mix is the master;
- whether the producer's IPI is known;
- whether the artwork was approved before or after it changed.

Every status field is manual, so it goes stale. Specialist tools own fragments: DISCO the pitch catalogue, Reprtoir and Curve the back office, VEVA and Vandall credits and splits, Pibox and Frame.io review, Chartmetric discovery. None of them connects **A&R → development → rights → release readiness** around the song.

### CURRENT SYSTEM EVIDENCE (`01`)
- A mature **single-producer** app: 171 API routes, migrations to 121, rich audio pipeline (upload → Essentia → peaks → private masters / public previews), projects, playlists, CRM with open tracking, token shares with 4 variants and region comments, storefront with Stripe.
- **Tenancy is the user.** `user_id = auth.uid()` RLS on every owned table, and **102 hand-written `user_id` filters** in service-role routes form the real boundary.
- The "producer" is simply "has a `creator_profiles` row". Buyers share the same auth, which has already caused four security fixes (117/119/120, `/api/audio`).
- A **team/invite concept exists but is non-functional**: the invite page cannot read its own row under RLS, and acceptance never grants membership.
- **Storage has no per-object authorization.** `/api/audio` gates on *who*, and its own comment says a second privileged user breaks it.
- **Derived readiness is an established, tested pattern** (`triage.ts`, `store/readiness.ts`). That is exactly what Legal and Release Readiness need.

### COMPETITIVE EVIDENCE (`02`)
- Table stakes are org + guests, secure sharing, region comments, version stacks, DDEX-aligned credits and identifiers, 100%-validated split sheets, approvals with audit, and search. BStudio already has sharing and region comments.
- Differentiation is **identity across the lifecycle + computed readiness + credits captured at the source + the beat → song bridge**.
- Dangerous scope: chat, royalty accounting, DSP delivery, workflow builders, contract generation, AI A&R prediction, CRDT editing.
- **Caveat:** competitor facts come from search-result summaries, because direct page fetches were blocked by this environment's egress policy. They are sourced but should be re-verified before external use.

### ARCHITECTURE PROPOSAL (`05`, `06`, `10`)
- **Pooled multi-tenancy by `org_id`** on new tables, in the same Supabase/Next.js app. No new services, databases, queues, auth, storage, frameworks or dependencies.
- **Organization → Artists (primary scope) → Songs → Recordings.** Recordings **are** existing `tracks` rows; no pipeline duplication. Projects are extended with members. Releases, parties, credits, split sheets, files, approvals, tasks, comments and activity events are new.
- **Role + capability + two scopes (artist, project).** Capabilities are code-defined and mirrored in SQL under a parity test. External collaborators are **account-based project members**, the Teams shared-channel model. Tokens remain for listening and never contribute.
- **Derive, don't store:** release gates, legal readiness, "released", "catalog". Stored: human decisions (song stage, reviews, approvals with snapshots, delivered).
- **No workflow engine.** Code-defined gates plus per-org switches.
- **Relational search** with Postgres FTS; no semantic search.
- **Append-only activity** with a strict "notify only direct asks" rule.
- Label OS lives in `(label)` + `/api/org/*`, behind `LABEL_OS_ENABLED`.

### SECURITY RISKS (`13`)
1. Masters readable by any privileged user (per-object audio first; LABEL-13).
2. Cross-org leaks through service-role routes (namespace + helpers + source-guard + two-org tests).
3. Gate widening into producer routes.
4. Additive RLS on `tracks` widening producer data (`org_id IS NOT NULL` predicate).
5. Unreleased music in public-bucket previews (private previews; D8).
6. Invitation takeover.
7. Split arithmetic and approve-then-change (numeric + snapshot staleness).

### MIGRATION RISKS (`11`)
- Everything in Phases 1–6 is **additive**, and the storefront, checkout, buyer accounts, producer dashboard and CRM are **isolated**.
- Producer rows stay `org_id IS NULL`. Backfilling and converting the producer catalogue (M7) is **explicitly out of the MVP** and needs its own discovery.
- The real migration risks are the first additive policy on `tracks`, the API-gate edit, migration-number collisions, unapplied migrations on prod, and drift of a long-lived branch from a busy `main`.

### MVP BOUNDARY
**Build (Phases 1–6):**
- Orgs, members, invitations, capabilities.
- Artists, songs, recordings (reusing `tracks`), files, releases.
- External project members, comments, tasks, activity digest.
- A&R stages + per-reviewer reviews + creative direction.
- Parties, credits, split sheets, Legal Readiness, approvals, legal pack.
- Release gates, board, delivery marker, metadata export, Needs attention.

**Do NOT build yet:**

| Area | Not built |
|---|---|
| Communication | Chat/channels; real-time co-editing; mobile apps |
| Money and delivery | Royalty accounting or statements; DSP/DDEX delivery; finance/advances |
| Legal | Contract generation or e-signature; PRO registration |
| Configurability | Configurable workflow builder; custom roles per org |
| Intelligence | Semantic/vector search or any AI feature; A&R prediction |
| Commerce | A storefront for label orgs |
| Media | Video review |
| Producer catalogue | Migrating the producer catalogue to org scope (M7); org-scoping the producer CRM |

---

## DECISIONS REQUIRED FROM THE PRODUCT OWNER (before LABEL-02)

These are recorded as ADRs by LABEL-01.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Ship an `artist` org kind (artists run their own org) in MVP? | **No.** Artists are users + org roster records; a personal org only if they sell beats | LABEL-03 |
| D2 | May external producers see the full split of a song they're on, or only their own line? | **Own line only** by default | LABEL-28 |
| D3 | When an external contributor leaves, who keeps their uploads? | **The project's org keeps them**, attributed; the contributor may download their own uploads while a member | LABEL-21 |
| D4 | May owners customise the role → capability table per org? | **No in MVP** | LABEL-02 |
| D5 | May an artist see the A&R stage/reviews of their own songs? | **Coarse stage yes, individual reviews no** | LABEL-24/25 |
| D6 | How does a producer's beat (their org) become a label song's source? | **Copy-on-accept with provenance**; no live cross-org references | LABEL-11 |
| D7 | Apply `115_track_collaborators.sql` on prod now and import it into credits later? | **Yes, apply it**; import in LABEL-27 | LABEL-27 |
| D8 | Private (non-CDN) previews for unreleased org music? | **Yes** | LABEL-14 |
| D9 | Retention for non-audit activity events | **24 months**; audit for the life of the org | LABEL-39 |
| D10 | Org deletion grace period | **30 days** | LABEL-39 |

Also for the owner: AGENTS.md currently states *"No multi-tenant producer model (yet)"*. Approving this blueprint changes the product definition. Per `CLAUDE.md`, AGENTS.md should be updated **when the product changes** (at Phase 1 merge), not now.

---

## Verification (brief §35)

| Check | Result |
|---|---|
| All referenced repository paths exist | **Pass.** Every existing-code path cited was checked with `test -e`. Paths under `src/lib/labelos/`, `src/lib/auth/org-access.ts`, `src/app/(label)/`, `src/app/api/org/` and `docs/bstudio-label-os/adr/` are **proposed** and marked as new |
| Proposed reusable systems actually exist | **Pass.** `tracks`/`track_versions`/stems pipeline, `projects`/`project_tracks`, `project_shares`/`project_comments` (regions), `share-media-token`, `triage.ts`, `store/readiness.ts`, `action-digest.ts`, `contact_segments`/`smart_playlists`, `rate_limits`, `rls-final-state.test.ts`, `api-gate.ts`, `CommandPalette`, `usePlayer` |
| Database assumptions confirmed | **Pass, from migrations and `supabase/MIGRATIONS.md`.** Production was not queried. 112/115/116 are not applied on prod per the ledger |
| Authentication understood | Pass (`01` §2.1) |
| Permissions understood | Pass (`01` §2.2–2.3) |
| Storage understood | Pass (`01` §2.4) |
| BeatStore understood | Pass, to the depth needed to isolate it |
| Collaboration understood | Pass (`01` §3) |
| Competitor claims source-backed | **Partial.** Every claim cites a URL, but content came from search summaries; primary pages were blocked by egress |
| No unnecessary entity duplication | Pass (`01` §4, `05` §3) |
| Engineering tasks have explicit dependencies | Pass. 40 tasks, numbered 01–40, and no task depends on a later-numbered task (script-checked) |
| Roadmap internally consistent | Pass. Security prerequisites precede exposure (`12` consistency checks) |

## OUT OF SCOPE (found, recorded, not acted on)

- `.claude/skills/{product-context,supabase-safety,repo-conventions}.md` state migration ceiling 092 (actual 121, next 122), and `product-context.md` says buyers have no accounts.
- `CLAUDE.md` says "~200 route files" (actual 171).
- The invite email button renders white text on a white background (`src/app/api/invite/route.ts`).
- The `scopedList` default `includeNullOwner = true` still serves calendar and smart-playlists, and 8 routes with the NULL-owner pattern remain (per the execution log).
