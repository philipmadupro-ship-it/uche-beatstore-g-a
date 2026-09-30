# 05 — Domain Model

**Discovery 01 · 2026-09-30** · Diagram: `domain-model.mermaid`

**Design rule:** reuse before create. Every new entity below was checked against the existing schema (`01-current-system-audit.md` §4). The audio pipeline (`tracks`, `track_versions`, stems, peaks, previews) is **reused, not re-modelled**.

Tags: **EXISTING** (table exists today), **EXTEND** (existing table + new columns), **NEW** (new table).

---

## 1. The hierarchy, and where it deliberately differs from the prompt's sketch

The prompt proposed `Account → Organization → Workspace → Team → Project → Resource`. Recommended instead:

```text
User (auth.users)                       one identity, many orgs
  └─ Organization  (tenant, billing, members)        kind: producer | label | management
       ├─ Members  (base role + functions + scope)
       ├─ Artists  (roster; the main SCOPE unit)
       │    ├─ Songs ── Recordings (tracks) ── Versions (track_versions) / Stems
       │    ├─ Releases ── Release items (song + master recording)
       │    ├─ Projects (work containers; may span songs; can have external members)
       │    └─ Direction (references, notes)
       ├─ Parties  (rights holders: writers, publishers, owners) ── Credits / Split sheets
       ├─ Files    (non-audio assets: artwork, photos, video, documents, contracts)
       ├─ Tasks, Approvals, Comments
       └─ Activity events
```

Why each prompt level was dropped or changed:

- **"Workspace" is dropped as a separate level.** Slack and Notion equate workspace with organization. A second level between org and artist adds a scope to check on every query with no scenario that needs it. INFERENCE from the canonical scenario, where one label has one roster. The *artist workspace* is a UI concept over the artist scope, not a table.
- **"Team" is dropped as a scoping level.** In the canonical label, "A&R", "Marketing" and "Legal" are **functions** of members, not containers of resources. Notion exposes groups only on higher plans. Groups can be added later as a convenience for assigning scope; they are not needed for access in MVP.
- **Artist is the primary scope** because the most common restriction is "sees only these artists". Examples: the artist themselves, an artist manager, an A&R assigned to part of the roster.
- **Project is the secondary scope** because it is the unit external collaborators are admitted to (W4).

---

## 2. Entities

### 2.1 Organization and people

