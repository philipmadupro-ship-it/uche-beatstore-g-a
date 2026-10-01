# 16 — Execution Runbook: one task per Claude session

**Decided 2026-09-30 (revised the same day):**

- Each backlog task runs in its own fresh Claude Code session, one after another in dependency order.
- **Nothing goes to production.** Every finished task is merged into a separate Label OS branch by the orchestrator. The owner is not a gate per task.
- The owner merges that branch into `main` (production) **once**, when they decide.

## Branches

```text
main  (production — untouched by this work)
  │
  └── claude/happy-bardeen-rnosf3   ← the Label OS branch. Everything lands here.
         ├── label-os/LABEL-02  ── PR ──▶ merged into the Label OS branch by the orchestrator
         ├── label-os/LABEL-03  ── PR ──▶ merged into the Label OS branch by the orchestrator
         └── …
Later, by the owner only:  Label OS branch ──▶ main
```

- **Label OS branch:** `claude/happy-bardeen-rnosf3`. Every task PR targets it.
- **Task branches:** `label-os/LABEL-NN`, one per task, deleted after merge.
- **`main` is never pushed to or merged into by any session.**
- **Weekly:** merge `main` *into* the Label OS branch, so the final merge to production stays small and conflict-free (R-13). This only brings production's changes in; nothing flows out.

## Why one task per session

- **Fresh context per task.** Each session reads the repo and this folder cold, so knowledge lives in the docs, not in a long chat that gets summarised and forgets things.
- **Small pull requests.** One task = one PR = one merge commit on the Label OS branch, easy to inspect or revert later.
- **Clean failure.** A task that goes wrong is abandoned and restarted without polluting the next one.
- **Sequential, not parallel,** because Phases 1–2 touch shared files (`api-gate.ts`, `nav/model.ts`, migrations).

## The pipeline

```text
orchestrator (the planning chat)
   │
   ├─ 1. pick the lowest-numbered task whose dependencies are Done
   ├─ 2. start a child session with the task prompt (below)
   │        child: read docs → implement → tsc + vitest + build → /code-review → PR into Label OS branch
   ├─ 3. watch the PR: CI must be green; fix-ups go back to the child session
   ├─ 4. merge gate (automatic, no owner action):
   │        CI green on the latest commit
   │        + every Acceptance Criterion checked off in the PR with how it was verified
   │        + orchestrator's own review of the diff finds no blocking issue
   │        + no change outside the task's scope (Out of Scope respected; no edits to main)
   │     → squash-merge into the Label OS branch, mark the task Done in 14-engineering-backlog.md
   └─ 5. start the next task
```

**CI:** `.github/workflows/ci.yml` runs `tsc → vitest → next build` on pull requests into `main` **and** into the Label OS branch.

## What the owner does

| When | Action |
|---|---|
| Any time | Optional: read any task PR (each is linked from the orchestrator chat). Commenting "stop" or asking for changes is always possible |
| End of each phase | The orchestrator reports the phase's exit criteria (`12-phased-roadmap.md`). The owner may try it (see "Trying it before production") |
| When Label OS is ready | **The owner merges the Label OS branch into `main`.** Before that: apply the Label OS migrations to the production database (in order, listed in `supabase/MIGRATIONS.md`), then merge, then set `LABEL_OS_ENABLED` in Vercel when ready to switch it on |
| To pause | Say "pause Label OS" in the orchestrator chat. No new sessions start |

## Production database: do not touch until the final merge

Label OS migrations are committed to the Label OS branch and registered in `supabase/MIGRATIONS.md` as **"Label OS — not applied (apply at final merge)"**. **Nobody applies them to the production Supabase project during development.**

The code does not need them in production until the branch is merged, and the feature flag is off anyway.

**Never run `npm run db:migrate` against production from the Label OS branch**: it applies every migration file, Label OS ones included. Production uses `supabase/apply/pending.sql`, built from explicit numbers (`scripts/ops/bundle-migrations.sh`), and Label OS tasks never edit that file.

(Migration 115 is different: it belongs to the existing producer app and was applied by the owner on 2026-09-30.)

## Always run a local database (decided by the owner, 2026-10-01)

Every task that adds or changes a migration runs **`npm run db:local:check`** (`scripts/local-db/check.sh`) before pushing. It starts a throwaway Postgres in a temp directory (never Supabase, never `SUPABASE_DB_URL`), then:

1. runs `scripts/local-db/reset.sh` against it: `bootstrap.sql` (Supabase-shaped roles and `auth`), **every** migration twice through the deploy runner, `seed.sql`;
2. runs each `supabase/local/checks/*.sql`. **A schema task adds a check file for its migration**: behaviour asserted as `anon` / `authenticated` users, raising on failure. `136_labelos_org_core.sql` is the template;
3. checks `has_org_cap` against `capabilitiesFor()` on generated fixtures;
4. runs each `supabase/rollback/NNN_*.down.sql`, then re-applies its migration.

