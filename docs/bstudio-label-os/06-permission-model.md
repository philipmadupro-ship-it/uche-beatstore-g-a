# 06 — Permission Model

**Discovery 01 · 2026-09-30** · Diagram: `permission-model.mermaid`

> **Superseded in part (2026-10-01):** `main` gained the Artist Workspace (#44) after this was written. Where this file conflicts with `17-reconciliation-with-artist-workspace.md`, **17 wins**: songs are `tracks` rows, artists are org contacts in workspace mode, files are `project_assets`, comments are `project_comments`, credits are `track_collaborators`.


## 1. Recommendation in one line

**Role + capability, with two resource scopes (artist, project).** No per-object ACLs in the MVP; sensitivity is by file category.

| Option considered | Verdict | Reason |
|---|---|---|
| Pure RBAC (fixed roles) | Rejected alone | "A&R", "Legal" and "Marketing" need different data on the *same* objects: legal sees splits, marketing does not. Pure RBAC would multiply roles |
| Resource-level ACL on every object | Rejected | Every query becomes an ACL join; the UX becomes "share settings" dialogs everywhere; unpredictable for owners. Frame.io and Notion both avoid per-object ACLs as the default |
| Team permissions | Deferred | No MVP scenario needs team containers (05 §1) |
| Project permissions | **Adopted (for external members)** | The unit external collaborators are admitted to: Teams shared-channel / Slack Connect model |
| Asset permissions | **Adopted narrowly** | `files.sensitivity = restricted` (contracts, split sheet PDFs) requires `contracts.read`. No per-file sharing lists |
| **Role + capability** | **Adopted** | Base role sets breadth, functions add capabilities, scope limits reach. Capabilities are code-defined, so the model is testable and cannot be misconfigured per org |

**Roles are not hardcoded into the product logic.** Routes and RLS check **capabilities**, never role names. The role → capability mapping is a single pure module (`lib/labelos/capabilities.ts`), mirrored in SQL and held equal by a test (the pattern of `video-embed` origins ↔ CSP in `CLAUDE.md`).

---

## 2. The three axes

```text
access(user, object, action) =
    member(user, object.org)                               -- 1. membership
  ∧ capability(orgKind, role, functions) ∋ action's capability -- 2. capability
  ∧ inScope(user, object.artist_id, object.project_id)     -- 3. scope
```

### 2.1 Base roles (org-level breadth)

| Role | Meaning |
|---|---|
| `owner` | Everything, including deleting the org, billing and ownership transfer. At least one per org |
| `admin` | Everything except org deletion / ownership transfer |
| `member` | Staff. Capabilities come from functions |
| `artist` | An artist user. Always scoped to their own artist record(s) |
| *(external project member)* | Not an org member. Lives in `project_members`. Access = that project only |
| *(token guest)* | Not a user. Existing `share_links` / `project_shares` |

### 2.2 Functions (additive capability bundles for `member`)

`a_and_r`, `project_manager`, `marketing`, `legal`, `finance`, `artist_manager`, `producer`, `engineer`, `operations`.

A member can hold several functions (a small label's owner-assistant may be PM + marketing).

### 2.3 Capabilities (MVP set)

**Decided 2026-09-30 (D4):** roles are fixed and code-defined; no per-org editing. A label has **two sides**:

- The **creative side** (A&R, producers, engineers, artist managers) needs *all* the music, including working material, and all collaborators. It stays out of the legal area.
- The **business side** (marketing, legal, finance) needs projects and finished music, not working material.

That split is expressed by separating finished audio from working audio.

| Capability | Grants |
|---|---|
| `catalog.read` | See artists, songs, projects, releases in scope, with titles, stages, artwork and metadata |
| `catalog.write` | Create/edit songs, upload recordings, edit metadata/tags, move stages |
| `audio.finished` | Stream/download **finished** material: `master`, `clean`, `instrumental`, `acapella` recordings, the current `mix` of a song that is `selected` or on a release, and release artwork/assets |
| `audio.working` | Stream/download **working** material: `beat_source`, `demo`, `rough`, `topline`, `loop`, earlier `mix` versions, stems, session files |
| `review.write` | Rate, verdict, comment on songs |
| `rights.read` | See credits (who worked on what), parties, split sheets (percentages) |
| `rights.write` | Edit parties/credits; confirm credits; create/circulate split sheets |
| `contracts.read` | Open `restricted` files (contracts, signed split sheets) |
| `release.write` | Create/edit releases, tracklist, metadata; mark delivered; publish a released release to the store (LABEL-42) |
| `release.approve.<gate>` | Decide `master`, `artwork`, `legal`, `marketing`, `metadata` gates |
| `tasks.write` | Create/assign tasks |
| `share.external` | Create token shares / invite external project members |
| `members.manage` | Invite/remove members, change roles/scopes |
| `org.manage` | Org settings, gate switches, org connections (LABEL-41) |
| `finance.read` | Reserved, no MVP data |
| `business.read.internal` | See business-side notes (legal/finance/marketing-internal comments and files). **Artists never have it**; A&R reviews and comments are **not** business-internal (D5) |

### 2.4 Default mapping (label org)

**R** = read, **W** = write.

| | owner | admin | a_and_r | project_manager | marketing | legal | artist_manager | producer / engineer | artist |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| catalog | R W | R W | R W | R W | R | R | R W | R W | R W (own) |
| audio.finished | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (own) |
| audio.working (toplines, loops, demos, stems) | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | ✓ (own) |
| review.write | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | — | comment only |
| rights | R W | R W | R (all collaborators) | R | — | R W | R | R (own line) | R (own songs) |
| contracts.read | ✓ | ✓ | — | — | — | ✓ | — | — | — |
| release.write | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| approve master | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| approve artwork | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| approve legal | ✓ | ✓ | — | — | — | ✓ | — | — | — |
| approve marketing | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| approve metadata | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| share.external | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| members.manage | ✓ | ✓ | — | — | — | — | — | — | — |
| business.read.internal | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — | — |

**D4 decided:** no per-org customisation of this table in the MVP. **Amended 2026-09-30 (`15`, "LABEL-02 follow-up"):** the columns are *presets*; an owner or admin can switch single abilities on or off for one member (never for owner/admin, and never business-internal notes or contracts for a roster artist). Every function column also has `tasks.write`; `finance` and `operations` start empty.

**D5 decided:** an artist sees **everything about their own songs** — stage, every reviewer's rating and verdict, and A&R comments. They still never see other artists, contracts, business-internal notes, or other people's split lines beyond their own songs.

### 2.4b Org kinds (D1 decided: artists get their own ecosystem)

There are three org kinds. The **kind decides which roles and functions exist and how people are added**. It also decides which capabilities the owner's org has at all.

| | `artist` org | `producer` org | `label` org |
|---|---|---|---|
| Owner | The artist | The producer | The label owner |
| Roles offered | owner, admin, member | owner, admin, member | owner, admin, member, artist |
| Functions offered | `artist_manager`, `producer`, `engineer`, `marketing`, `legal`, `operations` | `producer`, `engineer`, `artist_manager`, `operations` | all functions (§2.2) |
| Ways to add people | Invite team (manager, engineer, producer); **connect to a label** (LABEL-41); external project members | Invite collaborators (co-producer, engineer, manager); external project members | Invite staff; add **artists to the roster** (as an `artist`-role member, or by connecting their artist org); external project members |
| Roster (`artists`) | Exactly one artist record: the owner themselves, created with the org | None required | Many |
| A&R inbox / release board | Own songs; own releases | Beat pipeline (existing library); releases optional | Full |
| Storefront | Later (via LABEL-42 once store is multi-org) | **Yes — the existing beatstore** | Later |

A capability is granted only if **both** the member's role/functions **and** the org kind allow it. This is still one code-defined table (`capabilitiesFor(orgKind, role, functions)`), so no per-org editing is involved.

**Label ↔ artist connection (LABEL-41).** An artist org can connect to one or more label orgs.

- The connection is requested by one side and accepted by the other.
- The artist chooses what the label sees: the whole catalogue or selected projects.
- The label's roster row points at the artist org (`artists.artist_org_id`).
- Music the artist makes stays in the artist org. Label-created projects and releases live in the label org.
- Either side can end the connection. Copies already made under D6 stay where they are, with provenance.

**Assumed (D1a), change if wrong:** before signing, demos stay in the artist's own org and the label sees them only through the connection.

### 2.5 Scope

- `org_members.scope = 'org'`: every artist in the org.
- `org_members.scope = 'artists'`: only artists listed in `member_artist_scopes`. `role = 'artist'` is **always** artist-scoped.
- Objects without an `artist_id` (org-level parties, org files) are visible to `scope = 'org'` members only, except parties referenced by in-scope credits, which are visible through the credit.
- **External project members** see the project, its songs and recordings, and nothing else. They see the project's artist *name* but not the artist workspace.
- **Connected label members** see only what the artist org shared through the connection, filtered again by their own capabilities (marketing still does not get working audio).

### 2.6 External project member roles (account-based)

| Role | Listen | Comment | Upload versions | Edit metadata/tags/notes | Propose own credit | Download masters |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `viewer` | ✓ | — | — | — | — | per project `allow_downloads` |
| `commenter` | ✓ | ✓ | — | — | — | per project |
| `contributor` | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| `editor` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

External members **never** get `rights.write`, `contracts.read`, `release.*` or `members.manage`. **D2 decided:** they see **only their own** credit and split line, so they can confirm it, and never others' percentages. **D3 decided:** when they leave, their uploads stay in the project, credited to them.

---

## 3. Enforcement: two layers, one definition

### 3.1 Database (RLS), for defence in depth and any non-service reads

`SECURITY DEFINER STABLE` helpers owned by `postgres`. The pattern follows `public.is_producer()` in migration 119, and Supabase multi-tenant guidance to use security-definer membership functions with indexed membership tables and avoid per-row subqueries ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security), [MakerKit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)):

