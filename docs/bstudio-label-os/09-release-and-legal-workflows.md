# 09 — Release and Legal Workflows

**Discovery 01 · 2026-09-30** · Diagram: `workflow-map.mermaid`

> **Superseded in part (2026-10-01):** `main` gained the Artist Workspace (#44) after this was written. Where this file conflicts with `17-reconciliation-with-artist-workspace.md`, **17 wins**: songs are `tracks` rows, artists are org contacts in workspace mode, files are `project_assets`, comments are `project_comments`, credits are `track_collaborators`.


## 1. Principle: derive, don't store

**FACT (repo):** `src/lib/library/triage.ts` classifies every beat's produce→sell stage from existing columns ("no status column to keep in sync, and it classifies the whole back catalogue retroactively"). `src/lib/store/readiness.ts` splits **hard blockers** (literally unpurchasable) from **conversion issues**, and `CLAUDE.md` says to keep that split: "a diagnostic that overstates gets ignored".

**RECOMMENDATION:** Legal Readiness and Release Readiness follow exactly this pattern:

- Pure functions in `lib/labelos/`.
- Each result is `{ blockers: Reason[], warnings: Reason[], score }`.
- Every `Reason` names the field, the object, and **who can fix it** (the capability).
- **Only human decisions are stored:** approvals, song stage, delivered-at.

---

## 2. The full lifecycle mapped onto entities

The prompt's 14-step lifecycle, split into *where it lives*:

| Prompt stage | Lives on | Stored or derived | Owner (capability) | Requirements | Files | Approval |
|---|---|---|---|---|---|---|
| IDEA | Song (`inbox`) | Stored stage | Artist / A&R (`catalog.write`) | Title | Voice memo / demo | — |
| DEMO | Song + recording `kind=demo` | Stored stage + relationship | Artist / A&R | ≥1 demo recording | Demo audio | — |
| DEVELOPMENT | Song (`in_development`) | Stored stage | A&R (`catalog.write`) | Assigned collaborators (tasks/project) | Roughs, mixes, stems, sessions | — |
| MASTER | Release gate `masters` + approval `master` | Derived + approval | A&R (`release.approve.master`) | Every release item has a `master` recording | Master WAV | ✓ |
| CREDITS | Release gate `credits_splits` | Derived | A&R/Legal (`rights.write`) | See §3 | — | — |
| SPLITS | Release gate `credits_splits` | Derived | Legal/A&R (`rights.write`) | Signed composition + master split sheets | Signed PDFs (restricted) | Signatures |
| LEGAL | Release gate `legal` | Derived + approval | Legal (`release.approve.legal`) | Legal readiness has no blockers, then approval | Legal pack export | ✓ |
| ARTWORK | Release gate `artwork` | Derived + approval | Marketing (`release.approve.artwork`) | Artwork file ≥3000×3000 px, square, RGB | Artwork (the Cover Art Studio can produce it) | ✓ |
| MARKETING | Release gate `marketing` | Derived + approval (optional per org) | Marketing (`release.approve.marketing`) | Approval recorded | Campaign assets | ✓ |
| METADATA | Release gate `metadata` | Derived | PM (`release.approve.metadata`) | §4 | — | ✓ (confirmation) |
| DISTRIBUTION | `releases.state = delivered` | **Stored** (manual fact) | PM (`release.write`) | All required gates satisfied | Distributor export | — |
| RELEASE | Derived (`delivered` ∧ `release_date ≤ today`) | Derived | — | — | — | — |
| CATALOG | Derived (released ∧ > 28 days) | Derived | — | — | — | — |

**Every stage has an audit history:** stage changes, approvals and deliveries are `activity_events`. **Deadlines:** `releases.target_date` plus optional `tasks.due_at`. **Dependencies:** gates are independent except that `legal` requires `credits_splits` to have no blockers before approval can be *recorded as approved*. The UI still lets legal request changes at any time. **Comments:** on the release and on each song.

**The artwork minimum (3000×3000)** is the common DSP spec. It is **INFERENCE** from distributor requirements generally; confirm against the label's distributor, and it is configurable in `organizations.settings`.

---

## 3. Legal Readiness

### 3.1 Minimum data for a useful legal handoff

Derived from the split-sheet research (`02` §3, [Songtrust](https://www.songtrust.com/en/the-ultimate-split-sheet-for-songwriters), [Soundplate](https://soundplate.com/how-to-read-music-split-sheet/)) and DDEX contributor practice ([LabelGrid](https://labelgrid.com/blog/guides/ddex-feed-generation-guide/)).

Per **song**:

| # | Requirement | Severity | Fix capability |
|---|---|---|---|
| L1 | Song title | Blocker | `catalog.write` |
| L2 | ≥1 writer/composer credit | Blocker | `rights.write` |
| L3 | Every writer party has a **legal name** | Blocker | `rights.write` |
| L4 | Every writer party has PRO + IPI, **or** is explicitly `not_affiliated` | Blocker | `rights.write` |
| L5 | Every writer has a publisher, or is explicitly self-published/unpublished | Warning | `rights.write` |
| L6 | Composition split sheet exists, lines reference all writer credits, sum = 100.0000 | Blocker | `rights.write` |
| L7 | Composition split sheet `signed` | Blocker | `rights.write` (collects signatures) |
| L8 | Samples declared (`none` / `yes`); if `yes`, a clearance note or document attached | Blocker if `unknown` or uncleared | `catalog.write` |
| L9 | Producer(s) credited on the master recording | Warning | `rights.write` |
| L10 | Master ownership split sheet exists, sum = 100 | Blocker when the song is on a release | `rights.write` |
| L11 | Master split signed | Warning (becomes a blocker if `settings.require_signed_master_split`) | `rights.write` |
| L12 | Featured artists credited on the recording | Warning | `rights.write` |
| L13 | All credits `confirmed` (none `proposed` / `disputed`) | Warning; **blocker if any `disputed`** | `rights.write` |
| L14 | ISRC on the master recording | Warning here (a blocker in the Metadata gate) | `release.write` |

### 3.2 Score

`score = satisfied weight / applicable weight`. Blockers weigh 3, warnings weigh 1. Requirements that do not apply are excluded (L10 when the song is not on a release; L8 clearance when there are no samples). The score is **display only**. Gates key on `blockers.length === 0`, never on a percentage, because a percentage implies partial legal sufficiency.

Rendering (song detail):

```text
Legal readiness  82%
Complete   ✓ Title  ✓ Writers  ✓ Producers credited  ✓ Master attached  ✓ Split sums to 100%
Missing    ✕ Producer X — IPI          (Rights · assign to Dana)
           ✕ Publisher for Artist A    (warning)
           ✕ Composition split sheet not signed (1 of 3 signatures)
```

### 3.3 Handoff

1. **Send to legal** creates `approvals(gate=legal, decision=requested)` plus a task for the chosen legal member. It is allowed with blockers, which are listed in the request.
2. Legal sees the **legal queue**: songs/releases with `requested`, readiness first, oldest first.
3. **Legal pack export** (`GET /api/org/<id>/releases/<id>/legal-pack`):
   - A CSV with one row per credit/split line (song, role, legal name, PRO, IPI, publisher, share, signed at).
   - A zip of the restricted documents.

   Access requires `contracts.read`, and the download is audited.
4. Legal records `approved` or `changes_requested` with a note. **`approved` stores `subject_snapshot`** (split sheet version ids, credit ids + statuses). If any of those change afterwards, the approval shows **stale** (derived) and the gate re-opens. This prevents the classic "approved, then splits changed" failure.

### 3.4 What is deliberately NOT built

Contract generation, contract templates, clause libraries, e-signature, rights conflicts across territories, PRO/society registration. Research does not show these belong in the foundation. They are served by publishing admins (Songtrust), contract tools and e-sign vendors, and they carry legal liability. The existing beat-lease `licenses.license_template_md` (057) is **not** reused for label contracts: it is buyer-facing lease text.

---

## 4. Release Readiness (gates)

`lib/labelos/release-readiness.ts` → `{ gates: Record<Gate, GateState>, readyToDeliver: boolean }`, where `GateState = { status: 'not_started' | 'blocked' | 'awaiting_approval' | 'approved' | 'satisfied' | 'not_required' | 'stale', blockers, warnings }`.

| Gate | Satisfied when | Approval? |
|---|---|---|
| `tracklist` | ≥1 item; positions contiguous; every item has a song | — |
| `masters` | Every item's `track_id` is a `master` (or `clean`/`instrumental`) recording **and** `master` approval is current | ✓ |
| `credits_splits` | Legal readiness has no blockers for every item | — |
| `legal` | `credits_splits` satisfied **and** current `legal` approval (skipped if `settings.legal_gate = 'off'`) | ✓ |
| `artwork` | `artwork_file_id` set, meets the size rule, **and** current `artwork` approval whose snapshot matches the current file | ✓ |
| `metadata` | Release title, type, primary artist, label name, ℗/© lines, genre, target/release date, UPC; every item: ISRC, explicit flag, version title if any; **and** a `metadata` confirmation approval | ✓ |
| `marketing` | Current `marketing` approval (skipped if `settings.marketing_gate = 'off'`) | ✓ |

**Ready to deliver** means every non-`not_required` gate is `approved` or `satisfied`. **Delivered** is the PM's manual action, with distributor name and date. It is disabled unless ready, with an owner override that requires a note and is audited.

**Metadata export (distributor-ready):** CSV/JSON with ERN-aligned field names (release: title, display artist, label, UPC, P-line, C-line, genre, release date; items: ISRC, title, version, explicit, contributors with RIN-aligned roles). It is an **export**, not a DDEX feed (dangerous scope, `02` §4).

---

## 5. Workflow engine: needed or not?

**Question from the brief:** should workflows be configurable, stages be DB entities, requirements be dynamic, approvals be required, and how should automation work?

| Question | Answer | Evidence / reasoning |
|---|---|---|
| Configurable workflows? | **No, in MVP.** Per-org *switches* only (legal gate on/off, marketing gate on/off, artwork min size, signed master split required) | The canonical label's flow matches the standard lifecycle. Generic configurable engines are ClickUp/Monday's product and the support-debt trap (`02` §4) |
| Custom workflows per label? | **Deferred to post-Phase 7**, and only on evidence from ≥3 labels whose flows the switches cannot express | No evidence yet |
| Stages as DB entities? | **No.** Song stages are a TS union + CHECK constraint; release gates are code | The repo's pattern is pure derived state with tests (`triage.ts`) |
| Dynamic requirements? | **Code-defined requirement lists**, parameterised by org settings | Keeps readiness testable and explainable |
| Approvals required? | **Yes, for master, artwork, legal, metadata; marketing optional.** Stored append-only with a subject snapshot | Frame.io approval vocabulary; approvals are human facts that cannot be derived |
| Automation? | **Minimal and deterministic:** (1) a gate becoming `awaiting_approval` creates the approval request + notification for the capability holder chosen by the PM; (2) a daily cron flags releases within N days of target with blockers (Needs attention, not email). **No rules builder** | Existing cron conventions (`vercel.json`, idempotent) |

**Decision:** no generalized workflow engine. Revisit only with evidence (logged in `13-risk-register.md` R-12 as a scope risk).
