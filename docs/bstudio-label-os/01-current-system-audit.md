# 01 — Current System Audit

**Discovery 01 · Workstream L — BStudio Label OS · 2026-09-29**
**Branch:** `claude/happy-bardeen-rnosf3` (no code or schema changed by this discovery)

Every claim below is tagged:

- **FACT (repo)**: read in this repository at commit `5b9980f`, with file references.
- **INFERENCE**: a conclusion drawn from repo facts, not directly stated anywhere.
- **RECOMMENDATION**: what this discovery proposes.

Production state was **not** inspected. Where production matters, this document relies on `supabase/MIGRATIONS.md`, the applied-status ledger.

---

## 1. What BStudio is today (one paragraph)

**FACT (repo).** BStudio (internal name `antigravity`, product name "U2C Beatstore") is a **single-producer** application. It has a private dashboard (`src/app/(dashboard)/*`: library, projects, playlists, studio, contacts, calendar, links, campaigns, settings, store-editor, cover-art, sales, analytics, profile, offline) and a public storefront (`src/app/store/*`). `AGENTS.md` says so directly: *"One human user (the producer)"* and, under "What we explicitly don't do", *"No multi-tenant producer model (yet). Single `creator_profiles` row drives the store."* The stack is Next.js 16 App Router, Supabase (Auth + Postgres + RLS), Cloudflare R2, Stripe, Resend, and Vitest/Playwright. `find src/app/api -name route.ts` returns **171** route files, and `supabase/migrations/` holds files numbered up to **121**.

---

## 2. Identity, tenancy and authorization — the foundation Label OS changes

### 2.1 Who a user is

| Concept | How it is determined | Evidence |
|---|---|---|
| Authenticated user | Supabase Auth session (`@supabase/ssr`), refreshed in `src/proxy.ts` | `src/proxy.ts` |
| **Producer** | The user **has a `creator_profiles` row** | `src/lib/auth/ownership.ts#requireProducer`, `src/proxy.ts` (`isProducer`), `supabase/migrations/119_producer_only_catalogue_writes.sql` (`public.is_producer()`) |
| Buyer | Any authenticated user **without** a `creator_profiles` row (magic link / Google at `/store/account`) | `src/lib/security/api-gate.ts` header comment |
| Share recipient | **No account.** Holds a token (`share_links.token`, `project_shares.token`) | `supabase/migrations/011_project_shares.sql`, `src/lib/share/token-access.ts` |

**FACT (repo).** The producer/buyer split has already caused several security fixes:

- Migration 117 dropped a policy that let buyers insert a `creator_profiles` row, which would have made them producers.
- Migrations 119 and 120 made catalogue and share-link writes producer-only.
- `/api/audio` now uses `requireProducer`.
- The proxy 403s a signed-in non-producer on every non-allowlisted `/api/*` path (`src/lib/security/api-gate.ts`, `requiresProducerForApi`).

**INFERENCE.** Any new class of signed-in user is a security change, not a feature, because the current model has exactly two classes (producer, buyer). A label employee or an invited external producer would be a third class. Today the gate would classify them as a buyer and 403 them.

### 2.2 Tenancy = the user

**FACT (repo).** Every owned table is scoped by `user_id = auth.uid()`:

- Migration 097 (`097_strict_owned_rows.sql`) made `tracks`, `playlists`, `projects` and their junctions owner-only.
- Migration 118 finished the job for `arrangements`, `project_shares`, `project_comments`, `project_tags`, folder items and `contact_tags`.
- `src/lib/security/rls-final-state.test.ts` replays every migration's policies and asserts that no direct-row policy admits a NULL owner.
- `src/lib/db.ts` exposes an `OwnedTable` union (tracks, playlists, projects, contacts, calendar_events, share_links, smart_playlists, project_folders, playlist_folders, contact_segments) with `scopedList` / `getOwned` / `updateOwned` / `deleteOwned` / `insertOwned`.

Measured in the repo (grep counts at `5b9980f`):

| Measure | Count |
|---|---|
| Route files that use the service role or an auth helper | 147 |
| Service-role / admin client call sites in `src/app/api` | 247 |
| Hand-written `user_id` equality filters in `src/app/api` | 102 |
| `requireRowOwnership(` call sites | 79 |
| `requireProducer()` call sites | 20 |
| Migration files that mention `user_id` | 65 |
| `seller_user_id` references in `src` | 123 |