```sql
-- sketch, not a migration
public.org_role(org uuid)                 returns text     -- null if not a member
public.has_org_cap(org uuid, cap text)    returns boolean  -- role+functions → capability (mirrors lib/labelos/capabilities.ts)
public.can_see_artist(org uuid, artist uuid) returns boolean -- scope check
public.can_see_project(project uuid)      returns boolean  -- org member in scope OR active project_members row
```

Policies wrap calls as `(select public.has_org_cap(org_id, 'catalog.read'))` so Postgres evaluates them once per statement where possible. Membership tables get indexes on `(user_id, org_id)`.

### 3.2 Application (service-role routes), where the real boundary is today

**FACT (repo):** 147 route files use the service role, which bypasses RLS (01 §2.2). New helpers go in `src/lib/auth/org-access.ts`:

```ts
// sketch
requireOrgCapability(orgId, cap)                          → { ok, userId, admin, member } | { ok:false, res }
requireObjectAccess({ table, id, cap })                   → loads org_id / artist_id / project_id, checks all three axes
scopedOrgQuery(admin, table, ctx)                         → pre-applies org_id + artist scope filters
```

**Rule:** a Label OS route never writes `.eq('user_id', …)`. A source-guard test fails if `src/app/api/org/**` contains a `user_id` equality filter. This mirrors the repo's existing guard-test culture and catches the class of bug seen in STORE-02.

