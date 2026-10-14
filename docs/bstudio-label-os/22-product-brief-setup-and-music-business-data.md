# 22 — Product brief: setup screens, real music-business data, one app for the whole label

Owner direction of 2026-10-14 (voice message, transcribed roughly). This is a brief, not a build
order: nothing here is built or scheduled until the owner says go. It extends
`21-review-findings-and-decisions.md` and replaces its "H-1 / H-2" proposals with the larger
picture below. Interpretations are marked **(read as)** so the owner can correct them.

## 1. What the owner asked for

1. **The release gates must really improve.** ISRC, royalties/splits and the other information
   of the music business must be properly fillable in the app, not seeded by SQL.
2. **A setup screen that lets the account choose how the app is set up.** The owner gives the
   software to labels or to independent artists; **in function of the access the owner gives**,
   they choose their own setup screens. **(read as)** like the create-a-player flow in a sports
   career mode (NBA 2K): you start, choose what kind of account you are and what kind of contract
   you want to have, then a window lets you add artists and roles for the different roles.
3. **A label must be able to build its roster and run itself in the app** — an internal
   software, like a SaaS — so that nobody at the label has to use another application, in every
   department: marketing, legal, the "big bosses", public relations (PR), and so on.
4. **Split sheets and contracts are integrated:** the splits must be able to feed from / into the
   contract.
5. **Paid plans:** to be decided together later. Not part of this brief.
6. **The artist always has the final say.** The label can list "greatest moments" and the like on
   the store, but the artist's no wins.
7. **"Coffee" and "July" from the earlier message: ignore.** Dropped from the decisions list.

## 2. Setup flow (proposal, to confirm)

First run after sign-in, or "New organization":

1. **Who are you?** Independent artist · Producer · Label · Studio. The choices offered depend on
   the access the owner granted this account (the owner can restrict a licensee to one type).
2. **How do you work?** Pick the contract type(s) you use: recording agreement, distribution,
   licence, 360, producer agreement/work-for-hire, feature, co-publishing, management. The
   choice sets defaults for the split sheet and for which gates apply.
3. **Who is on your team and roster?** A window to add artists and members, with the role of each
   (artist, A&R, manager, legal, marketing, PR, producer, engineer, finance/admin). Roles map to
   the existing capability model (`lib/labelos/capabilities.ts`); this adds the missing "add"
   screens, not new permissions.
4. **Which departments do you turn on?** Marketing, Legal, PR/press, Distribution/Releases,
   Calendar, Store. A preset per account type; each can be switched.
5. **Review and create.** Creates the org, the roster, the default gates and the first draft
   release if wanted. Everything stays editable in Organization settings (the settings screen the
   review already found missing: `legal_gate`, `marketing_gate`, `require_signed_master_split`,
   thresholds).

What the owner grants (account type ceiling, which departments exist, plan later) is one
server-side entitlement per org, read by `navGroupsFor` and `requireOrgCapability`. Plans plug
into the same place.

## 3. Real music-business data (what must be fillable)

| Area | Fields | Today |
|---|---|---|
| Recording | title, version, ISRC, BPM/key, language, explicit, genre, recording date, P-line, master owner | read-only in the org; ISRC unreachable |
| Composition | ISWC, writers with shares, publisher(s), PRO (ASCAP/BMI/SACEM...), IPI/CAE, sample declarations | credits and splits exist; ISWC/IPI/PRO partly; no parties page |
| Release | UPC, release title, type, label, C-line, territories, release date, tracklist, artwork, distributor | create-release missing; metadata gate cannot be satisfied |
| Rights/splits | master split, publishing split, points, recoupment, advance, term | split sheets (master/publishing) exist; no contract link |
| Contracts | type, parties, term, territories, signed document, link to split sheets | missing |
| Parties | legal name, address, tax id, PRO, publisher, bank/payee (later) | partial (IPI/legal name) |

Rule kept from the review: a gate is satisfiable only if a human can satisfy it in the UI. Every
new field needs its editor, its validator (ISRC/ISWC/UPC/IPI checks already exist), its audit
event and a role that may write it.

## 4. One app for the whole label — honest module map

| Department | In the app today | Missing for "no other app" |
|---|---|---|
| A&R | inbox, reviews, stages, direction | tags/assign bulk, review panel on song page |
| Legal | readiness, approvals, handoff pack, split sheets | contract builder/templates, e-signature, contract store, samples declaration for legal |
| Marketing | marketing gate, calendar, store bridge | campaign plans, asset requests, asks flow beyond comments |
| PR / press | none | press kit, contacts for press, outreach tracking |
| Releases / distribution | releases board, delivery, metadata CSV | create release, distributor hand-off, UPC/ISRC assignment helpers |
| Finance | none | statements, royalties, advances/recoupment, payouts (large; separate decision) |
| Management ("big bosses") | Overview, digest, attention, activity | cross-roster reports, approvals dashboard, exports |
| Store | producer store, release listing | artist consent step, "greatest moments" showcase |

The finance/royalty module and the contract e-signature are the two large items; each is its own
project and should not be started inside the setup work.

## 5. Artist has the final say

Extends decision A of doc 21: the label may list a release (or a "greatest moments" showcase) on
the store, the artist is notified and **their no is final**: listing is withdrawn and cannot be
re-listed without the artist's yes. **(read as)** consent is recorded per release/showcase and per
artist; for a release with several artists, any one artist's no withdraws it from the store.
Needs: a consent record (migration, doc 21 row 172), a notification kind, a decline action, and the
store-owner list "Releases from connected artists".

## 6. Proposed build order (needs the owner's go; each item is one task = one session)

| # | Task | Why first |
|---|---|---|
| A | Migration 163 (split-sheet column grants) | closes the D2 leak; tiny |
| B | Song/recording editor + default master (ISRC, ISWC, credits, IPI/PRO) | unblocks the metadata and master gates |
| C | Create organization, add artist/member with role (the "roster window") | needed before any label is onboarded |
| D | Setup wizard with account-type presets + entitlement skeleton | the owner's "choose your setup" |
| E | Create release + gate improvements (all seven satisfiable in the UI) | the release flow end to end |
| F | Contract types + splits integration (contract record, link to split sheets, defaults by type) | owner item 4 |
| G | Artist consent on store listing + highlights showcase | owner item 6 |
| H | Atomic deliver and the rest of the migration pack (doc 21 section 4) | owner asked for atomic |
| I | Role views (artist home, artist org shell) | owner's three views |
| later | Plans (with the owner), PR module, finance/royalties, e-signature | separate decisions |

Cost note: the account's weekly usage limit has about 7% left and resets **Friday 2026-10-16
21:00 UTC**. Starting builds before that risks sessions dying mid-task. Suggested: no build
sessions until the reset, then A–C first.

## 7. Questions only the owner can answer

1. Account types the owner will license: artist / producer / label / studio — is that the list?
2. Contract types that matter first (recording, distribution, producer, feature, 360?).
3. Is "the artist's no is final" per release and per showcase, and does one of several artists
   withdraw it for all?
4. Finance/royalties and e-signature: in scope for the first label customers, or later?
5. Which departments does the first label customer actually need on day one?