**INFERENCE.** Service-role routes bypass RLS. The **102 hand-written `user_id` filters are the real tenancy boundary**, not the policies. Moving to organization tenancy is therefore mostly a **route-by-route rewrite**, not a policy change. The 2026-09-29 log entry "/api/tracks is owner-only again" (`docs/codex-execution-log.md`) shows the failure mode: one route re-added `user_id IS NULL` and exposed orphan rows. The same log lists eight more routes with the same pattern that were *not* changed.

### 2.3 The dormant "team" concept

**FACT (repo).**

- `team_members (user_id PK, role owner|admin|collaborator, email, name)` and `invites (email, role admin|collaborator, token, expires_at, used_at)` exist from `001_init.sql`, with a `public.is_team_member()` SECURITY DEFINER function.
- Migration 010 removed team access from `contacts` (*"the inherited 'team only' policy still let anyone in team_members see every other user's CRM"*). Migration 097 dropped `"public and team access"` from `projects`.
- `/api/invite` (`src/app/api/invite/route.ts`) creates an invite and emails it. `/api/team` lists **all** `team_members` rows with no scope.
- `src/app/(auth)/invite/[token]/page.tsx` reads `invites` with the **anon browser client**. The only policy on `invites` is `"team only"` (`is_team_member()`), so a visitor who is not already a team member cannot read the row.
- On "accept", the page sends a magic link and marks the invite used. It **never writes `team_members`** and never creates a `creator_profiles` row.

**INFERENCE (high confidence; not exercised against production).** Invitations are **non-functional end to end**:

1. The invite page cannot read its own invite, so it shows "expired or invalid".
2. Even if it could, the invitee would land as a *buyer* and be redirected out of the dashboard by `src/proxy.ts`.

`team_members` is a global list with no organization column. **It cannot be reused as-is.**

**RECOMMENDATION.** Treat `team_members` / `invites` / `is_team_member()` as **DEPRECATE**. Label OS gets organization-scoped membership and invitations (see `06-permission-model.md`). Keep the old tables until then: dropping them is out of scope for Phase 1.

### 2.4 Storage authorization

**FACT (repo).**

- R2 object keys are **flat and not tenant-prefixed**: `tracks/<nanoid>.<ext>`, `covers/<nanoid>.<ext>`, `contracts/<filename>` (`src/lib/storage/upload.ts`).
- Masters, WAVs and stems live in `R2_PRIVATE_BUCKET_NAME` as opaque `r2://bucket/key` refs. Previews, covers and peaks live in the public bucket.
- `/api/audio` resolves private refs and gates on `requireProducer`. Its header says: *"a producer can still pass any `src`, so this is a gate on WHO calls rather than on WHICH object … If a second producer is ever added, this needs a per-object ownership check as well, or one producer can read another's masters."*
- Share media uses HMAC grants with a 4-hour TTL, and revocation is re-checked per request (`src/lib/share-media-token.ts`).

**INFERENCE.** Storage has **no per-object authorization**; it relies on there being exactly one privileged user. **This is the single highest-risk item for any multi-user model** (see `13-risk-register.md`, R-01).

### 2.5 Storefront ownership

**FACT (repo).** `/api/store` has no seller parameter. It infers the store owner with `resolveStoreOwner` (`src/lib/store/owner.ts`), choosing "the canonical creator_profile" by catalogue ownership, and falls back to the first track's `user_id`. `license_purchases.seller_user_id` keys sales to a user.

**INFERENCE.** The storefront is structurally single-tenant. A label org does not need a storefront in the MVP, so the storefront can be **ISOLATED** rather than migrated.

---

## 3. Subsystem map

The columns follow the prompt's audit table. "Risk" is the risk of *changing* the subsystem for Label OS.

