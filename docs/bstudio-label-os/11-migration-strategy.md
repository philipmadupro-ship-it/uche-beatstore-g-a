# 11 — Migration Strategy

**Discovery 01 · 2026-09-30**

**Goal:** evolve a single-producer app into a multi-org system **without destabilising the producer's working product** (upload, library, store, checkout, shares, CRM).

**Method:** **expand → migrate → contract**, behind a feature flag, with the storefront isolated throughout.

---

## 1. Classification

### KEEP (unchanged, used by Label OS as-is)

| System | Why | Risk |
|---|---|---|
| Supabase Auth, sessions, `src/proxy.ts` refresh | Same identities | Low |
| Audio pipeline (upload sessions, processing jobs, Essentia, peaks, previews, chords) | The most expensive subsystem; recordings reuse it | Low |
| `track_versions`, `stems`, `track_stem_files`, `arrangements` | Recording internals | Low |
| Token shares + variants + HMAC media grants | No-account listening/pitching | Low |
| Player (`usePlayer`, `PlayerBar`, `useWaveSurfer`) | Plays org recordings | Low |
| Design system, primitives, guard tests | Binding | Low |
| Cron conventions, Resend, Stripe | Infrastructure | Low |

### EXTEND (existing tables/modules gain org-aware capability)

| System | Extension | Risk |
|---|---|---|
| `tracks` | + `org_id` (nullable), `isrc`, `created_by` | **High**: the most-read table; see §3 |
| `projects` | + `org_id`, `artist_id`; + `project_members` | Medium |
| `notifications` | + `org_id` | Low |
| `src/components/nav/model.ts` | `navGroupsFor(orgKind, caps)` | Low (pure, tested) |
| `src/lib/security/api-gate.ts` | `/api/org/*` membership gate | **High**: security boundary |
| `CommandPalette` | Org search provider | Low |
| `rls-final-state.test.ts` | Label OS assertions | Low |

### ABSTRACT (extract reusable primitives)

| From | To | Risk |
|---|---|---|
| `requireRowOwnership` / `requireProducer` | `src/lib/auth/org-access.ts` (`requireObjectAccess`) | Medium |
| `triage.ts` / `store/readiness.ts` pattern | `lib/labelos/{legal,release}-readiness.ts` sharing a `Reason` type | Low |
| `project_comments` region model | `comments` (org) | Low |
| `contact_tasks` | org `tasks` | Low |
| `action-digest.ts` grouping | `lib/labelos/digest.ts` | Low |
| `/api/upload/*` internals | Callable from org wrapper routes | Medium |

### REPLACE

| System | Replacement | Risk |
|---|---|---|
| `team_members` / `invites` / `is_team_member()` / `/api/team` / `/api/invite` / `/invite/[token]` | `org_members` / `org_invitations` / `/api/org/*/invitations` / `/join/[token]` | Low: the old flow is non-functional (audit §2.3) |
| `/api/audio` "who, not which" gate | Per-object check (for org audio via `/api/org/[orgId]/audio/*`; the producer route gets the same check before any second privileged user exists) | **Critical** |

### DEPRECATE (stop extending; remove after migration)

`team_members`, `invites`, `is_team_member()`, `/api/team`, `/api/invite`, `src/app/(auth)/invite/[token]` (after `/join` ships), `contact_tasks` (after org tasks and contact org-scoping), and `scopedList`'s `includeNullOwner = true` default (already flagged in the execution log).

### ISOLATE (untouched in Phases 1–6)

| System | Why |
|---|---|
| Storefront `/store/**`, `/api/store/**`, `resolveStoreOwner` | Single-tenant by design; a label org needs no store in MVP; the CSP-enforced surface |
| Checkout, Stripe webhook, `license_purchases`, `project_access_links`, promo codes | Money path; `seller_user_id` has 123 references |
| Buyer accounts (`/api/store/me`, buyer tables) | Email-keyed; unrelated to orgs |
| Producer dashboard routes `(dashboard)/*` and their `/api/*` | Stay producer-gated; Label OS lives in `(label)` + `/api/org/*` |
| CRM (`contacts`, campaigns, beat sends) | Org-scoping deferred; artists/parties *link* to contacts |

