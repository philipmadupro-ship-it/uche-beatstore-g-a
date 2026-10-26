# 24 — Orchestrator handoff (read this first)

You are the **orchestrator** of the BStudio Label OS build, continuing from a previous
orchestrator session. This document is your whole memory. Read it, then `CLAUDE.md`,
`16-execution-runbook.md`, `21-review-findings-and-decisions.md`, `22-product-brief-…`,
`23-engineering-backlog-phase-2.md`. Repo `philipmadupro-ship-it/uche-beatstore-g-a`.

## Standing instructions from the owner (verbatim intent; they still bind)
- **Never merge into `main`.** Everything stays on the Label OS branch `claude/happy-bardeen-rnosf3`.
  Merge each task PR into it when CI is green. Keep everything inside the Label OS.
- **Do all the logs:** keep the Status lines in the backlog, the "next new migration" sentences in
  `CLAUDE.md` and `supabase/MIGRATIONS.md`, and `docs/codex-execution-log.md` current. Children
  must not edit those.
- **One new conversation per task** (create_session), you orchestrate and gate. Run them **one by
  one** (the owner said "1 by 1"); you may overlap two when they touch disjoint files and have no
  dependency. Verify the work and prompt the child again when needed.
- **Do not decide open product questions as if they were the owner's**; the owner has delegated
  the ones listed in doc 21 §5.2 and doc 22 §8. Anything else new goes to the owner as a question
  with a blank "Your decision" line. Plans / paid tiers: the owner will decide together with you
  later. Do not invent plan logic.
- All Label OS migrations (136…) are **not applied**; they are applied at the final merge. Never
  put them in `supabase/apply/pending.sql`; never touch the production database.
- The owner said not to worry about their usage limit. Still stagger launches: all sessions share
  one account limit (five-hour window); when a child dies with `usage_limit_reached`, restart it
  with `send_message` after the reset rather than abandoning it.

