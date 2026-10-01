# 04 — Core Workflows

**Discovery 01 · 2026-09-29**

> **Superseded in part (2026-10-01):** `main` gained the Artist Workspace (#44) after this was written. Where this file conflicts with `17-reconciliation-with-artist-workspace.md`, **17 wins**: songs are `tracks` rows, artists are org contacts in workspace mode, files are `project_assets`, comments are `project_comments`, credits are `track_collaborators`.


Each workflow gives: trigger → steps → the state written → the state derived → what is recorded in activity. Entities are defined in `05-domain-model.md`, and capabilities in `06-permission-model.md`. The visual map is `workflow-map.mermaid`.

---

## W1. Organization setup and membership

1. The owner creates an org (`organizations`, kind `label`) and becomes `owner` in `org_members`.
2. Invite: the admin enters an email, base role, function(s) and scope (whole org, or specific artists). This creates an `org_invitations` row. The **token is stored hashed** and bound to the email, with a 7-day expiry.
3. The invitee opens the link and signs in by magic link or Google. Accepting succeeds only when the **session email equals the invited email**. On success the app writes `org_members` (and `member_artist_scopes` if the invite was scoped), marks the invitation accepted, and records the activity event `member.joined`.
4. **Offboarding:** remove the member. Their session loses access on the next request, because every check reads membership live and nothing is cached in the JWT. Their uploads and comments stay with attribution. Event: `member.removed`.

**Why not reuse `invites` / `team_members`:** see `01-current-system-audit.md` §2.3. They are global, the page can't read its own row, and acceptance never grants anything.

---

## W2. Artist onboarding

1. Someone with the `a_and_r` function or admin role creates an `artists` row (name, status `signed` | `developing` | `prospect`). It can optionally link to an existing `contacts` row, since the artist is probably already in the CRM.
2. Optional: invite the artist as a user with the `artist` role. The invitation carries `artist_id`, so the artist is **auto-scoped** to their own workspace.
3. Optional: attach creative direction (references, notes) and analytics URLs.

---

## W3. Demo intake → A&R review (the canonical "10 demos" case)

**Trigger:** Artist A uploads 10 demos into their workspace.

1. Upload goes through the **existing audio pipeline** (`/api/upload/*` → R2 private bucket → analysis → peaks → preview). Each file becomes a `tracks` row with `org_id` set. For each demo the app creates a `songs` row (stage `inbox`) and a `song_recordings` link with `kind = demo`.
   - **Batch rule:** 10 files create 10 songs by default, because each demo is a separate idea. The tray offers "these are versions of one song" to attach them to a single song instead. This reuses the uploads-tray pattern (`components/upload/UploadsTray`).
2. The activity feed records **one** grouped event, `songs.created ×10 by Artist A`, not ten notifications.
3. **A&R Inbox** lists songs in `inbox` / `in_review` for the reviewer's scoped artists, oldest first.
4. **Per song, the reviewer can:**
   - Listen, with region comments on the recording.
   - Rate 1–5 **as themselves** (`song_reviews`, one row per reviewer).
   - Give a verdict: `shortlist` | `hold` | `pass` | `changes_requested` (with a note).
   - Tag (reusing tag semantics).
   - Assign a producer/collaborator by creating a task or adding them to a project.
   - Move the song into a project.
   - Attach references.
5. **Stage transitions** are explicit human decisions and are validated by a pure transition function (`lib/labelos/song-stage.ts`):

```text
inbox ──listen──▶ in_review ──▶ shortlisted ──▶ in_development ──▶ selected
   │                 │              │                 │                │
   └──────────────── passed ◀───────┴─────────────────┘                │
                     on_hold ◀──(from in_review|shortlisted|in_development)
selected ──(placed on a release that is delivered)──▶ [released: DERIVED, not stored]
any ──archive──▶ archived
```

**Why these states (vs the prompt's example):**

- **`RELEASE` is not a song stage.** Whether a song is released is a fact about the *release* it sits on. Storing it on the song would drift, which is the same argument `src/lib/library/triage.ts` makes for derived state. The UI shows "Released" as derived.
- **`APPROVED` becomes `selected`,** meaning chosen for a release. "Approved" is reserved for gate approvals (legal, artwork), so one word does not mean two things.
- **`on_hold` and `passed` are exits** A&R actually uses: not-now vs no. A passed song stays searchable, because passed demos are regularly revisited.
- **`changes_requested` is a review verdict, not a stage.** The song stays `in_review` / `in_development` with an open request. Making it a stage would lose where the song was.

**Written:** `songs.stage`, `song_reviews`, `comments`. **Derived:** `released`; A&R queue counts. **Activity:** `song.stage_changed`, `song.reviewed`.

---

## W4. Collaborative project (the "Uche × Producer X" case)

1. Producer A (a member of the label org, or the owner of a personal producer org) creates project *Uche × Producer X* in the org. The project gets `org_id`.
2. **Share with Producer X:** A invites X by email as an external project member with role `contributor`. This creates a `project_members` row, `invited`, bound to the email.
3. X opens the link and signs in with **their own account**. If X already has a BStudio org, they keep it: the Teams shared-channel model (`02-competitive-analysis.md`, Microsoft Teams). X now sees this one project under "Shared with me".
4. **X can:**
   - Listen/stream (HMAC-granted, or full via the per-object audio check).
   - **Upload new versions.** They append to a song's recording stack and never overwrite.
   - Edit metadata/tags/notes on project songs.
   - Add a credit for themselves, which stays `proposed` until confirmed by someone with `rights.write`.
   - Comment.
5. **Ownership:** every file X uploads into the project is owned by the project's org, attributed to X (`created_by`). See open decision **D3** on what X retains after leaving.
6. **Revocation:** A removes X, or the membership `expires_at` passes. Access ends on the next request. X's uploads remain, attributed.
7. **Conflicts:**
   - **Files:** conflicts cannot occur. Versions are append-only.
   - **Metadata:** optimistic concurrency. A PATCH carries the row's `updated_at` and gets a `409` if the row changed, and the UI refetches and shows the newer value. Same rule as the Store Editor's compare-and-set write in `lib/upload/processing.ts`.
8. **Audit:** `project.member_added`, `recording.uploaded`, `credit.proposed`, `project.member_removed`.

**Token shares still exist** for no-account listening (pitching to A&Rs outside the org, friends). A token may **never** upload or edit metadata. The existing `project_shares.role = 'editor'` (track reorder only) is left as-is and not extended (see `06-permission-model.md` §5).

---

## W5. Credits and splits

1. Credits accumulate from the start:
   - The filename parser (`track_collaborators`, source `filename`).
   - A contributor self-proposing.
   - A&R/PM entering them.
2. Each credit references a **party** (`parties`). Parties are org-scoped people/companies with legal identifiers, optionally linked to a CRM contact.
3. **Split sheet** (per song, `kind` = `composition` | `master`):
   - `draft`: editable; lines must reference parties.
   - `circulated`: locked for editing. Any change creates a new version (the previous one becomes `superseded`).
   - `signed`: every line has a signature record (an uploaded signed PDF, or a recorded acknowledgement). Immutable.
   - **Validation (pure):** shares sum to **exactly 100.0000**. Percentages are stored as `numeric(7,4)`, never as floats. Every writer line has PRO + IPI, or an explicit "not affiliated". Research basis: a sum of 99.9% freezes PRO registration ([Songtrust](https://www.songtrust.com/en/the-ultimate-split-sheet-for-songwriters)).
4. **Activity/audit:** `split_sheet.created`, `.circulated`, `.signed`, `.superseded`. All are audit-class events and can never be deleted.

---

## W6. Legal handoff

1. **Legal Readiness** is computed per song and rolled up per release by a pure function (`lib/labelos/legal-readiness.ts`), in the same pattern as `src/lib/store/readiness.ts`: **hard blockers** vs **warnings**. Specified in `09-release-and-legal-workflows.md`.
2. The PM/A&R sees *"Track 04 · Legal 82% · missing: Producer IPI, publisher, signed split sheet"* and fixes gaps **before** legal is involved.
3. **"Send to legal"** creates an approval request (gate `legal`) and a task for the legal member. It is enabled even below 100%, but shows the named gaps. A handoff is a person's judgement; the system informs it and does not block it.
4. **Legal decides** `approved` | `changes_requested` (with a note), recorded in `approvals`. `changes_requested` re-opens the gate with the note visible on the song.
5. **Export:** a legal pack for the song/release as CSV plus a document bundle (split sheets, signed PDFs, credits, identifiers). No contract generation.

---

## W7. Release lifecycle

The release is the commercial product (single/EP/album with UPC and a date). Stages **before** the release are song stages (W3). The release runs through **gates**, each **derived** from data plus approvals (full table in `09-release-and-legal-workflows.md`):

```text
Draft → [Tracklist] → [Masters] → [Credits & Splits] → [Legal] → [Artwork] → [Metadata] → [Marketing] → Ready to deliver → Delivered (manual) → Released (date) → Catalog
```

- Gates are **not sequential locks.** Artwork and credits proceed in parallel. The order is only the display order.
- "Ready to deliver" means every *required* gate is satisfied.
- **Delivered** is a manual, recorded fact: the PM marks "submitted to <distributor>". It is not an integration.
- **Released** is derived: delivered and `release_date <= today`.
- **Catalog:** released, and past the post-release window.

**Per-org switches:** whether the Legal and Marketing gates are *required* (a small label may skip marketing approval). This is the only configurability in MVP (see `10-technical-architecture.md` §Workflow).

---

## W8. Owner visibility (the canonical scenario)

The Org Overview is **read-only and computed**:

1. **Needs attention:** releases with a blocked required gate within N days of target date; songs stuck in a stage for more than N days; overdue tasks. The "Needs attention" pattern already exists in the Store Editor.
2. **Artists:** one row per artist with songs by stage (demos / in development / selected), active projects, next release and its blocking gate, and assets count.
3. **Activity digest:** grouped by artist, then day, then actor ("Artist A — yesterday: uploaded 3 demos, created EP project, added Producer X, uploaded artwork, updated credits"). Grouping is a pure function, following the pattern of `src/lib/dashboard/action-digest.ts`.
4. **No push notifications to the owner** by default. Notifications are reserved for *direct asks*: an approval requested of you, a task assigned to you, or an @mention.

---

## W9. Producer (existing) — must keep working unchanged

Upload beats, tag, analyze, list on the store, sell, share, run the CRM: **unchanged through Phase 1–3**. The producer's existing data is backfilled into their personal org (Phase 2, expand/contract) without changing any producer-facing behaviour. The Label OS UI sits behind a feature flag and is invisible to the producer until they enable or join an org (see `11-migration-strategy.md`).

**Bridge (Phase 2+):** "Use this beat for a song". A label member with access to a producer's shared beat links it as the song's `source` recording (`song_recordings.kind = beat_source`). The beat stays in the producer's org. **Open decision D6:** how cross-org references work (the recommendation is a copy-on-accept, with provenance recorded).
