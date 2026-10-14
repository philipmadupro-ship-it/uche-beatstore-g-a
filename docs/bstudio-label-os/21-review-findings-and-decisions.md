# 21 — Independent review: findings, fixes, decisions

Written by the orchestrator on 2026-10-14, after all 42 backlog tasks (LABEL-01..42) were merged
into `claude/happy-bardeen-rnosf3` and ten independent reviewers (G1..G10, prompt in
`19-independent-review-prompt.md`) re-checked them. Nothing here was merged to `main`.
Test roadmap for the owner: `18-test-roadmap.md`.

Nothing in this file creates a migration, a screen or a feature. Section 6 lists what is proposed;
the owner says which of it to build.

---

## 1. What was reviewed and what came out

| Group | Tasks | Result | PR |
|---|---|---|---|
| G1 | 01–06 decisions, capabilities, org core, RLS guards, access helpers, API gate | Pass, 4 small fixes, 2 need a migration | #116 (merged) |
| G2 | 07–11 personal org, invitations, shell, roster, songs/links | Pass, returning-member landing fixed | #119 (merged) |
| G3 | 12–15 catalogue RLS, org audio, org upload, org assets | Pass, 3 fixes (one High) | #117 (merged) |
| G4 | 16–19 releases, workspace, Overview, events | Pass, paging/chunking + ISRC fixes | #118 (merged) |
| G5 | 20–24 feeds, external members, comments, tasks, stage machine | Pass, **no defects found**, no PR | — |
| G6 | 25–28 reviews/A&R, direction, parties/credits, split sheets | 3 passes, **LABEL-28 fails D2** (needs migration) | #121 (merged) |
| G7 | 29–33 legal readiness, approvals, handoff, release readiness, release board | Pass with fixes, release gates had **no UI** | #123 (merged) |
| G8 | 34–38 feeds/calendar, attention, search, saved views, weekly digest | Pass, digest starvation fixed | #122 (merged) |
| G9 | 39–42 export/deletion, retire team flow, connections, store bridge | Pass, export + restore race fixed | #120 (merged) |
| G10 | cross-cutting: merged state, roles/views, beatstore regression, persona runs | Pass on merged state; **fails a real-user journey** (H-1, H-2) | #124 |

**Merged state check (G10 Step 0, on the head with all eight fix PRs):** `tsc` clean, lint clean,
515 test files / 8674 tests pass, build passes, store-dynamic guard passes, `db:local:check`
passes (every migration twice, all checks, parity, rollbacks), `e2e:real-db` 132 passed first run;
the 7 failures were cold-dev-server timeouts and all pass at a 25 s expect timeout. **No semantic
conflict between the nine merges.**

**Original beatstore with the flag off vs on (G10):** 59 URL × persona probes identical except the
Label OS paths. The default Playwright suite shows 47 failures with the flag off, and the same 47
fail on `origin/main` (stale specs: collection covers, shared covers, store content sections,
storefront hero, track menu). `ci.yml` does not run that suite.

---

## 2. What was fixed (all merged, each with a test that failed first)

