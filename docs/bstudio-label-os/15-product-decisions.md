# 15 — Product Decisions (LABEL-01)

**Decided by the product owner on 2026-09-30.** This file completes backlog task LABEL-01. One file replaces the ten separate ADR files the backlog first proposed, so every implementation session reads one place.

## Decisions

| # | Question | Decision | What it changes |
|---|---|---|---|
| D1 | Do artists get their own organization? | **Yes. Three org kinds: artist, producer, label.** Each kind has different capabilities and different ways of adding people | `organizations.kind` gains `artist`; `capabilitiesFor(orgKind, role, functions)`; kind-specific invite options; a new **artist ↔ label connection** (LABEL-41). See `06` §2.4b |
| D2 | Can an outside producer see the whole split? | **Only their own share** | `06` §2.6; LABEL-28 |
| D3 | Who keeps an outside collaborator's uploads when they leave? | **The project owner**, with the uploads credited to them | `06` §2.6; LABEL-21 |
| D4 | Can a label edit role permissions? | **No, roles are fixed.** A label has a **creative side** (A&R: all music including toplines and loops, all collaborators, no legal) and a **business side** (marketing: projects and finished music, not working material; legal: rights and contracts) | `audio.full` split into `audio.finished` / `audio.working`; A&R loses `rights.write`; `business.read.internal` replaces `activity.read.internal`. See `06` §2.3–2.4 |
| D5 | What does an artist see about their own songs? | **Everything:** stage, each reviewer's rating and verdict, A&R comments | Reviews/comments visible to the song's artist; only business-internal notes are hidden. LABEL-24/25 |
| D6 | How does a producer's beat become a label song's source? | **A copy with provenance kept**, made when the deal is accepted; the original stays in the producer's library | LABEL-11 (flag), LABEL-41 |
| D7 | Apply migration 115 (`track_collaborators`) on prod now? | **Yes, apply now.** Import into credits later | **Action for the owner:** run `supabase/migrations/115_track_collaborators.sql` in the Supabase SQL editor, then mark it applied in `supabase/MIGRATIONS.md`. LABEL-27 imports it |
| D8 | Previews of unreleased label music? | **Private until released.** After release they may go public, e.g. on the store | LABEL-14; LABEL-42 |
| D9 | Everyday activity history retention | **2 years.** Security/audit records kept for the life of the org | LABEL-39 |
| D10 | Grace period before an org is permanently deleted | **30 days** | LABEL-39 |

**Assumption D1a** (correct it if wrong): before an artist is signed, their demos stay in the **artist's own org** and a label sees them only through the connection. Projects and releases the label creates live in the **label org**.

## Execution decision

**One backlog task per Claude session, in dependency order.** When one task's pull request is merged, the next session starts. The owner reviews each pull request. See `16-execution-runbook.md`.

---

## Other direction given on 2026-09-30

### Released vs unreleased is a core distinction
A released album (for example, one already on Spotify) can be **put on the store, where everyone can listen**.

- Only a release that is *released* can be listed on a storefront. Unreleased music stays private (D8).
- An album that is already out can be entered as **"already released"**, skipping the gates, so the back catalogue can go on the store without pretending to re-release it.
- New task: **LABEL-42 — Released → store bridge** (Phase 6).
- The existing beatstore is single-producer today. LABEL-42 therefore starts with the **producer's own store** and a producer/artist org's own releases; multi-org storefronts come later.

### Workflow is important; "no workflow engine" explained
**Plain meaning:**

- A *workflow engine* is a system where each label draws its own process (its own steps, rules and automations) inside the app.
- A *workflow builder* is the screen where they would draw it.

The MVP does **not** build that. It **does** ship a real workflow: the release process (tracklist → masters → credits & splits → legal → artwork → metadata → marketing → delivered → released) with owners, approvals, deadlines and a "needs attention" list. The steps are fixed in code, with on/off switches per label. That is the part that makes BStudio useful on day one.

**Later (Phase 8):** a workflow builder, so a label can add its own steps. It becomes easier then, because the fixed steps will already be written as data-like requirement lists (`09` §5).

> If "work" meant something else — for example the *Work* area (tasks, "My work") — say so and the plan will be adjusted. Tasks and "My work" are in Phase 3 (LABEL-23).

### Chat: last, but prepared for from the start
Interactive chat is **not** built now. The design grows toward it step by step, with each step useful on its own:

| Step | What exists | Phase |
|---|---|---|
| 1 | Comments on songs/recordings/releases, threaded, with timestamps on the waveform (`comments`) | 3 (LABEL-22) |
| 2 | @mentions that notify only the person named | 3 (LABEL-23) |
| 3 | A per-project discussion thread (comments whose subject is the project) | 3 (LABEL-22, already allowed by the schema) |
| 4 | Live updates: new comments appear without refresh (Supabase realtime, the pattern already used in migration 012) | 8 |
| 5 | Direct messages and group chat, reusing the same `comments` storage with a `thread` subject | 8 |

Because steps 1–3 use one table and one permission model, chat later is an extension, not a rebuild.

### Contract generation: later, interesting
Not now: legal liability and jurisdiction differences. The MVP stores signed documents and tracks signatures (LABEL-28). **Phase 8** can add generated split sheets and simple agreement templates filled from the data BStudio already holds (parties, IPI, percentages), with e-signature through an external service.

### Confirmed out of scope
Royalty accounting and delivery to streaming services: **no**.

## Phase 8 — Later (not in the backlog yet; each needs its own short discovery first)

1. Chat (steps 4–5 above).
2. Workflow builder (custom steps per label).
3. Contract generation + e-signature.
4. Multi-org storefront (label and artist stores).
5. Migrating the producer's existing catalogue into their org (M7 in `11`).
