# 25 — Team accounts, department views and the admin centre

Owner direction of 2026-10-17 (voice message, restated). Extends LABEL-48 (setup) and LABEL-50
(team and roster window) of `23-engineering-backlog-phase-2.md`. **(read as)** marks an
interpretation the owner can correct.

## 1. What the owner asked for

1. After creating an account (`/setup`), the owner can **create team access** for their
   organisation, and an organisation has **many** team accesses.
2. The owner creates each account **directly**: the person's email (usually the company
   address) and a password the owner chooses. The person does **not** sign up themselves; they
   sign in with what they were given and **may change the password**.
3. The owner keeps **central control** over those accounts ("I have access to all their
   passwords").
4. On sign-in each person sees **only their compartment**: a marketing account sees marketing,
   and so on. **(read as)** the role + functions model of `06-permission-model.md`
   (owner / admin / member + functions marketing, legal, finance, A&R, … / artist).
5. An **artist or producer** added to a label gets the artist / producer experience
   (the producer studio that exists on `main`). Company roles (marketing, legal, finance, …)
   get a **new, narrow interface** with only their functions. **Admins** get one **central
   admin layout** where everything is managed.
6. Supabase (the database) must know all of this: a migration, not only screens.

## 2. Decision taken: no readable passwords

"Access to all their passwords" is not built. Supabase stores only a one-way hash, and keeping a
readable copy would mean one leak exposes every account. The owner gets the same control another
way:

- the owner **sets the first password** when creating the account;
- the person is **asked to change it** at first sign-in;
- the owner (or an admin) can **reset** a team account's password at any time, which sets a new
  password and asks the person to change it again;
- the owner can **switch an account off** (sign-in refused) and back on, or remove the member.

A reset or a switch-off is allowed only on an account **this organisation created** and that
belongs to **nothing else** (no other organisation, no shared project, not the producer, not a
platform operator). An organisation can never take over somebody's own account: an email that
already has an account is refused with "invite them instead" (the existing invitation flow).

## 3. Phases (each one PR into the Label OS branch)

| # | Phase | Depends on | Status |
|---|---|---|---|
| 1 | **Team accounts** — migration 190 `org_managed_accounts` + audit functions; create account (email, name, password, role, functions, artist scope) in one step; reset password; switch off / on; forced password change on first sign-in; "Create account" on the members page; unit, route, real-database checks and e2e | LABEL-47 (seats) | Done (this branch, PR #130) |
| 2 | **Department home** — a member whose role is `member` lands on a workspace that shows only their functions (marketing, legal, finance, A&R…), using the LABEL-49 capabilities; the nav already hides what they cannot use | LABEL-49 (done, #134) | Folded into the backlog's **LABEL-70 Role views** (same home, driven by face + role + functions); not built here so the two do not diverge |
| 3 | **Admin centre** — one page for owners/admins: team accounts, roster, invitations, licence (entitlements), settings, activity | 1, LABEL-51 (done, #137) | Done (PR #130) |
| 4 | **Roster accounts** — adding an artist or producer to a label can create their login too (role `artist`, or function `producer`), landing in the artist / producer view | 1, LABEL-50, LABEL-70 | Not started |
| 5 | **Setup wizard steps** — contract types, team step (phase 1 embedded), departments | 1, LABEL-49, LABEL-57 | Not started |

## 4. Rules phase 1 holds

- Accounts are created with the Supabase **admin API** (service role, server only), email
  confirmed, never with a password sent by email. The password is shown to the creator once, in
  the page, and never stored by the app or written to a log or event.
- Create = auth user, then ONE database function that writes the membership, the artist scope,
  the managed-account row and the audit event (`member.account_created`). If that function fails,
  the auth user is deleted again.
- Capability `members.manage` for every write; an `owner` account is never created this way;
  an admin cannot reset or switch off an owner. Seat cap (LABEL-47) enforced under the same
  lock as invitations.
- A managed account with `must_change_password` is sent to `/account/password` from the org shell
  until it sets its own password.
- Every act is an audit event in the org: `member.account_created`, `member.password_reset`,
  `member.account_disabled`, `member.account_enabled`; the person's own change is
  `member.password_changed`. No password, hash or temporary value is ever in a payload.

## 5. Rules phase 3 holds

- `/o/<slug>/settings` is the admin centre: label and artist orgs, capability `members.manage`
  (owner and admin). It changes nothing; every section links to the page that owns the change
  (members, roster, connections, organization settings, digest, export and deletion), so no rule
  exists twice. Owner-only pages are left off for an admin rather than shown and refused.
- `GET /api/org/[orgId]/admin` answers counts and names only: roles, team accounts waiting on a
  password or switched off, pending invitations, seats and roster artists against the licence,
  the licensed modules. The last team changes (member and invitation verbs, all `internal`) are
  listed only for a whole-org member with `business.read.internal`; `recent` is null otherwise.
  The section and summary rules are pure in `lib/labelos/admin-centre.ts`.
- Entry points: "Admin" heads the nav's Organization hub, and the members page links to it.