---

## 2. Phase-by-phase data migration

| Step | Change | Kind | Reversible? |
|---|---|---|---|
| M1 (Phase 1) | Create org core tables (all NEW, `org_id`-scoped, RLS on) | Additive | Drop tables; no existing data touched |
| M2 (Phase 1) | Personal org for the producer: one `organizations` row (kind `producer`) + `org_members` owner, for the `creator_profiles` owner. Idempotent | Data, additive | Delete rows |
| M3 (Phase 2) | NEW music tables: `artists`, `songs`, `song_recordings`, `releases`, `release_items`, `files`, `project_songs` | Additive | Drop |
| M4 (Phase 2) | `tracks.org_id`, `projects.org_id` **nullable**, plus indexes. No backfill yet | Expand | Drop column |
| M5 (Phase 2) | Org uploads write `org_id`. Producer uploads keep writing `org_id = NULL` | Code | Flag off |
| M6 (Phase 2) | RLS on `tracks`/`projects`: **add** a second policy `org_member_read` (`org_id IS NOT NULL AND has_org_cap(org_id,'catalog.read') AND can_see_artist(...)`). The producer's `owner_only` stays | Expand | Drop the policy |
| M7 (later, own discovery) | Backfill producer rows `org_id = personal org`; convert producer routes to org checks; contract `owner_only` | **Contract** | Hard; needs its own plan |

**M7 is explicitly out of the Label OS MVP.** The producer's catalogue does **not** need to be org-scoped for a label to operate. Keeping producer rows `org_id IS NULL` means the 102 hand-written `user_id` filters and the storefront stay valid, and **no existing producer route changes behaviour** in Phases 1–6.

---

## 3. Risk hotspots and their controls

| Hotspot | Risk | Control |
|---|---|---|
| Adding a second RLS policy on `tracks` (M6) | Policies are OR-combined, so any bug in `org_member_read` widens access to producer rows | The policy requires `org_id IS NOT NULL`, and producer rows are NULL (so it cannot match them). A policy-replay test asserts this predicate is present. A two-user integration test runs against a local Supabase |
| Service-role routes | Bypass RLS; one missing filter leaks | New code only under `/api/org/*`; source-guard test (no `user_id` filters there; every route calls an `org-access` helper); per-route two-org tests |
| API gate widening | Org members reaching producer routes | Unit test: a member-only user gets 403 on every existing non-public `/api/*` prefix |
| `/api/audio` | Any privileged user reads any master | Org audio only via `/api/org/[orgId]/audio/[trackId]` with a per-object check (LABEL-13) **before** the first non-producer member is created in production |
| Public previews of unreleased music | URL leak = listen | D8: private previews for org recordings |
| Migration numbering collisions | Two branches claim the next number | Allocate at implementation time; check `git log --all -- supabase/migrations/`; register each in `supabase/MIGRATIONS.md` |
| Applying migrations before merge | Repo rule: apply **before** merging dependent code | Each backlog item lists its migration; production apply is a gated step owned by the producer |
| Long-lived isolated branch | Drift from `main` (heavy daily activity on `main`) | Merge `main` into the branch weekly; Label OS lives in new directories, so conflicts concentrate in `api-gate.ts`, `nav/model.ts`, `proxy.ts` |

---

## 4. Rollback posture

- **Phases 1–6 are additive.** Rollback means flag off (404 on `/o/*` and `/api/org/*`), then optionally drop the new tables.
- **No existing column changes type or meaning.** No existing policy is dropped. No existing route changes behaviour. The one exception is the API-gate change, which is a pure function with a unit test and a one-line revert.
- The personal-org backfill (M2) is data-additive and deletable.
