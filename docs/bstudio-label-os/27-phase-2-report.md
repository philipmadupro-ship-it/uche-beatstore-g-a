# 27 — Phase 2 report (LABEL-43 … LABEL-77)

**Written 2026-11-07 for LABEL-78, from the merged PRs, `docs/codex-execution-log.md` and doc 23. Sources are named; severities are this author's reading, not the builders'.** Everything is on `claude/happy-bardeen-rnosf3`. Nothing is on `main`, and no migration from 136 up is applied anywhere. Apply order: `28-migration-apply-order.md`.

> File number: the brief asked for `25-phase-2-report.md`, but 25 (team accounts) and 26 (artist consent) already exist, so this is 27. Rename if the orchestrator wants the original.

## 1. What shipped

"Squash" is the merge commit on the Label OS branch. Mig = migration (not applied). The review fleet (G11+, doc 19) is run separately and is not summarised here.

### A. Hardening
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 43 Security hardening | #129 | b7ec46d32 | 162 163 164 | Column-level SELECT on `split_sheets` (own-line reader could read `note` etc., the D2 breach); audit `activity_events` immutable for every role; member/profile reads follow `mayListMember` through uncorrelated helpers |
| 44 Integrity | #131 | a45f18573 | 165 166 167 | `playlist_tracks` same-owner trigger; one artist contact per artist org; tracklist lock on non-draft releases + member-update compare-and-set (`MEMBER_CHANGED`). Review found a deadlock in the first head (item PATCH vs reorder); fixed in `2fd5974` |
| 45 Search tokenization | #127 | 7b899221b | 168 | `final_mix.wav`, `a@x.com`, non-Latin words match; search pages past hidden rows (up to 5 extra pages) |
| 46 Per-org "since last visit" | #128 | 3451405d7 | 169 | `org_overview_seen (org, user)`; visiting org A no longer clears org B |

### B. Accounts, licensing, setup
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 47 Faces, entitlements, platform console | #132 | e03a073eb | 170 | Independent = kind `artist`, label = kind `label`; `org_entitlements` (no row = everything the face allows); `/platform` for `platform_admins` only (owner added by SQL); module gating answers 404; seat/artist caps |
| (owner PR) Account type at sign-up, `/setup`, team accounts, admin centre | #130 | 0f62ce250 | 189 190 | Merged at the owner's instruction, outside the backlog. Forced password change enforced server-side; team accounts cannot create/join another org; reset and switch-off revoke sessions |
| 48 Create org + setup wizard | #143 | 8e6fd7b5c | 192 | Wizard on top of #130's `/setup`; org created WITH its settings in one transaction; done screen shows each team login's password once |
| 49 Departments + capabilities | #134 | e56f4f7f7 | 171 | `pr`, `executive`, `artistic_director`, `contracts` functions; `finance.write/approve`, `pr.*`, `exec.read`, `creative.*`, `contracts.write/sign`; roster artist can hold none (mutation-checked in TS, SQL mirror and Postgres) |
| 50 Roster and team window | #145 | 837ab51ab | — | One "Team and roster" window for wizard and Organization: artists, members (role + function + scope), collaborators |
| 51 Organization settings | #137 | 945f23984 | 172 | Owner-only settings screen; change + `org.settings_changed` in one transaction. Follow-up #140 (c2b9972f0): banner on delivered releases; Contracts cannot be switched off while legal approval is required |
| 52 Release gates v2 | #139 | cb191e7ee | — | `seen` required to approve; approve only a request addressed to you (owners/admins exempt); song-level legal approval 409 once on a live release; artwork square/RGB/≥`artwork_min_px`; restricted counts only for whole-org staff |

### C. Real music-business data
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 53 Recording/song metadata | #142 | 09e69a43e | 173 | ISRC, ISWC, BPM, key, language, explicit, genre, P-line, master owner; CAS token `metadata_updated_at`; ISRC needs `release.write`. Song page only |
| 54 Parties and payee data | #148 | f7882dd3d | 174 | Address, country, tax id (restricted), payment instructions (no bank numbers, CHECK), invite-to-confirm, credit withdraw |
| 55 Create release, metadata, master chooser | #150 | 99f7c4971 | 175 | "New release" draft with UPC, distributor, territories, language; master chooser; all seven gates satisfiable from the UI |
| 56 Delivered-release lifecycle | #156 | 4f4f64243 | 193 | `withdrawn` state; a song on a draft release stays `working` until delivered; cancelled never counts |

