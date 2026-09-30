# 03 — User Personas

**Discovery 01 · 2026-09-29**

Personas are grounded in the canonical label scenario (1 owner, 2 A&R, 1 project manager, 1 marketing, 1 legal, 5 artists, several producers, external collaborators) and in the A&R and credits research cited in `02-competitive-analysis.md` §3.

**Principle.** A persona is **not** a role in the database. Personas describe jobs. The permission model (`06-permission-model.md`) describes access. Several personas share a base role and differ only by *function* and *scope*.

| Persona | Base role (06) | Function | Scope | Account? |
|---|---|---|---|---|
| Label Owner | `owner` | — | Whole org | Yes |
| Admin / Operations | `admin` | operations | Whole org | Yes |
| A&R | `member` | `a_and_r` | Whole org, or assigned artists | Yes |
| Project Manager | `member` | `project_manager` | Whole org | Yes |
| Marketing | `member` | `marketing` | Whole org | Yes |
| Legal | `member` | `legal` | Whole org | Yes |
| Finance | `member` | `finance` | Whole org | Yes (future) |
| Artist | `artist` | — | Own artist workspace only | Yes |
| Artist Manager | `member` | `artist_manager` | Assigned artists | Yes |
| Engineer | external project member | — | Specific projects | Yes |
| Producer (in-house) | `member` | `producer` | Assigned artists/projects | Yes |
| Producer (external) | external project member | — | Specific projects | Yes, with their own BStudio org |
| External collaborator | external project member | — | Specific projects | Yes |
| Guest listener | none (token) | — | One share link | **No** (existing token shares) |

---

## Label Owner

- **Job:** know the state of the company without asking everyone, and decide where to spend money and attention.
- **Opens BStudio to see:** each artist's music by stage, upcoming releases and what blocks them, and what changed since yesterday.
- **Needs:**
  - A single overview with **exceptions first**: "3 releases blocked: 2 on legal, 1 on artwork".
  - An artist-grouped activity digest, not a notification stream.
- **Must not get:** a notification per upload.
- **Success signal:** answers "where is Artist A's EP?" in under 10 seconds.

## Admin / Operations

- **Job:** run the organization: members, invitations, access reviews, offboarding.
- **Needs:** a member list with role/function/scope; invitations with expiry; one-click revoke; "who has access to Artist A".
- **Risk they care about:** an ex-employee who still has access to unreleased music.

## A&R (×2)

- **Job:** find, evaluate and develop songs and artists; decide what moves forward.
- **Workflow (research-backed):** listen to a high volume of demos; shortlist; pitch internally; post-signing, pick songs, bring in producers/writers and book sessions; align the release plan with marketing. Sources: [Soundcharts](https://soundcharts.com/en/blog/what-does-ar-mean-in-music), [Orphiq](https://orphiq.com/resources/what-is-a-and-r).
- **Needs:**
  - A **listening inbox** (new demos across their artists) with keyboard-fast rate / shortlist / pass.
  - Region comments.
  - "Request changes" with a note.
  - Assigning a producer to a song.
  - A creative direction memory per artist.
- **Two A&Rs** means reviews are **per reviewer**: a second A&R's rating must not overwrite the first's.

## Project Manager

- **Job:** get releases out on time.
- **Needs:** a release board by gate; deadlines; task assignment; blockers named with owners ("Legal approval: Dana, due Friday").
- **Must not need:** to update status by hand. Gates derive from the data.

## Marketing

- **Job:** artwork, assets, campaign readiness for release dates.
- **Needs:**
  - Artwork and photo assets per release.
  - Marketing approval.
  - Release calendar.
  - Access to preview audio, full masters only when needed.
- **Should not see:** split percentages, contracts, finance.

## Legal

- **Job:** receive a complete handoff; approve or return with named gaps.
- **Needs:** **Legal Readiness** per song/release with named missing fields; split sheets with signature status; a document bundle; legal approval with a note.
- **Success signal:** zero back-and-forth emails asking "who's the publisher on track 4?".

## Finance (future)

- **Job:** reconcile advances, costs and royalties.
- **MVP stance:** out of scope. The `finance.read` capability is reserved so that finance data added later is gated from day one.

## Artist (×5)

- **Job:** make music, share demos with the label, see where their songs stand.
- **Needs:**
  - Upload demos into **their own workspace**.
  - See the stage of their songs and releases.
  - Confirm their own credits.
  - Comment on mixes.
- **Must not see:** other artists, other artists' releases, internal A&R ratings or notes marked internal, contracts of others.
- **Open decision D5** (`00-executive-summary.md`): may an artist see the A&R stage of their own songs? Recommended: yes for coarse stage (in review / in development / selected / passed), no for individual reviewer ratings.

## Artist Manager

- **Job:** represent 1–N artists to the label.
- **Needs:** artist-scoped access equivalent to the artist, plus release dates and tasks. Often external to the label, so this persona may be an **external member scoped to artists** (see 06, "scope").

## Producer: in-house and external

- **Job:** make and deliver music; get credited; get paid.
- **Canonical external example:** Producer A (label side) creates project *Uche × Producer X* and shares it with Producer X. X opens it via a secure invitation, signs in with their own account, and can listen, upload versions, edit metadata, add tags, add notes and add credits **in that project only**. It is one shared project, not a copy.
- **Needs:** upload new versions into the shared project; their contribution attributed to them; their credit visible and confirmable.
- **Keeps:** their own BStudio producer org, library and beatstore, unaffected by the label.

## Engineer

- **Job:** receive stems/sessions, deliver mixes/masters.
- **Needs:** download access to specific files; upload of new versions; a credit as mix/mastering engineer.

## External collaborator (writer, featured artist, videographer…)

- **Job:** contribute to one project and confirm their credit/split.
- **Needs:** minimal onboarding (a magic link), access to one project, and credit/split confirmation.

## Guest listener (no account)

- **Job:** listen and maybe comment: a pitch recipient, a friend, a playlist curator.
- **Served by the existing token shares** (`share_links`, `project_shares`, 4 variants). **Unchanged.**
- **Rule:** tokens may listen and comment; **only accounts may contribute** (upload, edit metadata, credits), because contributions must be attributable and revocable. See `06-permission-model.md` §5.

---

## Canonical scenario: what each persona sees on Monday morning

| Persona | First screen | Top of screen |
|---|---|---|
| Owner | Org Overview | "Needs attention: 3" · releases by gate · artists with activity since Friday |
| A&R (Sam) | A&R Inbox | 7 new demos across Artist A, C · 2 songs with changes returned |
| PM | Release Board | EP 2027 → blocked on Legal (Dana) and Artwork (Maya) · Single 01 → ready to deliver |
| Marketing (Maya) | Release Board filtered to artwork/marketing gates | 1 artwork approval requested |
| Legal (Dana) | Legal queue | Track 04: Legal readiness 82% · missing Producer IPI, publisher, signed split sheet |
| Artist A | Artist A workspace | Your songs by stage · EP 2027 target date · 2 comments on "Track 04 mix v3" |
| Producer X (external) | Project *Uche × Producer X* | Latest versions · comments on your upload · "Confirm your credit" |
