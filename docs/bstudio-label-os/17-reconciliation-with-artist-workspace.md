# 17 — Reconciliation with the Artist Workspace (main #44, #46, #48)

**Date:** 2026-10-01. **Status:** binding. **Where this file conflicts with 04–14, this file wins.** `14-engineering-backlog.md` has been rewritten to match it.

## Why this exists

After Discovery 01 was written, `main` gained the **Artist Relationship Workspace + portal** in #44, with migrations 122–135. It covers several things Label OS had planned as new tables:

- artists;
- songs and the material linked to them;
- project files;
- artist-facing access;
- artist messages;
- per-artist decisions on beats.

The brief forbids duplicating existing entities. Label OS therefore **builds on #44's model** and adds only what #44 does not have:

- organizations, members and permissions;
- releases and release gates;
- rights (parties, split sheets) and legal readiness;
- approvals, tasks and the org activity record;
- A&R reviews.

Source of truth for #44:

- `CLAUDE.md` → "Artist workspace + portal";
- `docs/codex-execution-log.md` 2026-09-29/30 entries;
- `supabase/migrations/122…135`.

## What `main` now has (facts, from the merged code)

| Area | `main` (#44) | Key files |
|---|---|---|
| Artist | **A contact in workspace mode** (linked to ≥1 project via `project_contacts`, or holding an `artist_portals` row). Explicit rule: "not a new table". Roles per contact: Artists / Producers / Labels & A&R (`category` + `secondary_category`) | `lib/contacts/relationship.ts`, `lib/contacts/roles.ts`, `components/artists/` |
| Song | **A `tracks` row with `type = 'song'`**, with versions, stems, credits and player. Built on beats via `song_beats` (main beat = `tracks.beat_track_id`) | mig 124, 132, `lib/tracks/song-beats*.ts` |
| Linked material | `track_links(from, to, relation ∈ instrumental, loop, topline, version)`; track types gain `loop`, `topline`; `mergeLinks` is the one read model | mig 133, `lib/tracks/links.ts` |
| Files | `project_assets`: private bucket, extension allowlist, presign + register, `kind ∈ reference, artwork, lyrics, document, audio, other` | mig 127, `lib/projects/assets.ts`, `lib/storage/project-assets.ts` |
| Artist-facing access | **Artist portal**: a share-token kind, gated by `gatePortal`, optional email sign-in (an HMAC cookie, not a Supabase account), `/api/portal/*` allowlisted in `api-gate.ts` | mig 125, 131, `lib/artist-portal/` |
| Comments | Portal comments are `project_comments` rows with `contact_id` (region pins kept) | mig 128 |
| Messages | `artist_messages`: one producer↔artist thread with requests (open → done / declined) | mig 130, `lib/artist-messages/` |
| Artist decisions | `contact_track_states.decision` (interested · selected · recording · recorded · released · passed) per artist × beat; engagement is derived | mig 123, `lib/contacts/decisions.ts` |
| Credits | `track_collaborators.contact_id` links a credit to a contact; `groupCredits` | mig 124, `lib/tracks/collaborators.ts` |

Every #44 table is **owner-only** (`user_id = auth.uid()` + `is_producer()`), with same-owner triggers. None of it knows about organizations.

## Reconciliation decisions

### R1 — A song is a `tracks` row (`type = 'song'`). No `songs`, `song_recordings` or `project_songs` tables
- **Label OS song fields go on `tracks`:**
  - `song_stage` (the A&R stage from `04` W3; meaningful when `type = 'song'`);
  - `iswc`;
  - `isrc` (on whichever track is the master recording);
  - `org_id` and `created_by` (already planned, LABEL-12).
- **A song's recordings are found through `mergeLinks`:**
  - the song track itself, plus its `track_versions`;
  - beats via `song_beats`;
  - instrumental / loop / topline / version via `track_links`.
- **Two new `track_links` relations: `master` and `demo`.** This is an additive widening of the CHECK constraint. A master is usually a separate mastered file, and a demo is the early idea. Gates and permissions need both to be explicit.
- **Mapping to LABEL-02's recording kinds** (the `src/lib/labelos/capabilities.ts` code is unchanged; a pure adapter `recordingKindOf(track, relation)` feeds `recordingClass`):

| `main` material | Label OS recording kind | Class |
|---|---|---|
| song track's current audio | `mix` (finished only when the song is `selected` or on a release) | per rule |
| older `track_versions` / `version` link | `mix` (non-current) | working |
| `song_beats` beat | `beat_source` | working |
| `loop` / `topline` link | `loop` / `topline` | working |
| `instrumental` link | `instrumental` | finished |
| `master` link (new) | `master` | finished |
| `demo` link (new) | `demo` | working |
| track type `beat` not linked to a song | `beat_source` | working |

- **Every org song lives in at least one project.** Demos an artist sends land in that artist's inbox project, created on first upload. Scope, comments and files then all work through projects, the way #44 already works.

### R2 — Files are `project_assets`. No `files` table
- **Extend `project_assets`:**
  - `org_id`;
  - `sensitivity` (`normal` | `restricted`);
  - widen `kind` with `photo`, `video`, `contract`, `split_sheet`, `session`.
- **Every release has a project** (`releases.project_id NOT NULL`, created with the release if needed), so release artwork and documents are that project's assets. `releases.artwork_asset_id` points at a `project_assets` row.
- `restricted` assets still require `contracts.read`, and their downloads are audited (`06` §4).

### R3 — The artist roster is org-scoped contacts in workspace mode. No `artists` table
- This keeps `main`'s rule ("an artist is a contact in workspace mode") true in Label OS.
- **`contacts.org_id`** (nullable, expand/contract like `tracks`, LABEL-12): a label org's contacts are its people directory, and its artists are the contacts in workspace mode.
- **Other tables move to `contact_id`:**
  - `member_artist_scopes(org_id, user_id, contact_id)`;
  - `can_see_artist(org, contact)`;
  - every former `artist_id` column in `05` becomes `contact_id`.
- **Artist org (D1):** its single roster row is a contact for the owner themselves, created with the org.
- **Label ↔ artist connection (D1, LABEL-41):** `contacts.artist_org_id`. A label's roster contact points at the connected artist org.
- **Creative direction (LABEL-26)** is keyed by `contact_id`.

### R4 — Two ways in for people outside the org, by purpose
| Path | Who | Can | Identity |
|---|---|---|---|
| **Artist portal** (`main`) | Artists, producers and labels as *recipients* | Listen, download (if allowed), react Interested / Pass, comment, message, request | Token, plus an optional email-cookie sign-in |
| **Project member** (Label OS, LABEL-21) | *Contributors* (Producer X, engineers, writers) | Upload versions, edit metadata, propose own credit, per `06` §2.6 | Supabase account |

- Tokens and portals never contribute uploads or metadata, so `06` §5 still holds.
- The portal stays producer-owned until its tables get `org_id` (LABEL-12). In a label org it serves the org's roster contacts.

### R5 — Comments are `project_comments`. No new `comments` table
- **Extend `project_comments`:**
  - `org_id`;
  - `visibility` (`internal` | `artist`);
  - `resolved_at`.
- It already carries `track_id`, `region_start/end`, threads and portal `contact_id`. Release discussion happens on the release's project (R2).

### R6 — Chat builds on `artist_messages`
`15-product-decisions.md`'s chat ladder is updated:
- Steps 1–3 already exist in `main`: comments with timestamps, portal comments, and per-artist message threads with requests.
- Phase 8 extends `artist_messages` to org members as participants, adds member↔member threads, and adds live updates. It does not start a new chat store.

### R7 — Two different "decisions", both kept
- `contact_track_states` is **the recipient's** decision on a beat (pitching side).
- `song_reviews` is **the label's internal** review of a song (A&R side). It is keyed by `track_id`.
- The song's A&R stage lives on `tracks.song_stage`.

### R8 — Credits are `track_collaborators`, extended. No new `credits` table
- **Add to it:**
  - `org_id`;
  - `party_id` (rights identity, `parties` stays new);
  - `scope` (`composition` | `recording`);
  - `status` (`proposed` | `confirmed` | `disputed`);
  - `role_detail`;
  - `created_by`;
  - `confirmed_by`.
- It already links to contacts (`contact_id`) and is grouped per person by `groupCredits`.
- `parties.contact_id` connects a rights identity to the same person.

### R9 — Unchanged by #44 (still new in Label OS)
`organizations`, `org_members`, `org_invitations`, `user_profiles`, `activity_events` (LABEL-03), `releases` / `release_items` (items: `song_track_id`, `master_track_id`), `parties`, `split_sheets` / `split_lines` (keyed by the song's `track_id`), `approvals`, `tasks`, `song_reviews`, `org_connections`, `project_members`.

### R10 — Migrations
- `main` now ends at **135**, and Label OS migrations start at **136** (LABEL-03).
- Production applies migrations with `supabase/apply/pending.sql`, built by `scripts/ops/bundle-migrations.sh` from **explicit numbers**.
- **Label OS tasks never edit `supabase/apply/pending.sql`.** Nobody runs `npm run db:migrate` (which applies every file) against production from the Label OS branch.
- At the final merge, the owner bundles the Label OS numbers deliberately.

### R11 — The producer org gets its existing workspace for free
- Once `tracks`, `projects` and `contacts` carry `org_id` (LABEL-12), the #44 child tables inherit the org through their parent:
  - `project_contacts`, `artist_portals`, `project_assets`, `song_beats`, `track_links`, `artist_messages`, `contact_track_states`, `project_comments`.
- They get **parent-based** `org_member_read` policies: `EXISTS` on the parent with `org_id IS NOT NULL AND has_org_cap(…)`.
- Producer rows (`org_id IS NULL`) stay invisible to members until M7.

### R12 — UI reuses the workspace components
- The org artist workspace (`07` §2.2) is `components/artists/ArtistWorkspaceTabs` and its tabs, rendered in org context under `(label)/o/[orgSlug]`, plus the tabs Label OS adds: Releases, Credits & Rights, Direction.
- It does not get a parallel set of pages.
- The `/contacts` role tabs (Artists · Producers · Labels & A&R) are the org's people directory.

## Effect on finished and in-flight work
- **LABEL-02 (merged, #47):** unchanged. The recording kinds stay; R1 adds an adapter.
- **LABEL-03 (#49, in review):** unchanged. It creates only org tables, at migration 136.
- **Backlog:** tasks 10–17, 21, 22, 24–28, 32, 41 rewritten in `14-engineering-backlog.md` per R1–R12. Numbering and order are unchanged.

## Open questions for the owner (defaults are applied until answered)
- **Q1:** should demos an artist uploads go into a per-artist "Inbox" project automatically (R1)? *Default: yes.*
- **Q2:** label orgs keep their own contacts directory (R3), separate from the producer's 500+ contacts. A label sees nothing of the producer's CRM unless something is shared. *Default: yes.*