### 3.3 The proxy / API gate

**FACT (repo):** `src/proxy.ts` 403s signed-in non-producers on every non-allowlisted `/api/*` path (`src/lib/security/api-gate.ts`).

**RECOMMENDATION:**

- Label OS APIs live under **`/api/org/*`**. The gate admits a signed-in user to `/api/org/*` only if they have **at least one** `org_members` or `project_members` row. It is still a coarse gate; routes do the capability check.
- Every existing producer route **keeps** `requiresProducerForApi`. An org member who is not the producer must **not** reach `/api/tracks`, `/api/audio`, `/api/contacts` and similar. This is the key isolation property of Phase 1.
- **Buyers remain buyers.** A buyer account that accepts an org invitation becomes a member of that org and still has no producer access.

---

## 4. Storage permissions

| Asset | Where | How access is decided |
|---|---|---|
| Recording audio (masters/WAV/stems) | Private bucket, `r2://` refs on `tracks` | **Per-object:** the route resolves the owning `tracks` row → org/artist/project → `audio.finished` or `audio.working` by recording kind. `/api/audio`'s own comment says this check is required before a second privileged user exists (**P0 prerequisite**, backlog LABEL-13) |
| Preview audio / peaks | Public bucket (existing) | Unchanged for store previews. **D8 decided: private until released.** Unreleased org recordings get previews in the private bucket, served via HMAC grants (the existing `share-media-token` pattern). When a release is released, its items' previews may be promoted to public (e.g. for the store, LABEL-42) |
| Files (artwork, docs, contracts) | Private bucket, keys `orgs/<org_id>/<category>/<uuid>` | Short-lived presigned GET (≤5 min) issued after `requireObjectAccess`; `restricted` requires `contracts.read`; every restricted download → `activity_events` (audit) |
| Legacy flat keys (`tracks/…`, `covers/…`) | Unchanged | Keys are *not* the authorization; the DB row is. The org prefix is defence in depth plus lifecycle/export by prefix |