It deletes the database afterwards (`KEEP_LOCAL_DB=1` keeps it running). The PR's test plan reports its output. This is what "not applied" means: never applied to a **real** database, always proven on a local one.

## Trying it before production (optional, recommended before the final merge)

Vercel builds a **preview deployment** for every pushed branch, including the Label OS branch. By default a preview uses the same environment variables as production, which means the **production database**.

To try Label OS safely:

1. Create a second Supabase project, e.g. "bstudio-staging".
2. Run all migrations on it (`SUPABASE_DB_URL=<staging> npm run db:migrate`).
3. In Vercel → Settings → Environment Variables, set the **Preview** values of `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the staging project, and set `LABEL_OS_ENABLED=true` for Preview only.
4. Open the Label OS branch's preview URL.

Until that is done, the preview runs with Label OS switched off. The flag defaults to off, so it looks like production.

## What the orchestrator does

1. Keeps task status in `14-engineering-backlog.md` current (`Not Started` → `In Progress` → `In Review` → `Done`).
2. Runs **one** child session at a time.
3. Merges a task PR into the Label OS branch only when the merge gate above passes.
4. Stops and asks the owner when:
   - a task hits one of the brief's hard-stop conditions;
   - CI is red twice on the same cause;
   - a task needs a product decision not covered by `15-product-decisions.md`;
   - a phase is complete (report + short summary).
5. **Never** merges into `main`, pushes to `main`, or applies migrations to the production database.

## The task prompt (sent to each child session)

```text
You are implementing ONE backlog task for BStudio Label OS: LABEL-{NN} — {TITLE}.

Read first, in this order:
  CLAUDE.md, AGENTS.md,
  docs/bstudio-label-os/00-executive-summary.md,
  docs/bstudio-label-os/15-product-decisions.md (binding decisions),
  docs/bstudio-label-os/17-reconciliation-with-artist-workspace.md (binding; wins over 04-14 where they differ),
  docs/bstudio-label-os/16-execution-runbook.md,
  the task section "# LABEL-{NN}" in docs/bstudio-label-os/14-engineering-backlog.md,
  and every doc that section references.

Rules:
- Do exactly this task. Its "Out of Scope" is binding. Anything else you find goes in the PR
  description under "Found, not fixed".
- Follow the repo conventions in CLAUDE.md: Zod contracts, org-access helpers (no user_id filters
  under /api/org/*), pure logic in src/lib with Vitest tests written first, design-direction.md
  for UI.
- Migrations: next free number (check `git log --all -- supabase/migrations/`; main ends at 135, Label OS
  started at 136), idempotent, end with NOTIFY pgrst. Register them in supabase/MIGRATIONS.md as
  "Label OS — not applied (apply at final merge)". Never apply them to Supabase. Never edit
  supabase/apply/pending.sql. Always prove them on a throwaway local Postgres: add
  supabase/local/checks/NNN_*.sql for the migration and run `npm run db:local:check` (see "Always
  run a local database" in this runbook).
- Every new Label OS table goes into `labelOsTables()` in src/lib/security/rls-final-state.test.ts
  in the same PR. The LABEL-04 guards (RLS on, no USING (true), every policy keyed on org_id or a
  membership helper) only cover tables in that list.
- Build on main's Artist Workspace (#44) — never create songs/artists/files/comments/credits tables
  (17-reconciliation). Keep `npm run e2e:real-db` flows green when you touch #44 tables.
- Everything stays behind LABEL_OS_ENABLED. No change to existing producer, store, or checkout
  behaviour unless the task says so.
- Before pushing: npx tsc --noEmit && npm test && npm run build must pass, and
  npm run db:local:check when the task touches supabase/. Run /code-review on
  your diff and fix what it finds.
- Branch: label-os/LABEL-{NN}. Open a PR into claude/happy-bardeen-rnosf3 (NEVER main), titled
  "LABEL-{NN}: {TITLE}", with the repo PR format: Summary / Why / Test plan /
  Required prod config / Migrations to apply.
- In the PR, check off each Acceptance Criterion with how it was verified.
- Do not merge your own PR. The orchestrator merges it into the Label OS branch.
- If blocked by a hard-stop condition or an undecided product question, stop and say so in the PR
  or your final message. Do not guess.
```

## Order

`14-engineering-backlog.md` → "Recommended execution order". Phase 8 items (chat, workflow builder, contract generation, multi-org store) are not started automatically. Each needs a short discovery first.

## Speed

- **Nothing waits on the owner**, so the pace is set by how long each session takes plus CI (roughly 5–10 minutes).
- The orchestrator checks in on a schedule. Each task PR also produces events the orchestrator reacts to.
- **If more speed is wanted later,** the independent pairs listed in the backlog (22 ∥ 23, 25 ∥ 26, 33 ∥ 34, 37 ∥ 38) can run in parallel. Keep Phases 1–2 sequential.