| System | Current implementation (evidence) | Reusable? | Needs abstraction? | Needs replacement? | Risk |
|---|---|:-:|:-:|:-:|:-:|
| **Auth** | Supabase Auth, Google OAuth (producer) + magic-link OTP (buyers); `src/proxy.ts` refresh + dashboard redirect for non-producers | **Yes**: same sessions for org members | Classification: producer / buyer → + *org member* | No | **High**: every widening of "who is signed in and allowed" has produced a security fix (117/119/120, `/api/audio`) |
| **Users** | `auth.users` + `creator_profiles` (producer marker, storefront settings); no user profile table for non-producers | Partly | Need a neutral `user_profile`/member display record. `creator_profiles` is overloaded (storefront + producer marker) | No | Medium |
| **Permissions** | `user_id = auth.uid()` RLS on every owned table; `requireRowOwnership`, `requireProducer`, `requireUser`; api-gate allowlist; policy replay test | Patterns yes, model no | **Yes**: owner check → org membership + capability + scope | Ownership model is replaced for org data | **Critical** |
| **CRM** | `contacts` (+ `crm_status`, `buyer_pipeline_status`, `category`, tags 091, segments 090, activity 094, tasks 095), `beat_sends`, campaigns 017, Resend open/click tracking; pure helpers in `src/lib/contacts/*` (filters, kind, scoring, tone, tasks) | **Yes** | Contacts become org-scoped later. Credit *parties* are a separate concept (see §4) | No | Medium |
| **Artists** | **No artist entity.** An "artist" is a contact whose derived kind is `artist` (`src/lib/contacts/kind.ts#deriveContactKind`: has sends) or a share `recipient_kind='rapper'` | No | — | **New entity** | Low (additive) |
| **Music** | `tracks` (type beat/instrumental/song/remix; status finished/needs_work/archived; bpm/key/scale/features; lyrics 007; chords 078; instrumental 079; store fields; `audio_url`/`wav_url`/`preview_url`), `track_versions` (immutable audio lineage, 003), `stems` + `track_stem_files` (080), `arrangements` (014), `track_tags`, `rating_history`, peaks/bands sidecars | **Yes**: the upload → analysis → peaks → preview → player pipeline is the most expensive subsystem and must not be duplicated | `tracks` conflates *audio asset*, *beat product* and *song*. Label OS needs a Song above it | No | Medium |
| **Projects** | `projects` (status in_progress/final/archived, template + `checklist` jsonb 084, tags, folders, pins, `price_usd`, `store_featured`), `project_tracks` (role main/reference/stem_source/alternate, position) | **Yes** | Gains `org_id` + members | No | Medium |
| **BeatStore** | `/store/**`, `license_purchases`, `licenses`/`track_licenses`, promo codes, project bundles, Stripe embedded checkout + idempotent webhook, buyer accounts keyed on email | Yes, as-is | No (Phase 1–6) | No | **High if touched**. Hence **ISOLATE** |
| **Collaboration** | Token shares: `share_links` (track sets, `recipient_kind`, `sales_enabled`, password, expiry, `full_playback` 121) and `project_shares` (role viewer/commenter/editor, `allow_downloads`, `invited_email`, `revoked_at`); `project_comments` (track pin, `region_start/end` 013, threads, guest authors); 4 share variants; HMAC media grants | **Yes** for listening/feedback | Account-based membership must be added for *contributing*. The `editor` token role can only reorder tracks (`src/app/api/projects/share/[token]/tracks/route.ts`) | No | Medium |
| **Files** | R2 public + private buckets, multipart upload sessions (099) + processing jobs (100), covers, contracts (`contracts/` prefix, `licenses.contract_pdf_url` 057) | Yes (transport) | **Yes**: no file registry, no per-object ACL, no non-audio asset model (photos, videos, documents) | Per-object authorization must be *added* | **Critical** (see §2.4) |
| **Metadata** | Rich audio metadata on `tracks`; the filename parser (`src/lib/upload/title-metadata.ts`) reads BPM/key/**credits**; `track_collaborators` (115: name + role text, **not applied on prod**); no ISRC/ISWC/UPC, no IPI/PRO | Partly | Credits need people (parties), not free text | No | Low |
| **Search** | `/api/search`: `ilike` on title/name/email over tracks/projects/contacts, 5 each, owner-scoped; storefront facets are pure (`src/lib/store/filters.ts`); smart playlists (067) and contact segments (090) are saved rule filters; audio similarity (`src/lib/audio/similarity.ts`, `/api/tracks/[id]/similar`) | Patterns yes | Needs relational filters + FTS | No | Low |
| **Activity** | `/api/activity` *derives* a feed from `tracks`, `track_versions`, `project_comments`, `beat_sends`, `rating_history` (no event table); `notifications` (064; purchase/offer/fulfilment/share_comment; realtime 116 **not applied**); `contact_activity` (094) is a stored per-contact log | Patterns yes | An org-scoped, append-only event record is needed for "who did what" | No | Low |
| **Readiness** | `src/lib/library/triage.ts` (derived produce→sell stage, no stored status), `src/lib/store/readiness.ts` (hard blockers vs conversion issues), Store Editor "Needs attention" | **Yes, directly**: the template for Legal and Release readiness | — | No | Low |
| **Workflow** | Static project templates (Album/EP/Single/Beat tape) with checklist jsonb (`src/lib/projects/templates.ts`); no approvals, no assignees except `contact_tasks` | Checklist pattern yes | — | No generic engine exists; none is proposed | Low |

---

## 4. Duplication check: what Label OS must NOT re-create

| Tempting new entity | Existing equivalent | Decision |
|---|---|---|
| "Recording", "Audio file", "Demo", "Mix", "Master" | `tracks` row (+ `track_versions` for file history, `stems`/`track_stem_files`) | **Reuse `tracks`** as the recording/audio asset. Label OS adds a *Song* above it and a *kind* on the link (see `05-domain-model.md`) |
| "Label project" | `projects` + `project_tracks` | **Reuse `projects`**, add `org_id` and account members |
| "Review link", "Pitch link" | `share_links`, `project_shares` | **Reuse** for no-account listening/feedback |
| "Timestamped comment" | `project_comments.region_start/end` | Reuse the *model*. Org comments get their own table because `project_comments` is token/guest-shaped (see §3 Collaboration) |
| "Contact", "Person" | `contacts` | Reuse for relationships/CRM. Credit **parties** are new because they carry legal identifiers (IPI, PRO, publisher) that buyers and leads never have. A party optionally links to a contact |
| "Collaborator credit" | `track_collaborators` (115) | Seed data for credits; imported, not duplicated |
| "Task" | `contact_tasks` (095) | Generalize in Phase 3 (org `tasks` with typed subject FKs); `contact_tasks` becomes DEPRECATE |
| "Checklist" | `projects.checklist` | Kept for producers; release gates are derived, not checklists |
| "Status" for readiness | `triage.ts`, `readiness.ts` (derived) | Derive; never store readiness |

---

## 5. Repository conventions Label OS must follow

**FACT (repo)**, from `CLAUDE.md` and `.claude/skills/*`:

- Migrations are append-only and idempotent, end with `NOTIFY pgrst, 'reload schema';`, and are applied **before** merging dependent code. The next free number is **122**; check `git log --all -- supabase/migrations/` first.
- Every mutation is Zod-validated via `src/lib/contracts/`, and routes are owner-gated before the service role is used.
- Pure logic lives in `src/lib/` with Vitest tests. `CLAUDE.md` records that in-component logic "gets silently reverted".
- UI follows `docs/design-direction.md` ("Quiet Luxury": white/alpha state, `#090907` / `#0D0D0A` surfaces, 8/12/20 radii, hand-rolled primitives, `ActionMenu`, `InlineText`, `Popover`, `useDialogBehavior`).
- Source-guard tests (`tailwind-classes`, `reduced-motion`, `source-hygiene`, `rls-final-state`, `css-prefix-order`) are load-bearing.
- CI runs `tsc` → `vitest` → `next build` (`.github/workflows/ci.yml`).

---

## 6. Stale documentation found (OUT OF SCOPE, recorded only)

| Item | Observation |
|---|---|
| `.claude/skills/product-context.md`, `supabase-safety.md`, `repo-conventions.md` | State the migration ceiling is **092**. Disk has 121, and `CLAUDE.md` / `MIGRATIONS.md` say next = 122. Agents loading these skills get a wrong ceiling |
| `.claude/skills/product-context.md` | Says buyers have "no account". Opt-in buyer accounts exist (migration 060, `/store/account`) |
| `CLAUDE.md` API map | Says "Roughly 200 route files". Actual count is 171 |
| `src/app/(auth)/invite/[token]/page.tsx` | Dead flow (see §2.3). Uses `bg-white` with `text-white` on the Accept button in the invite email HTML (`src/app/api/invite/route.ts`): white-on-white |
| `scopedList` default `includeNullOwner = true` (`src/lib/db.ts`) | Still used by calendar and smart-playlists. The execution log lists 8 routes with the same NULL-owner pattern "not changed" |

---

## 7. Verification of this audit

| Check | Result |
|---|---|
| All repository paths cited in this discovery exist | Verified with a scripted `test -e` pass over every path cited (see `00-executive-summary.md` §Verification) |
| Current database assumptions | Confirmed from migrations + `supabase/MIGRATIONS.md`. **Production not inspected.** 112, 115 and 116 are recorded as not applied on prod |
| Authentication understood | Yes (§2.1) |
| Permissions understood | Yes (§2.2–2.3) |
| Storage understood | Yes (§2.4) |
| BeatStore understood | Yes, at the level needed to isolate it (§2.5; `CLAUDE.md` Storefront/Stripe sections) |
| Collaboration understood | Yes (§3 row "Collaboration") |