---

## 5. Secure links and guest access

| Mechanism | Use | Can contribute? | Revocation |
|---|---|:-:|---|
| **Token share** (existing `share_links`, `project_shares`) | Listen/comment without an account: pitching, friends | **No** | `revoked_at`, `expires_at`, password; checked on every media request (existing) |
| **Invitation link** (`org_invitations` / project invite) | Become a member or external project member | Yes, after sign-in | `revoked_at` before acceptance; membership removal after |
| **Membership** | Ongoing access | Per role | Remove the row; takes effect on the next request (no JWT-cached roles) |

**Why tokens can't contribute:** a token is a bearer secret that can be forwarded. An upload or metadata edit must be attributable to a person and revocable *per person*. The existing `project_shares.role = 'editor'` (reorder tracks by token) is grandfathered and **must not be extended**.

**Invitation hardening:**

- 32 bytes of randomness, stored **hashed** (sha-256).
- Single use; 7-day default expiry.
- Acceptance requires the session email to equal the invited email (normalised with `normalizeEmail`).
- Rate-limited through the existing `rate_limits` table (074).

---

## 6. Audit

Audit-class events (`activity_events.audit = true`) are **never deleted** and have no UPDATE/DELETE grant. They cover:

- Membership and role changes; scope changes; invitations created, accepted or revoked.
- External member added/removed; token share created or revoked.
- Restricted file downloads; master downloads by external members.
- Split sheet transitions; credit confirmations/disputes.
- Approvals.
- Release delivered.

---

## 7. Highest-risk attack surfaces

Full register in `13-risk-register.md`.

1. **Service-role routes** that forget org or scope filters: cross-org data leak. Mitigation: `/api/org/*` namespace, the helpers above, the source-guard test and per-route tests with two orgs.
2. **`/api/audio` without a per-object check** once a second privileged user exists: any member streams any master. Mitigation: LABEL-13 lands **before** any non-producer can stream.
3. **Proxy gate widening:** admitting members to producer routes by accident. Mitigation: separate namespace; a gate unit test asserting a member-only user is 403 on every existing producer route prefix.
4. **Public-bucket previews of unreleased label music:** anyone with the URL can listen. Mitigation: D8, private previews.
5. **Invitation takeover:** email binding, hashed tokens, expiry, rate limits.
6. **RLS helper recursion/performance:** security-definer helpers, indexes, and a policy-replay test (`rls-final-state.test.ts`) extended to Label OS tables.
7. **Buyer ↔ member confusion:** a buyer account is not a member unless a membership row exists; tests cover a buyer probing `/api/org/*`.
