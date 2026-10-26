# 07 — Information Architecture

**Discovery 01 · 2026-09-30**

> **Superseded in part (2026-10-01):** `main` gained the Artist Workspace (#44) after this was written. Where this file conflicts with `17-reconciliation-with-artist-workspace.md`, **17 wins**: songs are `tracks` rows, artists are org contacts in workspace mode, files are `project_assets`, comments are `project_comments`, credits are `track_collaborators`.


**Binding constraints:** `docs/design-direction.md` ("Quiet Luxury"), and the interaction hierarchy and primitives in `CLAUDE.md`: `ListRow`, `ActionMenu`, `InlineText`, `InlineTagStrip`, `Popover`, `Dropdown`, `BatchActionBar`, `useDialogBehavior`, toast queue. **No new colours, fonts or UI library.**

**Priority order (from the brief):** Context → Music → People → Work → Next Action.

---

## 1. Navigation model

**FACT (repo):** the dashboard nav is three hubs, Catalog / Store / CRM, rendered from one model (`src/components/nav/model.ts`) by `TopBar` and `Sidebar`.

**RECOMMENDATION:** add an **organization switcher** and render a *different hub set per org kind*, from the same single model file. There is still no second nav source: `model.ts` becomes `navGroupsFor(orgKind, capabilities)`, a pure function with tests.

| Org context | Hubs |
|---|---|
| **Personal producer org** (today's user) | Catalog · Store · CRM (**unchanged**) |
| **Label org** | Overview · Artists · Releases · A&R · Rights · (Search in the command palette) |
| **Shared with me** (external projects) | A list of projects from other orgs, opened read-only in the label's project view |

**The switcher** sits in the TopBar's left cluster. It shows the org name, lists orgs plus "Shared with me", and persists the choice per device in `localStorage`, following the per-device precedent in `CLAUDE.md`'s desktop-notification pref. The server never trusts it: every request carries `org_id` in the path and is re-authorized.

**URL shape:**

```
/o/<orgSlug>                          Overview
/o/<orgSlug>/artists                  Roster
/o/<orgSlug>/artists/<artistSlug>     Artist workspace (tabs below)
/o/<orgSlug>/releases                 Release board
/o/<orgSlug>/releases/<id>            Release detail
/o/<orgSlug>/ar                       A&R inbox
/o/<orgSlug>/rights                   Parties, splits, legal queue
/o/<orgSlug>/songs/<id>               Song detail (deep-linkable from anywhere)
/o/<orgSlug>/projects/<id>            Org project (members, songs, files)
/o/<orgSlug>/settings                 Members, invitations, gate switches
/shared                               Projects shared with me
/join/<token>                         Invitation acceptance
```

A new route group `src/app/(label)/o/[orgSlug]/…` keeps Label OS pages physically separate from `(dashboard)`. That makes the ISOLATE boundary visible in the tree, and lets the proxy apply the membership gate to `/o/*` instead of the producer gate.

Depth rule: **at most two levels below the org** (org → artist → tab). Songs and releases are addressable at org level, so links never need the artist in the path.

---

## 2. Screens

### 2.1 Org Overview (owner's home)

```
┌ Overview ─────────────────────────────────────────────────────────┐
│ NEEDS ATTENTION (3)                                               │
│  EP 2027 · Artist A · blocked: Legal (Dana), Artwork (Maya) · 23d │
│  Track 04 · in development 41 days                                │
│  2 overdue tasks                                                  │
├───────────────────────────────────────────────────────────────────┤
│ ARTISTS                     demos  dev  selected  next release    │
│  Artist A                     3     6      1      EP 2027 · Legal │
│  Artist B                     …                                   │
├───────────────────────────────────────────────────────────────────┤
│ SINCE YOUR LAST VISIT (grouped by artist → day)                   │
│  Artist A — yesterday: 3 demos · EP project created · Producer X  │
│            added · artwork uploaded · credits updated             │
└───────────────────────────────────────────────────────────────────┘
```

- **One hero moment:** Needs attention (design-direction principle 1).
- Rows are `ListRow` with a stretched activator. Counts use the mono label style (10px, uppercase, `tracking-[0.2em]`, `text-white/40`).
- **Colour is state only.** Blocked gates render as text plus a hairline border. Mint `#6DC6A4` is reserved for complete/ready. No red walls; the error tokens are used only for real errors.
- No cards-in-cards. Background steps `#090907` → `#0D0D0A` only.

### 2.2 Artist workspace — tabs (MVP vs later)

| Tab | MVP? | Content | Why / why not now |
|---|:-:|---|---|
| **Overview** | ✓ | Stage counts, next release + gate, needs-attention for this artist, activity digest | The owner's per-artist answer |
| **Music** | ✓ | Songs grouped by stage; each row: title, current recording player, stage, reviewer ratings (aggregate), last activity | The core |
| **Releases** | ✓ | This artist's releases with gate strip | Release visibility |
| **Projects** | ✓ | Org projects for this artist (members, songs) | Collaboration unit |
| **Credits & Rights** | ✓ (Phase 5) | Per-song legal readiness, parties, split sheets | Legal readiness |
| **Files** | ✓ | Artwork, photos, video, documents (restricted greyed without capability) | Assets |
| **Direction** | ✓ (Phase 4) | References and structured direction; internal notes hidden from the artist | A&R memory |
| **Activity** | ✓ | Full artist event log with filters | Visibility |
| Team | Later | Shown on Overview as avatars; a dedicated tab adds little | Avoid tab bloat |
| Calendar | Later | Release dates are on Releases; `calendar_events` integration later | Existing calendar suffices |
| Tasks | Later (as a tab) | Tasks appear inline on songs/releases and in "My work" | Avoid a generic PM surface |
| Contracts | Later | Restricted files under Files cover the MVP | Contract management = dangerous scope |
| Sessions | Later | Session files are a `files` category | — |
| Notes | No | Notes are fields on song/release/artist direction | Avoid a wiki |

### 2.3 Song detail (the most important screen)

```
Track 04 · Artist A · IN DEVELOPMENT ▾        Legal 82%   ⋯
──────────────────────────────────────────────────────────
[ waveform of current recording — region comments inline ]
Recordings   master (none) · mix v3 ● · mix v2 · rough · demo   [A/B]
Reviews      Sam ★4 shortlist · Priya ★3 hold          you: ☆☆☆☆☆
Credits      Artist A (writer) ✓ · Producer X (producer) proposed ⚠
Splits       Composition v2 · circulated · 1 of 3 signed
Files        artwork_v2.png · lyrics.pdf
Comments     (threaded, region-pinned; internal toggle)
Tasks        Get Producer X IPI · Dana · Fri
```

- **Stage** is a `Dropdown` of *allowed* transitions only, taken from the pure transition function.
- **Title** is `InlineText`. **Tags** use `InlineTagStrip`. Everything else sits behind one `ActionMenu` ⋯: move to project, add to release, archive, share, with Delete pinned last.
- **Recordings** follow Pibox/Frame.io version-stack logic: one current per kind, and an A/B toggle playing two recordings at the same position through the existing player (`usePlayer`).
- **Legal %** is a button that opens the readiness panel as a `Popover`. It is not a new screen: interaction hierarchy rung 2.

### 2.4 A&R Inbox

- A list, oldest first, filtered to the reviewer's scope.
- Keyboard: `J`/`K` next/previous, `Space` play, `1`–`5` rate, `S` shortlist, `H` hold, `P` pass, `C` comment. This matches the existing `usePlayerKeyboardShortcuts` convention; keyboard hints spell out "Shift"/"Alt" (the Panchang glyph gotcha).
- Bulk actions: `BatchActionBar` with `Set<string>` selection: move stage, tag, assign.

### 2.5 Release Board

- Columns are **gates, not stages**. Each release is one row with a gate strip (`Tracklist ✓ Masters ✓ Credits ⚠ Legal ◻ Artwork ⚠ Metadata ◻ Marketing —`).
- Clicking a gate opens a popover with the named blockers and a direct fix link.
- No drag-to-move-stage. Gates are derived, so dragging would lie.

### 2.6 Org Settings → Members

- Member list: role, functions, scope (artist chips), joined.
- Invite = one `Modal`. It is the only modal in the core flow, because it is a multi-field deliberate action.
- Remove requires `confirmToast` (the destructive path confirms, per the `/links` precedent).

---

## 3. UX rules specific to Label OS

1. **No notification spam.** Notifications only for direct asks (08 §3). Everything else goes to the activity digest.
2. **Every blocked state names a person and a next action.** "Legal: waiting on Dana since Tue" beats "Pending".
3. **No manual status fields for derived states.** If the UI shows a status, the data computed it.
4. **Restricted content degrades visibly.** A member without `rights.read` sees "Splits: restricted", not an empty section, so absence is not mistaken for missing data.
5. **Mobile mirrors desktop functionally** (design-direction hard constraint). The overview and song detail must work at 390px; the release board collapses to a list.
6. **Reduced motion** gates any non-essential animation (existing guard test).
7. **The producer's current UI does not change** in Phases 1–3 unless they switch org.
