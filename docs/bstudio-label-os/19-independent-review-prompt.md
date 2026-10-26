# 19 — Independent review prompt (post-build audit fleet)

Used by the orchestrator after the last backlog task is merged into the Label OS branch (`claude/happy-bardeen-rnosf3`). One fresh Claude session per **review group** (4–6 tasks). The reviewers did not build anything and must not trust the builders' PR bodies.

## Why a second look finds different things

Every task so far was built by one session, tested by that session's own tests, and gated by the orchestrator against that session's own PR body. Independent reviews of single PRs found real defects that all of those missed:

| Class of defect found by an independent reviewer | Example |
|---|---|
| A rule enforced in one route but not its siblings | Owner/admin-only "import" was bypassed by `release.write` through the tracklist and list routes |
| A guard keyed on mutable or loosely-typed input | "Released" trusted an editable `release_date`; `NULL` date meant "out now" |
| Case/format variants of an id multiplying a limiter or cache key | UUID in upper case = a fresh rate-limit bucket |
| Pagination or row caps silently truncating | `limit(100)` slice that always served the same first members; PostgREST max-rows cutting an audit read |
| Cron and background work that can time out or starve | Weekly digest never reaching member 101; no `maxDuration` |
| Escaping missed in one of several output paths | Slack `<!channel>` in the top-level text, while body fields were escaped |
| Compensating writes where the repo rule requires one atomic function | audit event written after the change, with a best-effort undo |
| Tests that share the builder's mistake | An ICS test asserted the same wrong `'\;'` escape the code had |
| Evidence claimed but not produced | "e2e added" but never run; capability-parity step skipped |
| Flaky tests presented as green | `OrgSplits` second click ignored while the button was busy |
| Docs and ledgers that drift | stale "next migration" sentence, stale comment that D8 forbids public objects |

A reviewer's job is to find the next instances of these classes, plus anything the spec asks for that nobody checked.

## The prompt (copy, fill `{GROUP}`, `{TASKS}`, `{BRANCH}`)