| Entity | Tag | Key fields | Notes |
|---|---|---|---|
| `organizations` | NEW | `id`, `name`, `slug` (unique), `kind` (`artist`\|`producer`\|`label`), `settings jsonb` (gate switches), `created_by`, `created_at`, `deleted_at` | The tenant. **D1 decided:** artists, producers and labels each get their own org kind, with kind-specific roles, functions and invite flows (`06` §2.4b). The existing producer gets a `producer` org (Phase 1 backfill) |
| `org_members` | NEW | `org_id`, `user_id`, `role` (`owner`\|`admin`\|`member`\|`artist`), `functions text[]`, `scope` (`org`\|`artists`), `invited_by`, `joined_at`; PK (`org_id`,`user_id`) | Exactly ≥1 owner per org (trigger) |
| `member_artist_scopes` | NEW | `org_id`, `user_id`, `artist_id`; PK all three | Used when `scope = 'artists'`, or when `role = 'artist'` |
| `org_invitations` | NEW | `id`, `org_id`, `email` (normalised), `role`, `functions`, `artist_ids uuid[]`, `project_id` (for external project invites), `project_role`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at`, `invited_by` | Replaces `invites` for Label OS. Token stored hashed |
| `user_profiles` | NEW | `user_id` PK, `display_name`, `avatar_url` | Neutral display identity for members. `creator_profiles` stays the *storefront* + producer marker and is not overloaded further |
| `org_connections` | NEW | `id`, `label_org_id`, `artist_org_id`, `status` (`requested`\|`active`\|`ended`), `share_mode` (`catalog`\|`selected_projects`), `requested_by`, `accepted_by`, `created_at`, `ended_at` | Artist org ↔ label org (LABEL-41). The artist decides what is shared |
| `connection_projects` | NEW | `connection_id`, `project_id` | Used when `share_mode = 'selected_projects'` |
| `team_members`, `invites` | EXISTING → DEPRECATE | — | Dormant (audit §2.3) |

### 2.2 Roster and direction

| Entity | Tag | Key fields | Notes |
|---|---|---|---|
| `artists` | NEW | `id`, `org_id`, `name`, `slug`, `status` (`prospect`\|`developing`\|`signed`\|`alumni`), `user_id` (the artist's own account, nullable), `artist_org_id` (the artist's own org when connected, nullable), `contact_id` (CRM link, nullable), `party_id` (rights identity, nullable), `image_file_id`, `bio`, `links jsonb` (DSP/analytics URLs), `created_at`, `archived_at` | An artist org has exactly one `artists` row (itself). A label roster row may point at a connected artist org. An artist on two labels = two roster rows in two label orgs, each pointing at the same artist org |
| `artist_references` | NEW | `id`, `org_id`, `artist_id`, `kind` (`track`\|`artist`\|`visual`\|`link`\|`note`), `title`, `url`, `file_id`, `track_id`, `note`, `visibility` (`internal`\|`artist`), `created_by`, `created_at` | Creative direction memory. `internal` hides A&R notes from the artist |
| `artists.direction` | NEW column | `jsonb`: `{ genres[], moods[], sounds_like[], avoid[], current_focus, updated_by, updated_at }` | Structured summary fields. Kept as one small document, not a table per field |

### 2.3 Music

| Entity | Tag | Key fields | Notes |
|---|---|---|---|
| `songs` | NEW | `id`, `org_id`, `artist_id`, `project_id` (nullable), `title`, `working_title`, `stage` (see W3), `stage_changed_at`, `iswc`, `explicit`, `language`, `genre`, `samples_declared` (`none`\|`yes`\|`unknown`), `notes`, `created_by`, `updated_at`, `archived_at` | The **creative identity** labels talk about ("Track 04"). Close to a musical work: composition credits and composition splits attach here |
| `song_recordings` | NEW | `song_id`, `track_id`, `kind` (`beat_source`\|`demo`\|`rough`\|`topline`\|`loop`\|`mix`\|`master`\|`instrumental`\|`acapella`\|`clean`\|`reference`), `is_current` (one current per kind), `label` ("mix v3"), `added_by`, `added_at`; PK (`song_id`,`track_id`) | Same shape as the existing `project_tracks.role`. A `tracks` row **is** the recording. Its own `track_versions` are file-level revisions of that recording |
| `tracks` | EXISTING → EXTEND | + `org_id` (nullable; expand/contract), + `isrc`, + `created_by` | ISRC belongs to the recording (master). `user_id` keeps meaning "uploader/owner" for producer-era rows |
| `track_versions` | EXISTING | — | File history of one recording. Unchanged |
| `stems`, `track_stem_files` | EXISTING | — | Unchanged; they hang off the recording |
| `projects` | EXISTING → EXTEND | + `org_id`, + `artist_id` (nullable) | A project can be artist-bound ("EP 2027") or cross-artist ("Producer collaboration") |
| `project_tracks` | EXISTING | — | Kept for producer projects |
| `project_songs` | NEW | `project_id`, `song_id`, `position` | Label projects group **songs**. A song belongs to at most one *primary* project via `songs.project_id`; this junction allows a song to appear in more than one |
| `project_members` | NEW | `project_id`, `user_id`, `role` (`viewer`\|`commenter`\|`contributor`\|`editor`), `invited_by`, `expires_at`, `revoked_at`, `joined_at` | Account-based external access (W4). Token shares (`project_shares`) stay for no-account listening |
| `releases` | NEW | `id`, `org_id`, `artist_id`, `project_id` (nullable), `title`, `type` (`single`\|`ep`\|`album`\|`mixtape`\|`compilation`), `upc`, `label_name`, `c_line`, `p_line`, `primary_genre`, `target_date`, `release_date`, `artwork_file_id`, `state` (`draft`\|`delivered`\|`cancelled`), `delivered_at`, `delivered_to`, `imported_released boolean` (an existing release entered as already out, skipping gates), `store_listed boolean`, `store_listed_at`, `created_by`, `updated_at` | **Only terminal/manual facts are stored** (`state`, `delivered_at`, `store_listed`). Gate status and `released` are derived (09). **Released vs unreleased is a first-class distinction:** only a released release can be listed on a storefront (LABEL-42) |
| `release_items` | NEW | `release_id`, `position`, `song_id`, `track_id` (the master recording), `version_title`, `explicit`; PK (`release_id`,`position`) | ISRC is read from `tracks.isrc` of the chosen master |
| `playlists` | EXISTING | — | Unchanged (producer outreach/storefront) |

### 2.4 Rights

| Entity | Tag | Key fields | Notes |
|---|---|---|---|
| `parties` | NEW | `id`, `org_id`, `kind` (`person`\|`company`), `display_name`, `legal_name`, `email`, `ipi`, `isni`, `pro`, `pro_affiliation` (`affiliated`\|`not_affiliated`\|`unknown`), `publisher_name`, `publisher_ipi`, `contact_id`, `user_id`, `created_at` | Rights identity. **Not** `contacts`: buyers and leads never have IPI or PRO, and legal identifiers must not sit in a CRM table that 500+ buyers flow into |
| `credits` | NEW | `id`, `org_id`, `song_id` XOR `track_id`, `party_id`, `role` (RIN-aligned vocabulary, text), `role_detail` (instrument, etc.), `source` (`manual`\|`filename`\|`self`\|`import`), `status` (`proposed`\|`confirmed`\|`disputed`), `created_by`, `confirmed_by`, `updated_at` | Composition credits on songs; performance/production/engineering credits on recordings. Seeded from `track_collaborators` (115) |
| `split_sheets` | NEW | `id`, `org_id`, `song_id`, `kind` (`composition`\|`master`), `version`, `status` (`draft`\|`circulated`\|`signed`\|`superseded`\|`disputed`), `document_file_id`, `created_by`, `circulated_at`, `signed_at` | Versioned; `circulated`/`signed` rows are immutable |
| `split_lines` | NEW | `split_sheet_id`, `party_id`, `role` (`writer`\|`composer`\|`writer_composer`\|`publisher`\|`master_owner`), `share numeric(7,4)`, `signed_at`, `signature_file_id`, `signature_method` (`upload`\|`acknowledged`) | Sum = 100.0000, validated in the route and by a DEFERRABLE constraint trigger on transition to `circulated` |
| `track_collaborators` | EXISTING (115, **not applied on prod**) | — | Import source for `credits`. Decision **D7** |
| `licenses`, `track_licenses`, `license_purchases` | EXISTING | — | Beat-lease commerce. **ISOLATE**; not rights management |

### 2.5 Work, files, activity

| Entity | Tag | Key fields | Notes |
|---|---|---|---|
| `files` | NEW | `id`, `org_id`, `bucket`, `object_key` (org-prefixed), `filename`, `mime`, `bytes`, `sha256`, `category` (`artwork`\|`photo`\|`video`\|`document`\|`contract`\|`split_sheet`\|`session`\|`other`), `sensitivity` (`normal`\|`restricted`), `artist_id`, `project_id`, `song_id`, `release_id` (nullable, ≤1 subject), `version_of` (self-FK), `uploaded_by`, `created_at`, `deleted_at` | Non-audio assets. **Audio stays in `tracks`** so the pipeline is not duplicated. `restricted` files require `contracts.read` |
| `approvals` | NEW | `id`, `org_id`, `release_id` XOR `song_id`, `gate` (`master`\|`artwork`\|`legal`\|`marketing`\|`metadata`), `decision` (`requested`\|`approved`\|`changes_requested`), `note`, `actor_id`, `subject_snapshot jsonb`, `created_at` | **Append-only.** The latest row per (subject, gate) is current. `subject_snapshot` records *what* was approved (e.g. the artwork `file_id`), so replacing the artwork invalidates the approval (derived) |
| `tasks` | NEW | `id`, `org_id`, `title`, `assignee_id`, `due_at`, `done_at`, `artist_id`\|`project_id`\|`song_id`\|`release_id` (≤1, nullable), `created_by`, `created_at` | Typed nullable FKs, **not** polymorphic `(subject_type, subject_id)`. They keep referential integrity, and RLS can join them. `contact_tasks` → DEPRECATE later |
| `comments` | NEW | `id`, `org_id`, `song_id`\|`release_id`\|`project_id`, `track_id` (recording, optional), `region_start`, `region_end`, `parent_id`, `body`, `visibility` (`internal`\|`artist`), `author_id`, `resolved_at`, `edited_at`, `deleted_at`, `created_at` | Same region model as `project_comments` (013). `project_comments` stays for token shares; migrated or unified in Phase 3+ |
| `song_reviews` | NEW | `song_id`, `reviewer_id`, `rating` (1–5), `verdict` (`shortlist`\|`hold`\|`pass`\|`changes_requested`), `note`, `updated_at`; PK (`song_id`,`reviewer_id`) | Per-reviewer, so two A&Rs don't overwrite each other |
| `activity_events` | NEW | `id`, `org_id`, `actor_id`, `verb`, `artist_id`, `project_id`, `song_id`, `release_id` (context keys, nullable), `subject_type`, `subject_id`, `payload jsonb`, `audit boolean`, `visibility` (`internal`\|`artist`), `created_at` | Append-only; no UPDATE/DELETE policy. See 08 |
| `notifications` | EXISTING → EXTEND | + `org_id` (nullable) | Direct asks only (approval requested of you, task assigned, mention) |
| `contacts` + CRM tables | EXISTING | — | Producer CRM; org scoping deferred (Phase 3+). Parties and artists *link* to contacts |

---

## 3. Classification: entity, state, file or relationship?

| Concept | Is a… | Where |
|---|---|---|
| Song | **Entity** | `songs` |
| Demo, Rough, Topline, Loop, Mix, Master, Instrumental | **Relationship kind** (song ↔ recording) | `song_recordings.kind` |
| Working vs finished material | **Derived class** of a recording kind (`06` §2.3). Gates `audio.working` / `audio.finished` | `lib/labelos/capabilities.ts` |
| Recording | **Entity** (the existing audio row) | `tracks` |
| Version (of a recording) | **Entity** (file revision) | `track_versions` |
| Beat | **Entity** (a `tracks` row with `type = 'beat'`) plus, when used for a song, **relationship kind** `beat_source` | `tracks`, `song_recordings` |
| Stem | **Entity + file** | `stems`, `track_stem_files` |
| Session (DAW session files) | **File** | `files.category = 'session'` |
| Project | **Entity** | `projects` |
| Release | **Entity** | `releases` |
| Catalog item | **Derived state** (released + post-window) | not stored |
| Released | **Derived state** (delivered + date passed, or imported as released) | not stored |
| Listed on store | **Stored flag** on a released release | `releases.store_listed` |
| Song stage (A&R) | **Stored state** (a human decision) | `songs.stage` |
| Release gate status | **Derived state** | `lib/labelos/release-readiness.ts` |
| Legal readiness | **Derived state** | `lib/labelos/legal-readiness.ts` |
| Released | **Derived state** | from `releases.state = delivered` + date |
| Approval | **Entity** (append-only fact) | `approvals` |
| Credit | **Entity** | `credits` |
| Split | **Entity** (sheet) + **entity** (line) | `split_sheets`, `split_lines` |
| Artwork, photo, video, contract | **File** | `files` |

---

## 4. Capability matrix

| Object | Versioned | Shareable | Approvable | Archivable |
|---|:-:|:-:|:-:|:-:|
| Recording (`tracks`) | Yes (`track_versions`) | Yes (token + members) | Yes (`master` gate, via release) | Yes (existing `status = archived`) |
| Song | Via its recordings | Via project/artist scope | No (reviewed, not approved) | Yes (`archived_at`) |
| Project | No | Yes | No | Yes (existing status) |
| Release | No (state changes are audited) | Internal only in MVP | **Yes** (gates) | `cancelled` |
| Split sheet | **Yes** (immutable versions) | Export only | Signatures | Superseded |
| Credit | Audited, not versioned | With the song | Confirmed / disputed | No (delete = event) |
| File | Yes (`version_of`) | Via subject scope | Artwork via the gate | Soft delete |
| Artist | No | No | No | `archived_at` |

---

## 5. Relationships (cardinalities)

- An Organization has many Members, Artists, Songs, Releases, Projects, Parties, Files and Events.
- An Artist has many Songs, Releases and Projects, and many members are scoped to it.
- A Song belongs to one Artist, at most one primary Project, and many Recordings through `song_recordings`. It has many Credits (composition), many Split sheets (versioned) and many Reviews.
- A Recording (`tracks`) belongs to 0..n Songs. It usually belongs to 1; a beat can source several. It has many Versions, Stems and Credits (performance/engineering), and one ISRC.
- A Release belongs to one Artist, has many Items, and each Item references one Song and one master Recording. A Release has many Approvals and many Files.
- A Party has many Credits and Split lines, and optionally links to one Contact and one User.
- A Project has many Songs (`project_songs`), legacy Tracks (`project_tracks`), Members (`project_members`) and token Shares (`project_shares`).

---

## 6. Integrity rules (enforced in the DB where cheap, otherwise in pure `lib/` validators with tests)

1. Every NEW row carries `org_id`. RLS keys on it. Child rows also check that the parent's `org_id` matches (trigger), so a song cannot point at another org's artist.
2. `song_recordings.track_id` must be in the same org as the song. **The exception** is `beat_source` across orgs, which is **not allowed** in MVP. Cross-org use goes through copy-on-accept (decision D6).
3. At most one `is_current` recording per (song, kind): partial unique index.
4. `split_lines` sum = 100.0000 when a sheet leaves `draft`, and a sheet is immutable once `circulated`: trigger.
5. `release_items.track_id` must be a recording linked to that song with `kind` in (`master`, `clean`, `instrumental`).
6. `approvals`, `activity_events`: INSERT only; no UPDATE/DELETE grants to `authenticated`.
7. Identifier format checks: ISRC `^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$`, UPC/EAN 12–13 digits, ISWC `^T-?[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]$`, IPI 9–11 digits. Pure validators live in `lib/labelos/identifiers.ts`.
