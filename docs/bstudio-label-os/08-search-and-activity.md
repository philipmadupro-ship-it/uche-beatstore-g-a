# 08 — Search and Activity

**Discovery 01 · 2026-09-30**

> **Superseded in part (2026-10-01):** `main` gained the Artist Workspace (#44) after this was written. Where this file conflicts with `17-reconciliation-with-artist-workspace.md`, **17 wins**: songs are `tracks` rows, artists are org contacts in workspace mode, files are `project_assets`, comments are `project_comments`, credits are `track_collaborators`.


## Part A — Search

### A1. What exists

**FACT (repo):**

- `/api/search` runs `ilike` on `tracks.title`, `projects.name` and `contacts.name/email`, 5 results each, owner-scoped (`src/app/api/search/route.ts`).
- Structured storefront filters are a pure, tested function (`src/lib/store/filters.ts`).
- Saved rule-based filters exist twice: smart playlists (067) and contact segments (090).
- Audio similarity (BPM + key + features) exists (`src/lib/audio/similarity.ts`).

### A2. The example queries are relational, not textual

| Query | Kind | Resolved by |
|---|---|---|
| "All songs produced by Producer X" | Relational | `credits` ⋈ `parties` (party = X, role ∈ production roles) → songs/recordings |
| "Artist A demos from September" | Structured | `songs.artist_id = A` ⋈ `song_recordings.kind = demo` ⋈ `tracks.created_at` in September |
| "Songs missing artwork" | Derived state | Release readiness (`artwork` gate unsatisfied) or song-level asset check, computed in `lib/` |
| "Projects waiting for legal" | Derived state + approvals | Releases/songs whose legal gate is `requested` and not decided |
| "Everything involving Producer X" | Relational fan-out | Party X → credits, split lines, project memberships, uploads (`created_by`), comments, tasks |
| "Unreleased songs featuring Artist B" | Relational + derived | Credits (role featured, party = B's party) ∧ not released (derived) |
| "Songs where splits aren't complete" | Derived | `legalReadiness` blocker `splits_incomplete` |

**INFERENCE:** none of these needs semantic search. All are **deterministic joins plus derived predicates**. A vector index would answer them *less* reliably than a join. Supabase's own guidance frames keyword/FTS as the right tool for exact names and identifiers ([Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)).

### A3. Architecture (recommended)

1. **Structured filters** are a pure module, `lib/labelos/filters.ts`, in the `filterAndSortTracks` pattern. They take a filter object (artist, stage, kind, credited party, role, date range, gate state, readiness flags) and produce:
   - (a) a Supabase query builder for the relational parts, run server-side with org and scope filters pre-applied by `scopedOrgQuery`;
   - (b) a post-filter for the derived predicates, run in `lib/` over the candidate set.

   At the canonical scale (5 artists, hundreds to low thousands of songs) this is cheap. It is Vitest-covered.
2. **Full-text search** uses Postgres `tsvector` generated columns plus GIN indexes on `songs(title, working_title, notes)`, `artists(name)`, `releases(title)`, `parties(display_name, legal_name)`, `projects(name, description)` and `files(filename)`. Tracks already have title search; add a `tsvector` column when org tracks land.
   - Use the `simple` configuration, not `english`. Song titles and names should not be stemmed ("Runnin" must match "Runnin"). Add a trigram (`pg_trgm`) index on titles for typo tolerance, but only if FTS proves insufficient; measure first.
3. **Identifier search:** an exact match on ISRC/ISWC/UPC/IPI routes straight to the object (the command palette recognises the pattern through `lib/labelos/identifiers.ts`).
4. **Command palette:** the existing `CommandPalette` gains an org-scoped provider (`/api/org/<id>/search?q=`), grouped by Artists · Songs · Releases · People · Projects.
5. **Saved views:** the same pattern as `contact_segments`, as `org_saved_views(org_id, user_id, name, filters jsonb, shared boolean)`. Phase 7.
6. **Semantic search / embeddings: deferred and not planned.** Reconsider only with evidence. Two possible cases:
   - Free-text creative queries over direction notes ("dark, sparse, Frank Ocean–like") that users actually type and FTS demonstrably fails on.
   - Audio similarity across a label catalogue, where the existing feature-based similarity is the first step anyway.

   **No pgvector, no external search service, no LLM calls** in Phases 1–7 without a new discovery.

---

## Part B — Activity

### B1. What exists

**FACT (repo):**

- `/api/activity` *derives* a feed by unioning five source tables. It has no event table.
- `notifications` (064) carries purchases, offers, fulfilment alerts and share comments. It is polled every 60s; its realtime publication (116) is not applied on prod.
- `contact_activity` (094) is a stored per-contact log.

### B2. Why a stored event log is needed now

Deriving a feed from source tables cannot answer "who moved Track 04 to *selected*", "who removed Producer X", or "who downloaded the signed split sheet". Those facts do not survive in current-state tables. Label OS needs **attributable history** for visibility and for audit. **RECOMMENDATION:** an append-only `activity_events` table (schema in `05-domain-model.md` §2.5).

### B3. Event model

- **Written in the same route as the mutation,** after it succeeds, through one helper `recordEvent(admin, ctx, verb, subject, payload)` in `lib/labelos/activity.ts`.
- **No event bus, no queue, no triggers** for app events. This is the same best-effort pattern as `lib/crm/project-send.ts`, except that **audit-class events are not best-effort**: when an audit event fails to write, the route fails. This is achieved by performing mutation + event in one Postgres function (RPC) for audit-class verbs.
- **Verbs** are a closed union in TS (`song.created`, `song.stage_changed`, `recording.uploaded`, `credit.proposed`, `credit.confirmed`, `split_sheet.circulated`, `approval.requested`, `approval.decided`, `release.delivered`, `member.joined`, `member.removed`, `project.member_added`, `file.restricted_downloaded`, …) with a typed payload per verb.
- **Context keys** (`artist_id`, `project_id`, `song_id`, `release_id`) are denormalised onto every event, so feeds filter by index without joins.

### B4. Visibility

- An event is visible if the viewer could see its **context object** now (same scope rules as 06), **and** the event is not business-internal, or the viewer has `business.read.internal`. A&R reviews and stage changes are visible to the song's artist (D5).
- Events are checked against *current* scope, not scope at write time. Removing someone's access removes their view of history too.

### B5. Feeds

| Feed | Query | Grouping |
|---|---|---|
| Org overview digest | Org events since the viewer's last visit (`user_profiles.last_seen_overview_at`) | Artist → day → actor → verb, with counts ("uploaded 3 demos") |
| Artist activity tab | `artist_id = X` | Day → actor |
| Project activity | `project_id = X` | Day |
| Song history | `song_id = X` | Chronological, ungrouped (the audit view) |
| My work | Approvals requested of me, tasks assigned to me | Not from events; from `approvals` + `tasks` |

Grouping is a **pure function** (`lib/labelos/digest.ts`), in the `src/lib/dashboard/action-digest.ts` pattern, and tested. Example: ten `song.created` events by one actor within 10 minutes collapse to "uploaded 10 demos".

### B6. Notifications vs activity (anti-spam rule)

- **Notification** (existing `notifications` table, gains `org_id`): only when **you** must act. Examples: approval requested of you, task assigned to you, @mention, credit proposed that names *you* (so you can confirm), invitation.
- **Activity:** everything else. The owner is **never** notified by default that someone uploaded something.
- Desktop notifications reuse the existing opt-in mechanism (`lib/notifications/desktop.ts`) unchanged.

### B7. Retention

- **Audit-class events:** retained for the life of the org. Export is available to owners. They are deleted only with the org (a GDPR-style org erasure path, which extends the existing `/api/privacy/erase` thinking).
- **Non-audit events:** kept 24 months, then pruned by an idempotent daily cron under the existing `vercel.json` / `CRON_SECRET` conventions. **D9 decided: 24 months.**
- **Volume estimate** (INFERENCE): canonical label ≈ 10 active users × ≤200 events/day ≈ 0.7M rows/year. A trivial size for Postgres with `(org_id, created_at desc)` and `(artist_id, created_at desc)` indexes.