## State at handoff (2026-10-14)
- LABEL-01..42 are Done and merged. Ten independent reviews (G1–G10) are merged (#116–#124) and
  reported in doc 21. Phase 2 backlog is doc 23 (LABEL-43..78), all **Not Started**.
- Next migration number: **162** (reservations in doc 23). Highest on disk 161.
- Open PRs that target `main` (#73, #2) stay unmerged; not part of this build.
- Full gates on the Label OS branch were green at the end of phase 1 (tsc, lint, 8683 tests,
  build, `db:local:check`, `e2e:real-db`).

## The owner's product direction (summary; details in doc 22)
Two faces, **independent artist/producer** or **label**, licensed by the platform owner; the
access the owner grants decides setup screens, departments and modules. Every contract type has
a template. Finance, contracts, marketing/PR, CEO, artistic direction, producers, rappers and
collaborators are all actionable in the app on day one so a label needs no other application.
Splits and contracts integrate. **The artist always has the final say** on store listing (any
credited artist's no withdraws it). Roster artists see their own splits, never co-writer contact
data. Release gates must be satisfiable by a human in the UI (ISRC, ISWC, UPC, IPI/PRO, P/C
lines, royalties). "Coffee" and "July" from the owner's voice message: ignore.

## Decisions already made under the owner's delegation (doc 21 §5.2, binding unless the owner reverses)
Default playback `preview` until the release has gone out, `full` only after and as a lossy
derivative, never the master; listen-only external roles never stream the master; split note and
co-writer contact data hidden from roster artists; `legal_gate=off` is an audited explicit skip,
owner-only; `org.created` audit-class; purge cron time budget; "N restricted" counts hidden from
role `artist` and scoped staff; Slack digest from the artist-visible view; draft-release songs stay
`working`; delivered releases are withdrawn, not cancelled; keep the `/o` landing; sole-owner
account deletion blocked; forbidden pages 404 except settings; `ensurePersonalOrg` gated on the
flag; song-level legal hidden once on a release; `seen` required; self-approval needs a request.

## How to run a task (the procedure that worked for 42 tasks + 10 reviews)
1. Set the task Status `In Progress` in the backlog (on a docs branch off the Label OS branch, or
   via the PR that merges next). Confirm the migration number: `git log --all -- supabase/migrations/`.
2. `create_session` with the child prompt from `16-execution-runbook.md` ("The task prompt"),
   changing the backlog reference to `docs/bstudio-label-os/23-engineering-backlog-phase-2.md`
   and adding the standing requirements section of doc 23. Model: Sonnet 5.5 is fine; use Opus 5.5
   for finance, contracts, atomic audit and anything touching RLS. `source_url` = the repo,
   `source_revision` = `claude/happy-bardeen-rnosf3`. Child branch `label-os/LABEL-NN`; PR
   **draft**, base the Label OS branch.
3. **Gate before merge (all must hold on the CURRENT head):**
   - the three checks green: `build-and-test`, `e2e`, `secret-scan` (+ Vercel preview);
   - mergeable; no unrelated files; **file-list scope check** (`get_files`): no
     `supabase/apply/pending.sql`, no unexpected migration, only the task's surface;
   - PR body ticks each acceptance criterion with how it was verified;
   - for high-risk tasks (RLS, money, contracts, audit functions, store) run an **independent
     read-only review subagent** on the diff before merging;
   - draft → ready (`update_pull_request draft:false`) → squash merge with `expectedHeadSha` = the
     **real full SHA** from `pull_request_read` (never guess it).
4. Stacked branches: when a child's base moved after an earlier squash, have the child merge the
   base keeping both sides in shared lists (`package.json` e2e list, `VERBS` /
   `DEFAULT_VISIBILITY` / `VERB_PHRASES`, `rls-final-state`, `external-matrix`, `MIGRATIONS.md`,
   `CLAUDE.md`).
5. After merging: set Status `Done` with PR # and squash SHA, update the next-migration sentences
   and the execution log, then start the next task. After each lettered phase (A, B, …) run a
   short review fleet (4–5 tasks per reviewer, prompt in `19-independent-review-prompt.md`, add
   groups for phase 2) and merge their fixes the same way.

## Traps you will meet (learned the hard way)
- **gitleaks** scans every commit in the PR range; fake high-entropy secrets fail `secret-scan`.
  Use `'test-secret-key'`-style values; never a `.gitleaksignore`.
- **Flaky component tests** from busy buttons: wait for enabled; never loosen assertions.
- **PostgREST**: max-rows 1000 truncates silently; long `.in()` lists overflow the URL; `.or()`
  interpolation breaks on commas. Use `lib/labelos/paged-read.ts`.
- `src/proxy.ts` matcher, `LABEL_OS_ENABLED`, `external-matrix.test.ts` (every org handler × 4
  external roles + stranger + signed-out), `coverage.test.ts` (every mutating org handler records an
  event), `rls-final-state.test.ts` (list new tables), TS↔SQL capability parity.
- Local DB: `npm i --no-save jiti` then `npm run db:local:check`; `db:local:reset/up` then
  `source scripts/local-db/env.sh`, `npm run e2e:real-db` (set a 25 s expect timeout on a cold dev
  server).
- GitHub MCP tools are deferred and sometimes disconnect: reload with ToolSearch `select:`.
  Large `get_files` output is saved to a file: use `jq -r '.[]?.filename'`.
- A child that hits the usage limit: restart with `send_message`; check `get_session` /
  `list_events` (kinds `result`) to see whether it finished.
- Do not ask the user for things you can verify; report faithfully, including what was not
  verified.

## Reporting to the owner
Plain words, short. After each phase: what changed, what they can now try (add the click-path to
`18-test-roadmap.md`), and any decision needed. The owner does not read code; do not paste diffs.
At the end (LABEL-78): the full report, the migration apply order for 136…N, and the question of
plans and paid tiers, which the owner wants to decide together with you.

## First actions
1. Confirm `docs/bstudio-label-os/21…24` are on the Label OS branch.
2. Start **LABEL-43** (security hardening migrations), then 44, 45, 46 (phase A); then phase B.
3. Keep a short log at the bottom of `docs/codex-execution-log.md` for each merge.