### D. Contracts
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 57 Contract model + templates | #154 | a85241956 | 176 | 14 templates, one per type, placeholder wording marked "not legal advice"; versioned org copies; restricted columns have no API grant |
| 58 Editor + document generation | #158 | 0bcd98846 | — | Merge fields with suggestions, live preview, PDF as a restricted `project_assets` row filed only in the artist's project; sent contract serves its frozen copy |
| 59 Contract ↔ split sheets | #160 | cd0d9d9ed | — (177 released) | Sheet prefill both ways, drift warning, `require_signed_master_split` gate |
| 60 In-app signature + contract store | #166 | 17e770ebd | 178 | Append-only `contract_signatures`, document SHA-256, hash-only token links, certificate page that says "in-app signature, not a qualified electronic signature", expiry reminders in `calendar.ics` |

### E. Finance (no money moves anywhere)
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 61 Finance schema | #165 | b474c1f19 | 179 | Eight org-only tables, integer minor units, largest-remainder allocation, payee ↔ party |
| 62 Earnings import + royalties | #169 | 8302d8a69 | 180 | CSV import idempotent by file hash; ISRC/UPC matching; allocation by splits and contract terms; recoupment; scoped needs-review queue |
| 63 Statements + payments | #174 | 9dde850c9 | 181 | Per-payee statement, approve, issue, void, mark paid, payout CSV; artist sees only theirs |
| 64 Finance dashboard + advances | #180 | 9aaff9d4b | 182 | Advances ledger (audited), per-payee position, per-release income vs cost, period close/reopen (reopen owner-only); `financeSummary()` feeds LABEL-67 |

### F–G. Marketing, PR, leadership
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 65 Marketing plans | #170 | 44bb802da | 183 | Timeline, platform checklist, asks to the artist (closed kind `asset_requested`), budget (business readers only), optional marketing-gate requirement (owner-only switch) |
| 66 PR and press | #172 | a0da50967 | 184 | Press kit per release, token-shared `/press/<token>`, embargo, outreach tracker; no audio before embargo |
| 67 Executive dashboard | #184 | bee57da18 | — | `/o/<slug>/exec`: pipeline, releases by month, blocked releases, approvals waiting, income vs cost, top songs, task load by department, audited CSV (`exec.exported`) |
| 68 Artistic direction | #176 | 9d550671b | 194 | `/o/<slug>/creative` reads direction, references, reviews, stages, releases; optional creative approval gate (off by default) |

### H–I. Collaborators, role views, consent, playback
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 69 Collaborators | #175 | d3997f3c7 | — | Invite a collaborator with a role to a song (rides `org_invitations.functions` tags); "My sessions" on `/shared` |
| 70 Role views | #178 | 3ab02150f | — | One pure table (`role-view.ts`) decides nav, page guards and home tiles from face + role + functions + modules; persona matrix of 13 personas |
| 71 Artist consent | #159 | 6eea56c06 | 186 | Any one credited artist's "no" withdraws a store listing and blocks re-listing without their yes; store owner's Unlist of connected artists' releases |
| 72 Playback rules | #162 | 4592fdfc5 | — | Teaser (preview-only) from delivery; `full` only from the release date, derived never stored down; lossy 128 kbps derivative, master unreachable from public routes; 1 MiB Range cap; durable limiter |

### J. Reliability
| Task | PR | Squash | Mig | What |
|---|---|---|---|---|
| 73 Atomic audit functions | #168 | 2ccf06da9 | 187 | Deliver / list / import / org delete / restore / export / digest channel verbs become one SQL function each; approval decide re-checks latest row, addressee, live release, `seen`; caps enforced under lock; `has_org_cap` subtracts `departments_off` |
| 74 + 75 Visibility and lifecycle | #182 | 506654b90 | 195 | Slack digest from the artist-visible, non-restricted view; `org.created` audit-class; sole-owner delete guard; `split_lines` column grant; TRUNCATE guard; no per-row `has_org_cap` in the activity policy; `DELETE organizations` only after the 30-day grace; purge cron 60 s / 45 s budget |
| 76 UI polish | #185 | ea51d609d | 196 | Merged as "draft, first slice": Overview at 390 px, org chrome (home link, sign out), tokens + scoped `de-roche-archive` layer, no UI-asks-server-refuses 403s, JPEG with a big header read further, PNG with alpha refused, `no_request` before `seen_required`, and the `artwork_min_px` settings field (196; present in `OrgSettingsPanel`). The PR body still lists "full CI, /code-review, final screenshot list" as to do |
| 77 Test infrastructure | #181 | 5aa1007ba | — | `e2e:real-db` expect 25 s / test 90 s; real-DB specs found by an `E2E_REAL_DB` marker (58 files); service-key seeds replaced by routes where a UI exists; 4 named flakes root-caused; CI e2e states `LABEL_OS_ENABLED: 'false'`; all 20 default specs kept |

