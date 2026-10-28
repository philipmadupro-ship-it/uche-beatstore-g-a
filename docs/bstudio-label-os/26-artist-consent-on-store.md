# 26 — Artist consent on store listing (LABEL-71)

Owner decisions A and E (doc 21 §5.1, doc 22 §5): **the artist always has the final say** on putting
their music on the store. Any one credited artist's "no" withdraws a release, and it cannot be listed
again until that artist says yes. The store owner has their own Unlist for music of connected artists.
Migration **186**, not applied (apply at the final merge). Without it the store behaves exactly as before.

## The state machine (`lib/labelos/store-consent.ts`, pure, Vitest first)

| | |
|---|---|
| Rows | `listing_consents (release_id, artist_contact_id, state)`: `proposed` → `yes` / `no`; `yes` ↔ `no`; never back to `proposed` (the database refuses it) |
| Who is asked | the release's own artist + every roster artist behind a **confirmed** credit on a song of its tracklist (not proposed / disputed credits, not engineers) |
| Silence | not a no. The release may be listed and serves while artists decide; their answer comes after (decision A) |
| A no | the release comes off the store **in the same request** (`store_listed` false, playback back to `preview`, previews kept unless the music was never out), and `planConsentGate` refuses to list it again until that artist says yes. With several artists, one no is enough |
| Who answers | only the artist's own account — never the lister, an owner, or A&R staff scoped to the same artist (see below) |
| Store owner | `store_listing_vetoes` row in the **label** org (the artist org is never written to, LABEL-41). Unlist / Allow again. Allowing lists nothing; a credited artist's no still holds |
| Public reads | `/api/store/releases`, `/[id]`, `/[id]/audio/[item]`, `/[id]/cover` all read `blockedByConsent` on **every request**, next to listed / released / store owner. A consent table that cannot be read fails closed (500); a table that does not exist (186 not applied) reads as "no rows" |

## Who is "the artist's account" (and who is not asked)

Only an account that IS the artist can answer — never one a writer could have typed in:

- **Artist org**: its **owner(s)** stand for its one roster artist (D1: the artist is the org; `contacts.org_self_artist`,
  migration 166). Admins and members (a manager) do not — a manager lists, the artist is asked.
- **Label org** (future-proof; only labels offer role `artist`, and label releases cannot be listed yet): a member whose
  role is `artist` scoped to the contact (`member_artist_scopes`).
- **NOT a party's linked account.** A rights writer can create or edit a party with any account on it and confirm it as
  themself (the confirm route only checks `party.user_id`), so a party proves nothing about who the artist is.
  A credited artist who has neither of the two above is **unreachable**: nobody can be told, nobody can answer for them
  (this is every credited artist in the studio's own *producer* org, which offers no `artist` role).

*Accepted deviation:* an admin with `members.manage` can invite an address they control as role `artist` scoped to the
contact (label orgs only; needs an invitation accepted with a verified email; leaves `invitation.created` /
`member.joined`). An artist whose account later leaves the org leaves a refusal nobody can lift (known; the store owner
can delete the release or ask the artist back).

The listing says so ("N have no account in this organization, so nobody could be told"); the event carries the count.
**No email address is read off a contact card and no email path is invented.** This is the main product gap — see the PR.

## Caches

A release an artist has a say on (any consent row) or the owner vetoed is served `Cache-Control: no-store` (detail,
audio, cover, and the list when it holds one), so a no is never held by an edge cache. Releases without consent rows
keep the store's usual window (`s-maxage=30`, swr 60).

## Notification

New kind `listing_proposed` in the closed union (`notify-kinds.ts`). One call per account, never the asker, sent only
from `lib/labelos/store-consent-notify.ts`, which only the store-listing PUT imports (source-scan test). Opens
`/o/<slug>/releases/store`, where the artist answers.

## Audit

`listing.consent_decided`, `listing.vetoed`, `listing.veto_lifted` (audit, internal); `release.store_listed` gains
`consentAsked` / `consentUnreachable` (counts only); an artist's no also records `release.store_unlisted`
(`reason: 'artist_declined'`). Put-back is applied in the unsafe direction only: a `yes` / an Allow whose event cannot
be written is put back exactly as it was; a `no` / an Unlist stands (the release is already private) and the caller is
told it was not recorded. LABEL-73 turns these into atomic functions.

## Screens

- `/o/<slug>/releases/store` (nav: Organization → Store listings): "Asked of you" (any member; empty unless they are an
  artist's account) and, for the store owner (owner of a label org), "Releases from connected artists" with Unlist /
  Allow again.
- The release's "On the store" card: the artists' say (names only for artists in the viewer's scope), what a no means,
  who could not be told, and Yes / No on the artist's own row.
- The connection screen says what consent means for each side.

## Not built (see the PR, "Found, not fixed")

- The "greatest moments" **showcase** (no public surface for it exists; one table keyed by a showcase id plus a public
  route is its own task).
- A credit added **after** a listing does not ask that artist until the next fresh listing.
- Artists without an account cannot say no (needs the artist portal or an invite flow).