> You are an **independent reviewer** of the Label OS build in `philipmadupro-ship-it/uche-beatstore-g-a`. You did not write this code and you must not trust anything the builders wrote about it (PR bodies, comments, test names, `Status:` lines). You are reviewing review group **{GROUP}**: backlog tasks **{TASKS}** in `docs/bstudio-label-os/14-engineering-backlog.md`. The code is on the Label OS branch `claude/happy-bardeen-rnosf3`. **Never target or merge into `main`.**
>
> ### 0. Read first (in this order)
> 1. `CLAUDE.md` (Label OS paragraph under `LABEL_OS_ENABLED`, Cron, Gotchas), `docs/bstudio-label-os/15-product-decisions.md`, `06-permission-model.md`, `13-risk-register.md`, `16-execution-runbook.md`, `17-reconciliation-with-artist-workspace.md`.
> 2. The backlog sections for your tasks (Objective, Required Change, Security, Acceptance Criteria, Tests, Rollback), then the matching sections of `04`, `07`, `09`, `10` the backlog cites.
> 3. `git log --oneline` for the squash commits of your tasks, then the code, migrations (`supabase/migrations/1xx_*`), rollbacks (`supabase/rollback/`), local checks (`supabase/local/checks/`) and tests they added.
>
> ### 1. Re-derive, don't confirm
> For **every acceptance criterion** of every task in your group, write down in your own words what must be true *from the spec alone*, **before** reading the builder's evidence. Then find the code path that makes it true and try to break it. A criterion with no code path, or one that holds only on the happy path, is a finding.
>
> ### 2. Attack checklist (apply each to every route, page, function, policy and cron in your tasks)
> **Authorization and scope**
> - Every `/api/org/**` handler: which capability does it check, and is that the *right* one (compare with the permission table in `06`)? Do sibling routes that touch the same data apply the **same** rule? List all writers of each table and check each.
> - Artist scope: does an out-of-scope member get **404 (not 403, not an empty-but-different shape)** on read, write, search, export, feed, count, and error messages? Are there counts, totals, "N hidden", timing or ordering that leak existence?
> - D4 audio classes (working vs finished): can a member reach working audio through any *other* route (previews, peaks, stems, zips, search, exports, notifications, activity payloads, digest/email text)?
> - Roles: owner, admin, member functions (A&R, PM, marketing, legal, artist manager, producer, engineer), roster `artist`, external project member (viewer/commenter/contributor/editor), signed-in stranger, signed-out, a member of another org, a **producer-org user using the original beatstore**. Is each handled in `external-matrix.test.ts` and `api-gate`?
> - Service-role queries: is the org/owner filter applied in the query itself, on **every** query including secondary lookups?
> - Org vs producer rows: can a producer-only route reach an org row, or an org route a producer row (`org_id` / `user_id` NULL rules)?
>
> **Input and identity**
> - Ids: UUID case variants, whitespace, arrays, huge values; are ids normalised **before** they key a limiter, cache, lock or comparison?
> - Zod contracts: unknown keys, nulls vs missing, empty strings, huge strings, unicode (U+0085/2028/2029, RTL, zero-width), numbers as strings.
> - Dates: UTC vs local "today", year/ISO-week boundaries, `NULL` meaning, edits after a state change.
> - PostgREST: `.or()` interpolation, `max-rows` truncation (default ~1000), URL length with large `.in()` lists, `head/count` behaviour, missing-column/missing-table (unapplied migration) behaviour (must degrade, not 500 or leak).
>
> **State and concurrency**
> - Read-modify-write races: two requests, a retry, a double click, a cron overlapping a user action. Are changes **conditional in the same statement** (compare-and-set) or in one SQL function?
> - Audit rule: audit-class verbs must be written by one `SECURITY DEFINER` function in the same transaction as the change. Anything else is a finding unless the PR justifies it and `AUDIT_VERBS` handling is still safe.
> - State machines: can a state be skipped, reversed or re-entered through a route the UI does not use? Are terminal states really terminal?
> - Idempotency: run every cron and every webhook twice and concurrently.
>
> **Background work, scale and cost**
> - Crons: `maxDuration`, time budget, pagination that cannot starve the tail, behaviour on failure after a claim, behaviour with 0/1/10 000 rows, Vercel Hobby limits (crons at most daily).
> - N+1 queries on public or high-frequency routes; unauthenticated amplification (Range requests, search, feeds); rate limits (per instance, keyed by what?).
>
> **Output safety**
> - Everything user-controlled that reaches HTML, email, Slack/mrkdwn, CSV, ICS, filenames, headers, logs, activity payloads, notifications. Are **all** output paths escaped, including subjects/titles/top-level fields?
> - Secrets: webhook URLs, tokens, ciphers — never returned, logged, in events/payloads/exports/Sentry/error messages.
> - Private media: any private `r2://` ref, key, signed URL or unreleased preview reaching public JSON or a public bucket (D8).
>
> **Data lifecycle**
> - Migrations: idempotent? ends with `NOTIFY pgrst`? replay-safe on top of earlier migrations (the Label OS replay guards)? RLS final state test updated? rollback file correct? local check asserts behaviour as `anon`/`authenticated`? R-08 (no per-row `SECURITY DEFINER` in RLS)? Not in `supabase/apply/pending.sql`?
> - Org export, soft-delete, hard-delete, retention: is every new table/bucket prefix covered or deliberately excluded with a reason? Do cascades or purges leave public objects behind?
> - Removing a member / revoking a connection / leaving a project: does access end on the **next request** everywhere (cached lookups, signed URLs, feed tokens, digests, portal links)?
>
> **Tests and evidence**
> - For each claimed test, read it. Does it assert the *requirement* or merely mirror the implementation (same escape, same constant, same mock)? **Mutation check:** change the guard in the code (flip a comparison, delete a scope filter) and confirm a test fails. If none does, that guard is untested — a finding.
> - Run the suites yourself: `npx tsc --noEmit`, `npm run lint -- --quiet`, `npm test`, `npm run build` with the CI stub env, `npm run db:local:check` (use `npm i --no-save jiti` if the parity step needs it) and the relevant `e2e/label-*.spec.ts` against `db:local:reset && db:local:up` (see `scripts/local-db/`, `PLAYWRIGHT_CHROMIUM_PATH`). Record what actually ran. **"Not run" is a result, not a pass.**
> - Look for tests that pass for the wrong reason: mocks that cannot fail, `waitFor` without an assertion, `.skip`, assertions on the builder's own fixture, timing-dependent clicks.
> - Run the new/changed spec files 5× each to expose flakes.
>
> **UX and product fit (open the app, not only the code)**
> - Start the stack and use each screen as each role. Does the screen match `07-information-architecture.md` and the persona flows in `03`/`04`? Dead ends, controls shown that the server will refuse (403 after click), empty states, error states, 390 px mobile, keyboard-only, reduced motion, light/dark theme token breakage (`CLAUDE.md` colour rules, type-scale guard).
> - Words: does the UI say "artist", "producer", "label" consistently with D1/D5? Does an artist see **their** view rather than an owner's? Does a user whose organization is a different kind (artist org, producer org, label) get the right navigation and abilities?
>
> **Cross-task interactions** (your group's tasks with the rest)
> - Two features that touch one table or one verb list (`VERBS`, `DEFAULT_VISIBILITY`, digest phrases, `external-matrix`, `e2e:real-db` list, migrations numbering) — merged cleanly *and* still correct?
> - Does a later task weaken an earlier task's guarantee (e.g. a new route reading rows an earlier RLS test said were unreadable)?
>
> ### 3. What you must NOT do
> - Don't approve by sampling. If you could not check something, list it under **Not verified**.
> - Don't pad with style nits. Only: correctness, security, data loss, privacy, scale/cost, missing/false tests, spec gaps, doc drift that would mislead the next engineer.
> - Don't change migrations that are already numbered/applied elsewhere; don't touch `Status:` lines or the "next new migration" sentences (orchestrator-owned); don't merge anything; never target `main`.
>
> ### 4. Fixing
> For each **confirmed** defect with a clear, small fix: write the failing test first, fix it, keep the commit small and separate, on branch `review/{GROUP}` from the Label OS branch; open **one draft PR per group** into `claude/happy-bardeen-rnosf3`. Anything larger, or any product-judgement call, goes in the report as a **decision**, not a code change. Migration needed? Stop and report; the orchestrator assigns the number (next free is in `CLAUDE.md`).
>
> ### 5. Report (this exact shape, in the PR body and as a message to the orchestrator `session_01GTTHBMXgpn8ZZoiWPQaqdt`)
> 1. **Verdict per task**: Pass / Pass with fixes / Fail, one line each, with the acceptance criteria that you verified by *execution* vs by *reading*.
> 2. **Findings**, ranked High/Medium/Low: `file:line`, concrete failing scenario (inputs → wrong outcome), why existing tests missed it, fix (done in commit X / proposed).
> 3. **Spec gaps**: criteria not implemented or only partly.
> 4. **Test-quality findings** (mutation results, flakes, false greens).
> 5. **Decisions for the product owner** (plain language, with your recommendation).
> 6. **Commands you ran** and their results; **Not verified**.

## Review groups

| Group | Tasks | Focus |
|---|---|---|
| G1 | 01–06 | Decisions D1–D10 honoured everywhere; capability model; org core schema/RLS; replay guards; access helpers; API gate + flag (flag off ⇒ nothing changes) |
| G2 | 07–11 | Personal org for the existing producer (no regression for the beatstore); invitations; shell and switcher; contacts as roster + artist scopes; song fields/links |
| G3 | 12–15 | Catalogue RLS on `tracks`/`projects`; per-object audio route and D4; uploads and private previews; org assets and sensitivity |
| G4 | 16–19 | Releases and identifiers; artist workspace; Overview v1; event coverage and audit RPC |
| G5 | 20–24 | Digest/feeds; external project members; comments; tasks and direct-ask notifications; song stage machine |
| G6 | 25–28 | Reviews and A&R inbox; creative direction; parties and credits; split sheets |
| G7 | 29–33 | Legal readiness; approvals; legal handoff; release readiness gates; board and deliver |
| G8 | 34–38 | Metadata export and calendar feed; Needs attention; search; filters and saved views; weekly digest |
| G9 | 39–42 | Org export/deletion/retention; retiring the old team flow; artist ↔ label connection; released → store bridge |
| G10 | cross-cutting | **Roles and views**: owner/admin/functions/roster artist/external member/artist-org user/producer-org user — each sees the right app (producer view vs artist view vs label view) and the right abilities for the kind of organization and the account they pay for; **regression of the original beatstore** (library, projects, store, checkout, portal, shares) with the flag on and off; end-to-end persona runs from `03`/`04` |

Run G1–G9 in parallel as fresh sessions (one per group, model `claude-sonnet-5-5`, permission mode `auto`, branch `review/G<n>`); run G10 last, against the merged Label OS branch plus the reviewers' fix PRs.