### Also on the branch
- **PORTAL-UP** #135 (96e9d94e5, migration 191): contacts upload into a project through their portal link. Not a backlog task.
- #147 (6034329f5): `next` 16.3.8 → 16.4.3 (critical RCE advisories).
- Docs/status PRs (#126, #133, #136, #138, #141, #144, #151, #155, #157, #161, #163, #164, #167, #171, #173, #177, #179, #183) carry no code.

## 2. Decisions taken

Owner decisions are binding; orchestrator choices are marked.

1. **Two faces on existing kinds** (doc 23 §owner decisions). Independent = `artist` kind, label = `label` kind, `producer` kind stays the studio's own org. No module barred for either face; faces differ in layout later (2026-10-17).
2. **Seats as built** (members whose role is not `artist` plus pending such invitations); the **artist cap counts artist-role contacts only** — a project link alone is "just a link" (2026-10-17).
3. **Self-serve sign-up stays**: #130 is the owner's own task, gated and merged by the orchestrator; LABEL-48/50 build on it. An org created at sign-up has every module; default limits are chosen later with plans and prices (2026-10-19).
4. **The artist has the final say** on store listing; with several artists, any one "no" withdraws (orchestrator's choice under delegation). Only a role-`artist` member scoped to the contact, or the owner of an artist org (its self artist), answers for an artist; a party's linked account never does.
5. **Go-live** (2026-10-19): integrate the Label OS branch into main, apply migrations through one SQL-editor bundle, then switch `LABEL_OS_ENABLED` on; the producer account must not change. The phase-2 backlog continued on the Label OS branch.
6. **Models**: sessions already on Opus stay on Opus, every new child runs Sonnet 5.5. Every PR is verified in a running app (fresh local stack with all migrations) and on the Vercel preview (production database: Label OS must 404/degrade, never 500).
7. **Delivered releases** cannot be cancelled, only withdrawn; a song on a draft release stays `working` until delivery (gates are derived in TS and cannot be mirrored in SQL; routes are the stricter side until 193 lands) (2026-10-27).
8. **Migration numbering**: 177, 185 and 188 released; 194 (not 185) so LABEL-68 sorts after 187; 195 shared by 74/75; 189/190 are #130's, 191 PORTAL-UP's, 192 LABEL-48's, 196 LABEL-76's. The next free number outside the backlog is 197.
9. **Signatures are in-app, not qualified e-signatures**; the page says so and carries an optional external provider URL (no integration). A signature whose hash is not the contract's frozen hash does not count, derived on read.
10. **A party's linked account is not trusted** to sign or read statements on its own: signing needs a link made by someone else plus the party's own confirmation (`user_linked_by`, `details_confirmed_by`). This is why collaborator self-view of statements is not granted.
11. **Re-import of a file with the same bytes returns the original import**; dedupe is on bytes only (orchestrator, LABEL-62).
12. **Release cost = marketing budget lines `spent` only**, and the page says so (orchestrator-accepted deferral, LABEL-64).
13. **Producer orgs keep a releases page** (`role-view.ts`), orchestrator decision in #181.
14. **E2E**: keep all 20 default specs (286 tests, 8 skipped), delete none; the local gateway backdates `deleted_at` only for a request with the test-only header `x-e2e-org-cleanup: 1`.
15. **Accepted deviations**: change-then-event with put-back where no atomic function exists (withdraw, consent, contact delete; best-effort `release.store_unlisted` after a withdrawal); the signed-master-sheet drift gate checked in Node, not under the contract lock in SQL.

## 3. Found, not fixed

Collected from the "Found, not fixed" / follow-up sections of the merged PR bodies (#127–#184; #185 has none) and the execution log. Items the backlog assigned to a later task and that task merged are marked **→ closed by** (per the backlog assignment; the child's own PR is the proof). Severity: **H** a rule that can be bypassed or data that can be wrong; **M** a gap a user or operator will hit; **L** polish, hygiene or a documented residual.

### 3.1 Security, privacy, rights data
| Sev | Item | Source | Status |
|---|---|---|---|
| H | `split_lines.signature_asset_id` / `signed_by` readable by an own-line reader on their own JWT | #129 | **→ closed by LABEL-75 (195)** |
| M | No "party accepts an invitation to link its account" flow; a rights writer links an account, so a member can link a different account they control. The rule is "someone else's link + the party's own confirmation", not a proven invitation | #166 | open |
| M | A non-`label` party on the org's own side (NDA, licensor…) cannot be countersigned by capability; it signs through its emailed link | #166 | open (by design, confirm) |
| M | Org search identifier jump (`ipi=`) returns a party name to a roster artist who guesses an IPI | #148 | open |
| M | Self-approval check is skipped once the generator's account is deleted (`created_by` NULL): anyone with `finance.approve` may approve that statement draft | #174 | open |
| M | `approvals_member_read` (157) not extended to `creative.approve` holders (reads go through service-role routes); extending must also subtract `departments_off` | #176 | open |
| L | Org export omits budget-line `note`; plan free text is kept | #170 | accepted |
| L | Payee names on statement PDF/CSV are display names, never legal names | #174 | by design |
| L | Press kit has no teaser audio pre-embargo | #172 | by design |
| L | CDN window: a consent "no" is seen by routes at once but cached public JSON can persist up to ~90 s | #159 | open (existing LABEL-42 window) |

### 3.2 Concurrency and atomicity
| Sev | Item | Source | Status |
|---|---|---|---|
| H | Readiness-vs-claim window for deliver and store listing | #131 | **→ closed by LABEL-73 (187)** |
| H | Role-change seat cap, contact-add artist cap and 154's connection accept skipping `max_artists` are check-then-write | #132 | **→ closed by LABEL-73 (187)** |
| H | Approval rule 2 (addressee) and `seen` enforced in the route only; `labelos_audit_approval_decide` re-checked only self-approval | #139 | **→ closed by LABEL-73 (187)** |
| M | `has_org_cap` ignored `departments_off`; settings audit `from` read before the lock | #137 | **→ closed by LABEL-73 (187)** |
| M | `contract.sent` is not atomic with the status change (no function); a failed audit logs loudly and answers 500. A `labelos_audit_contract_send` function would fix it | #158 | open |
| M | Collaborator intent stored in `org_invitations.functions` in a second statement after the audited insert; a crash between the two leaves a live plain invitation that blocks re-inviting that address until it expires. A real column passed into `labelos_audit_project_invitation_create` would fix it | #175 | open |
| M | Withdraw, consent and contact-delete routes still use change-then-event with put-back; the put-back runs in the unsafe direction only for a no/Unlist, which stands and says it was not recorded | #168, #159, #156 | open (accepted deviation) |
| M | Fingerprint scope: song-level credits/splits/legal and `settings` are not covered (a changed split stales the legal approval on read) | #168 | open |
| L | Plan size caps (60 milestones, 40 budget lines, 40 requests) are count-then-insert; two writers can exceed by a row | #170 | accepted |
| L | Signed-master-sheet drift gate checked in Node before the signing function; a sheet signed between check and signature is a residual | #166 | accepted |
| L | If the signing audit RPC throws, an uploaded drawn PNG is orphaned until the org purge | #166 | open |
| L | Members route six-argument `p_expect` fallback kept (167 may not be pasted); stale schema cache can skip the comparison once | #131, #168 | open, remove after 167 is applied |
| L | Restore grace is 30 days in both SQL (`interval '30 days'`) and TS `GRACE_DAYS`. Purge vs the new organizations trigger can hit a boundary by clock skew of seconds; it surfaces as `kept` and retries next day | #168, #182 | accepted |
| L | Share view counter is read-then-write (approximate) | #172 | documented |
| L | `has_org_cap` in 187 is a full copy of 171 plus a step; any redefinition must start from 187's text | #168 | doc'd in 28 |

### 3.3 Scale and performance
| Sev | Item | Source | Status |
|---|---|---|---|
| M | The finance dashboard reads every release, line and allocation of the org even for scoped members (filtered after). An SQL aggregate is needed at large catalogues | #180 | open |
| M | `GET /finance/statements` unpaged (all statements + lines for staff) | #165 | open (LABEL-63 may have addressed; verify) |
| M | Full-playback derivatives are cut inside the list request (≤3 ffmpeg jobs, `maxDuration` 300, whole master in memory); a long tracklist may need a background job. A release listed `full` before #162 has no derivative until re-listed (404 until then) | #162 | open |
| L | Org search orders candidates alphabetically (PostgREST cannot order by `ts_rank`): an exact-title hit after 40+ visible matches is not read; an RPC with relevance ordering would fix it. Scoped contact search uses an unchunked `.in()` of the member's artist list | #127 | open |
| L | The artwork size is read from the file head on every readiness read; storing width/height at upload needs a migration | #139 | open (#185 read further, still per read) |
| L | The creative workspace evaluates the 50 newest draft releases only | #176 | accepted |
| L | Follow-up requests in the wizard run sequentially (≤ ~40 calls) | #143 | accepted |

### 3.4 Product gaps and decisions still open
| Sev | Item | Source | Status |
|---|---|---|---|
| M | **Showcase ("greatest moments") not built**: no public surface or table exists | #159 | open, needs a product call |
| M | Artists with no account cannot say no; a credit confirmed **after** a listing does not notify that artist | #159 | open |
| M | **Collaborator/producer self-view of statements not granted** (needs the `user_linked_by` + `details_confirmed_by` identity); no notification to the artist when a statement is issued (needs a new closed-union kind) | #165, #174 | open |
| M | Marketing/PR have no org-level pages (no hubs or tiles); department staff (role `member`) still land on the label Overview (`roleViewFor` returns `'department'` for a later home) | #178 | open, agreed |
| M | "Approvals waiting" covers release gates only; song-level `legal` is the legal queue | #184 | open |
| M | Pipeline undercounts early stages for a reader without `audio.working` (the executive role holds only `audio.finished`); the page says how many. Showing counts regardless of audio class is a product decision | #184 | open, decision |
| M | Earnings lines match only through ISRC/UPC; no manual "assign this line to a song" (fix the ISRC and re-run). No way to give an import a period afterwards. Imports touching an approved/issued payee-period are refused (`statement_exists`) | #169, #174 | open |
| M | Setup wizard stores only 8 contract-type ids (192's function holds the list) though 14 templates exist; widening needs 192's functions changed | #154 | open |
| M | Contract version history records which clauses changed, not the previous text (needs a snapshot table). PDF uses WinAnsi fonts: non-Latin names print as `?` | #158 | open |
| M | Contract asks cannot offer a signing link (only its hash is stored); a "resend my signing link" action needs the party's own authenticated route | #175 | open |
| M | Metadata gate and the ERN-style export do not yet emit territories, language or distributor; no release-level `explicit` | #150 | open |
| M | Org songs have no uploads-tray editor (song page only); no ISRC uniqueness within an org | #142 | open |
| M | A negative or zero net statement owes nothing and is not carried forward | #174 | open, decision |
| M | Distribution template has `licensor`/`provider` and no `artist`, so a distribution rate goes to the licensor | #169 | open |
| L | Roster artist cannot mark a marketing request "received" in-app | #170 | accepted |
| L | The plan-requirement switch is a separate route/function, not a key in `PATCH …/settings` | #170 | accepted |
| L | Press contact has no dedicated create screen (members page → Add collaborator → Press contact) | #172 | open |
| L | Single function in the "add member" form; collaborators are stored as category `other` so they are never on the roster | #145 | open, confirm |
| L | A person holding several functions counts under one department in the exec dashboard | #184 | open |
| L | Release cost shows marketing spend only | #180 | accepted |
| L | Needs-attention, saved-view filters and the legal queue know five gates only (creative is the sixth) | #176 | open |
| L | `disputed` split-sheet status exists in the vocabulary and guards but no route sets it | #148 | open |
| L | Deleting an artist contact with a consent row is 409 (no cascade, so a "no" cannot be erased) | #159 | by design |
| L | Console-created independent org has no artist email until the owner fills it in | #132 | open |
| L | Existing `org.created` rows cannot be promoted to audit-class (163 forbids it); the prune skips the verb so they are kept anyway | #182 | accepted |

### 3.5 Tests and infrastructure
| Sev | Item | Source | Status |
|---|---|---|---|
| M | `contract-editor.test.ts › a sent contract is served as it was sent` failed on the base branch alone (empty PDF text in that environment) | #160, #162 | status unknown; rerun on the final head |
| M | Real-DB full-suite runs on one dev server degrade late; run in chunks or restart partway. No runner built. `label-org-team-roster` #1 and `store-bridge` #3 each failed once in full runs and passed in isolation (environmental, not proven) | #181 | open |
| M | `label-org-store-bridge` test 5 expected `s-maxage=30` where LABEL-71 made the list `no-store` for a consent-governed release; updated in #162 | #160, #162 | fixed |
| M | "Approve statements" switch outside the viewport and the Escape-in-A&R-note race were product bugs; fixed with `fitPanelTop` and a ref in #181. `ui/Popover` still fits only once at open (growth, resize or scroll are not refit) | #181 | partly fixed |
| L | `clickWhenHydrated` relies on React 19's internal `__reactProps$` key; `memory-db` stamps can run ahead of wall clock under a burst | #181 | open |
| L | The CI skip-count comment is prose only; nothing fails when it drifts | #181 | open |
| L | Real-DB runs rewrite tracked screenshots under `e2e-artifacts/` and `data/db.json`; easy to commit by accident (`data/orgs/`, `e2e-artifacts/` are not fully in `.gitignore`) | #132, #143, #150, #181 | open |
| L | 21 local check files + 137's rollback needed a `deleted_at` backdate for 195; any new check that deletes an org must do the same; other specs' `afterAll` still delete directly | #182, #184 | accepted |
| L | `npm run build` fails locally without `RESEND_API_KEY` (and the Supabase env); CI sets stubs | #132, #139, #170 | known |
| L | Rollback SQL for 168 duplicates 159/168 definitions by design | #127 | accepted |
| L | `contacts.org_self_artist` appears in `select('*')` contact reads incl. producer CRM JSON and the org export (always `false` on producer rows); `isDuplicateEmail` treats any 23505 on contacts as an email clash except 166's index | #131 | open |

### 3.6 Docs and hygiene
| Sev | Item | Source | Status |
|---|---|---|---|
| M | `CLAUDE.md` / `MIGRATIONS.md` "next migration" sentences drift every time a task merges (orchestrator-owned); re-checked in LABEL-78 against `ls supabase/migrations`: highest on disk is 196, next free outside the backlog is **197**, and both files say so | #128, #129, #165 | correct today |
| L | `18-test-roadmap.md` said an added song leaves Unreleased immediately; now only once the release is delivered | #156 | refreshed in LABEL-78 |
| L | The members page still shows department capabilities as switches (group under each department) | #134 | open |
| L | Local checks like `labelos_org_hard_delete.sql` have no finance/contract rows; cascade proved in 176/179 checks | #154, #165 | accepted |

## 4. CI: the tsc heap fix

`.github/workflows/ci.yml` on `claude/happy-bardeen-rnosf3` **already has it**: the Type-check step runs `npx tsc --noEmit` with `env: NODE_OPTIONS: --max-old-space-size=4096` and a comment ("the whole-repo program is now ~2.3 GB (Label OS), over node's default ~2 GB heap"). `origin/main`'s workflow has the bare `npx tsc --noEmit`. **When the phase-2 branch is merged into main, take the branch's `ci.yml` for that step** or the type-check will die with "JavaScript heap out of memory". No PR into `main` was opened for this task.

## 5. Status housekeeping

- Doc 23 status lines for LABEL-67, 76, 77 were brought up to date in this PR at the orchestrator's request. LABEL-76 merged as a first slice; its PR body still lists CI, code review and the screenshot list as to do.
- Doc 23's LABEL-78 line names `25-phase-2-report.md`; the file is `27-phase-2-report.md`.
- `go-live.md` and `supabase/apply/labelos-go-live.sql` (go-live session) are not on this branch.