**Security / data exposure**
- G3 (High): producer routes `tracks/[id]/similar`, `tracks/tags`, `tracks/tags/bulk` reached org
  songs through the `user_id IS NULL` arm, so any producer could read every org's songs and tags
  and edit tags on an org song. Now filtered by `lib/auth/producer-rows.ts#withoutOrgRows` (#117).
- G3: a playlist accepted any track id, so an org song could reach the public store; now only the
  caller's own tracks (#117).
- G3: a restricted file could be downloaded without an audit event by sending a `Range` header;
  every streaming request is now audited (#117).
- G1: a roster artist could list the label's other artists via `GET /members`; fixed in the route
  (#116). G10 found the same leak for staff limited to some artists, in `GET /members` and in the
  task-assignee list; one rule `mayListMember` now decides both (#124, pending).
- G1: proxy matcher skipped Label OS URLs ending `.png/.js/.css/.map`, so the kill switch and
  membership gate did not run on them; fixed (#116).
- G1: the RLS replay guard accepted `USING (true OR org_role(...) IS NOT NULL)`; fixed (#116).

**Correctness / scale**
- G4, G6, G8: unpaged reads silently cut at PostgREST max-rows (1000) and long `.in()` lists
  overflowing the URL, in scope lookups, releases, workspace, A&R inbox, reviews, parties, credits.
  One shared `lib/labelos/paged-read.ts` now serves all of them (#118, #121).
- G8: the weekly digest could starve every other org if 50 Slack channels were stuck; channels are
  now walked with a cursor (#122).
- G9: org export omitted parties, credits, split sheets, approvals, direction, references and
  connections; added, with a drift test that fails when a new org table is not exported (#120).
- G9: restore could undo a purge already in progress; restore now also requires the grace period
  not to have ended (#120).
- G4: `normalizeIsrc` turned non-ISRC text into a valid-looking code (ß→SS); fixed (#118).
- G10: choosing "full" playback on a release could be reset to "preview" if the page loaded twice
  (StrictMode), so "Put on the store" listed the wrong playback; fixed (#124 pending).
- G10: four sibling sections on the song page shared one React key; fixed (#124 pending).

**Release flow**
- G7: no release could become ready through the app. The approvals panel existed only on the song
  page; the release page now mounts it, so Masters, Artwork, Metadata, Marketing and Legal gates
  can be requested and approved (#123).
- G7: Metadata approval did not go stale when ISRC, explicit flag, version title or primary artist
  changed; it does now (#123).
- G7: an approver could approve something they had not seen (a colleague circulating a new split in
  between); the screen now sends what was seen and the server answers 409 `changed_since_seen` (#123).

**Front door**
- G2: a returning member who is not a producer was sent to the buyer account from `/` and `/login`.
  They now land in their label, and `/o` is a real page (one org opens, several are listed,
  shared-only goes to `/shared`) (#119).

---

## 3. Product gaps (not defects; the app does not do these yet)

1. **No screen creates an organization, adds an artist to a roster, or starts a draft release.**
   `POST /api/org` does not exist; the releases board only offers "Add released music". (G2, G10 H-2.)
2. **Two of the seven release gates cannot be satisfied by a human.** No route or screen edits a
   song's ISRC/ISWC or other recording fields, and the tracklist row has no master chooser, so a
   song added to a release always goes out as "the song's own mix, not a master". `readyToDeliver`
   is unreachable; the only human path is the owner's audited "Deliver anyway". The existing e2e
   missed it because it seeds ISRC and master with the service key. (G10 H-1.)
3. **Org settings switches have no screen:** `legal_gate`, `marketing_gate`,
   `require_signed_master_split`, the attention thresholds. Only SQL writes them. (G7.)
4. **No plan / billing / entitlement logic anywhere.** Org kind only changes invitable roles and
   functions, the producer-org nav, Connections, deletion and store-listing eligibility. (G1, G10.)
5. **Producer, artist and label do not feel different.** One shell; a label org and an artist org
   get the same hubs, the artist-org owner sees an A&R inbox and Legal queue, and a roster artist
   has no "my music" home. `KIND_CEILING` is a no-op: every org kind holds the same capabilities.
   (G1, G2, G10 M-2, M-3.)
6. **Smaller:** no parties page, no credit withdraw, no review panel on the song page, no
   tags/assign bulk actions in A&R; the artwork size rule of spec 09 §4 is not implemented; a
   delivered release can be neither deleted nor cancelled although the delete message says "cancel
   it instead"; the buyer account page has no link to a label; the producer-account deletion is not
   in Settings; Overview at 390 px drops the stage counts and next release, and at 1440 px the
   "SELECTED" header overlaps "NEXT RELEASE" (`OrgOverviewView.tsx:40`); every Label OS panel is
   hard-coded dark, so the light theme is unreadable.
7. **Flag off is not fully inert:** `POST /api/profile` calls `ensurePersonalOrg` whatever
   `LABEL_OS_ENABLED` says, so once 136/137 are applied a producer save writes an org and an
   `org.created` event. (G2, G10 M-5.)
8. **A label's own releases can never be on the producer's store** (only the studio org, or an
   artist org connected to a label the store owner owns), and the studio org has no way to add an
   artist. (G10 D-7.)

---

## 4. Migration pack (all proposed, none written)

Numbers are proposals; the next free number today is **162** and nothing is reserved. Every one of
these is applied at the final merge together with 136–161, never through `supabase/apply/pending.sql`.
Each needs a `supabase/local/checks/NNN_*.sql` proving it as `anon`/`authenticated`, and a rollback.

| # | Proposal | Why | From | Priority |
|---|---|---|---|---|
| 162 | Search tokenization: `translate(file_name, '_.-@/', '     ')` in the generated tsvector columns; `[\p{L}\p{M}\p{N}]+` in `org-search.ts` `WORD` | `mix` finds nothing in `final_mix.wav`, `x com` nothing in `a@x.com`, Hindi/Thai words break | G8 F2 | Medium |
| 163 | `split_sheets`: `REVOKE SELECT` from `anon, authenticated`, column-level `GRANT` without `note`, `created_by`, `circulated_by`, `document_asset_id`; check asserts `note` is unreadable for an own-line reader | **D2 breach**: an own-line producer/engineer reads the negotiation note with their own JWT | G6 F1 | **Blocker for D2** |
| 164 | `org_members_member_read` and `user_profiles_self_or_co_member_read`: a caller whose role is `artist` reads only their own row and non-artist rows; uncorrelated (R-08); staff limited to some artists do not read artists outside their list | A roster artist's own JWT still lists every co-member, name and `last_seen_overview_at` | G1 F1 | High |
| 165 | Trigger refusing UPDATE and non-cascade DELETE of `audit = true` rows (service role included) | "Never deleted" becomes a database fact | G1 F6 | Medium |
| 166 | `playlist_tracks` same-owner / same-org trigger | No route or direct writer can join an org song to a producer playlist | G3 | Medium |
| 167 | Partial unique index: one artist contact per artist-kind org | Single-artist rule (D1) is check-then-insert | G2 | Medium |
| 168 | `release_items` lock: extend `release_items_store_lock` (158) to refuse add/remove on a non-draft release (exempt `imported_released AND NOT store_listed`), take `FOR SHARE` on the release | Tracklist can change between readiness check and deliver | G4, G7, G10 | High (with 170) |
| 169 | `labelos_audit_member_update`: compare expected old values | Stale plan can overwrite a concurrent change | G4 | Low |
| 170 | **Atomic deliver:** `labelos_audit_release_deliver` (row lock, expected fingerprint, state change and audit in one transaction), per `20-review-G7-atomic-deliver.md` plus G10's amendments: pass `releases.updated_at` as the raw PostgREST string; fingerprint covers release-subject approvals only (song-level credits/splits/legal and `settings` are not covered); add `AUDIT_RPCS` entry, `AuditRpcArgs` type, a check proving the four G7 cases, a rollback. **One migration should also cover** `release.imported`, `release.store_listed/unlisted`, org delete/restore/export and the digest Slack channel verbs, which today write the change and then the event with a best-effort undo | Owner asked for atomic | G7, G9, G10 | High |
| 171 | Per-org `last_seen_overview_at` (today one value per user) | "Since your last visit" is wrong across orgs | G5 | Low |
| 172 | Store listing consent for artist-org releases: a way to record the artist's "no" (see section 5, decision A) | Owner decision A | G9, owner | Needed for decision A |

Rule from CLAUDE.md still holds: check `git log --all -- supabase/migrations/` before naming.

---

## 5. Decisions

Three kinds, kept apart so nothing is mistaken for the owner's word.

### 5.1 Owner decided (voice message 2026-10-14, transcribed roughly; read in good faith)

| | Decision | What it needs | Your confirmation |
|---|---|---|---|
| A | **Listing an artist org's release on the producer store:** the label owner may list it; the artist receives a notification and can say no (unlist / veto). | A new closed-union notification kind in `lib/labelos/notify.ts`, an artist-side decline/unlist action, a store-owner list "Releases from connected artists" with Unlist, a place to record the artist's no (migration 172). Say so on the connection-accept screen. | |
| B | **Full playback is an option chosen per release** and can be switched back to the short preview every time. | Already true that the choice is per release; G9/G10 findings below say it is not tied to release state. | |
| C | **Roster artists may see the splits for now**, but a label has many artists, so each artist sees only their own songs. | Scope already applies; the PII question below narrows what "splits" includes. | |
| D | One item ("coffee" in the transcript) the owner does not care about. | Unclear which item; handled by my choice below. | |

The remainder of the message was "the rest I don't understand, choose as best you see fit", which I
treat as delegation for 5.2. The owner's first answer on open decisions had been "no, you can't";
this later message replaces it for the items in 5.2 only.

### 5.2 Decided by orchestrator under that delegation — change if you disagree

| # | Item | My choice | Source | Your confirmation |
|---|---|---|---|---|
| 1 | Default playback | `preview` until the release has gone out; then `full` only if the owner picks it. G9/G10 add: allow `preview`-only listing from delivery (teaser), allow `full` only from the release date, fall back to `preview` if the date moves. | G9, G10 D-6 | |
| 2 | What `full` streams | A lossy full-length derivative, never the stored master (today `full` streams the master, so one `Range: bytes=0-` is a free lossless download); durable per-IP limiter (`rateLimitDurable`, mig 074). | G9 | |
| 3 | Listen-only external roles (viewer, commenter) | Stream a lossy full-length derivative; never the master; downloads need role + `allow_downloads`; `variant=full` counted and audited like a download if it is the master. | G5 | |
| 4 | Split detail for roster artists | Names, roles and shares only. Co-writer legal name/email/ISNI/PRO/IPI and the sheet `note` are hidden from role `artist`. | G6 F5 | |
| 5 | `legal_gate = off` | An explicit, audited skip, owner-only switch; skips only the legal *approval* (`credits_splits` still gates). | G7 B | |
| 6 | Settings screen for the three gates | Build an owner-only, audited settings screen (follow-up, needs your go). | G7 B | |
| 7 | `org.created` retention | Audit-class, never pruned. | G9 | |
| 8 | Purge cron | Time budget of 45–60 s per run, continues next day. | G9 | |
| 9 | "N restricted" counts | Shown to whole-org staff; hidden from role `artist` and from staff limited to some artists. (Reviewers G7, G8 recommended dropping or hiding it for scoped members; I went one step past what I told you in chat.) | G7 D, G8 D1 | |
| 10 | Slack channel digest | Built from artist-visible, non-restricted items only; warn at share time that a saved shared view's name is visible to every member. | G8 D2 | |
| 11 | Songs on a draft release | Stay "working" until the release is ready (not "finished" music). | G4 | |
| 12 | Delivered release | Cannot be cancelled; can be withdrawn/unlisted, audited; fix the delete message. | G4 | |
| 13 | Song-level vs release-level legal approval | Keep release-level; hide the song's Approve button once the song is on a release and say so in the UI. | G7 A | |
| 14 | "Approved" must carry `seen` | Required for the screen and for API callers. | G7 C | |
| 15 | Self-approval | Require an open request addressed to the decider (owners/admins exempt). | G7 E | |
| 16 | Front door for returning members | Keep the `/o` landing from #119. | G1, G2 | |
| 17 | Sole owner deleting their account | Blocked with "transfer ownership or delete the organization first". | G1 F8 | |
| 18 | Forbidden pages for a roster artist | 404 for pages, an explanatory line only for settings. | G10 D-3 | |
| 19 | Producer save when flag is off | Gate `ensurePersonalOrg` on the flag, so "flag off ⇒ nothing changes" is true. | G10 D-5 | |
| 20 | Differentiated views | One shell, separate Producer / Artist / Label views by kind and role (artist org: no A&R inbox / Legal queue / roster wording, a one-artist Overview "your songs, releases, open asks"; roster artist home "My music"; label keeps the current shell). Follow-up, needs your go. | G10 D-1, owner note | |
| 21 | Plans | `organizations.plan` + server-side `orgEntitlements(org)` AND-ed into `requireOrgCapability`, read by `navGroupsFor`. Decide first what is metered (seats, storage, connections, Slack digest, export). Not built. | G10 D-2 | |
| 22 | PRs #73 and #2 | Target `main`; stay unmerged. | — | |

### 5.3 Still yours (I did not decide these)

- **Which of section 3 and section 4 to build, and in what order.** My suggested order, for what it is worth: 163 (D2 blocker) → H-1 (song/recording editor, default master) → H-2 (create org / add artist / new release) → 170 with 168 (atomic deliver) → 164/165 → decision A (artist veto) → role views and plans.
- **What is metered** under plans (decision 21).
- **Decision A's exact shape**: does the artist's "no" hold the listing until they answer, or does the listing go live and the artist can pull it? I read it as the second (listed, notified, can say no); tell me if it is the first.
- **A label's own releases on the producer store** (G10 D-7): confirm they should not be listable.
- **Unclear transcript pieces:** "coffee" and "July" in the voice message. Treated as above; tell me what they meant.

---

## 6. Low-severity findings left open (no decision needed, listed so none is lost)

G3: audio-route classification runs 5+ queries per Range request and overflows the URL for a loop
linked from hundreds of songs; `stems`, `track_tags`, `rating_history`, `share_plays` keep a legacy
`is_team_member()` policy with no org guard (nothing writes `team_members`); `/api/store` keeps the
`user_id.is.null` arm. G5: comment lists ask for 2000 rows but hosted PostgREST caps at 1000; the
feed's `restricted` count can overstate across pages; task assignment has no rate limit; a comment
visibility flip races a concurrent reply. G6: the `references` cap count includes internal
references (an artist can infer they exist); renaming or re-linking a party after circulation
changes what an immutable sheet shows (decision: lock `display_name`/`user_id` once circulated);
signed PDFs are checked by extension only; party search applies `.limit()` before the scope filter.
G7: legal queue and release board run full readiness per item (latency at scale); the snapshot omits
samples and party legal data; the artwork size rule. G8: search takes 40 candidates per table before
the D4 filter with no ORDER BY; attention reads 50 draft releases ascending (long-past abandoned
drafts hide upcoming blocked ones); a digest claim can be lost if the function is killed between
claim and send; `org_digest_members` rows survive removal from the org (a re-invited member is
silently opted in). G9: public release routes are unthrottled except audio; CLAUDE.md says
`contacts.artist_org_id` is RESTRICT but migration 154 is SET NULL (SET NULL is correct);
`isLabelOsRestoreApiPath` is lower-case only; AGENTS.md still lists `team_members`. G10: the UI asks
and the server refuses (403s in the console for artist, marketing, engineer); `/o` has no app
chrome; Legal cannot declare samples (A&R must) though legal readiness needs it.

## 7. What no reviewer could verify

Reduced motion; screen-reader output; light theme beyond token inspection; Slack posting; digest
and buyer email (the local gateway has no auth-admin API); Stripe checkout; R2 (private previews,
waveforms, purge); production-mode CSP; EXPLAIN plans at scale (R-08); the artist-org → label
connection and store import chain through the UI (covered only by passing e2e); 5× flake reruns for
most specs. Run the relevant parts of `18-test-roadmap.md` yourself for these.
