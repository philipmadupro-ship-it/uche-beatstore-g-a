# 16 — Execution Runbook: one task per Claude session

**Decided 2026-09-30:** each backlog task runs in its own fresh Claude Code session, one after another in dependency order. The owner reviews and merges each pull request, and merging starts the next task.

## Why one task per session

- **Fresh context per task.** Each session reads the repo and this folder cold, so knowledge lives in the docs, not in a long chat that gets summarised and forgets things.
- **Small pull requests.** One task = one PR = one thing to review. That matches the backlog's "independently executable" format.
- **Clean failure.** A task that goes wrong is abandoned and restarted without polluting the next one.
- **Sequential, not parallel,** because Phases 1–2 touch shared files (`api-gate.ts`, `nav/model.ts`, migrations). Parallel sessions would collide on migration numbers and those files.

## The pipeline

```text
                ┌──────────────────────── orchestrator session (this chat) ─────────────────────────┐
backlog ──▶ pick next task whose dependencies are merged ──▶ create child session with the task prompt
                                                                         │
                             child session: read docs → implement → tsc + vitest + build → /code-review
                                                                         │
                                          push branch label-os/LABEL-NN → open PR into the integration branch
                                                                         │
                                  CI runs on the PR ──▶ owner reviews ──▶ owner merges (or asks for changes)
                                                                         │
                ◀──────────── orchestrator is told the PR merged (PR events) ──▶ mark task Done ──▶ next task
```

**Branches.**

- **Integration branch:** `claude/happy-bardeen-rnosf3`. Every task PR targets it, and **`main` is not touched**.
- **Per-task branches:** `label-os/LABEL-NN`.
- **Bringing Label OS to `main`:** one PR per completed phase, after the owner decides. The feature flag stays off in production until then.
- **Weekly:** merge `main` into the integration branch to limit drift (R-13).

**CI.** `.github/workflows/ci.yml` runs `tsc → vitest → next build`. Its `pull_request` trigger was `[main]` only, so task PRs would have had no checks. It now also covers the integration branch.

## What the owner does

| When | Action |
|---|---|
| A task PR opens | Review it. Merge, or comment what to change (the orchestrator relays it to the task's session) |
| A task has a migration | **Before merging to `main`:** run the migration in the Supabase SQL editor and mark it applied in `supabase/MIGRATIONS.md`. Merging into the integration branch does not need it, since the flag is off |
| Now (D7) | Apply `supabase/migrations/115_track_collaborators.sql` on production |
| End of each phase | Check the phase's exit criteria (`12-phased-roadmap.md`), then decide whether to merge the phase into `main` |
| To pause | Say "pause Label OS" in the orchestrator chat. No new sessions start |

## What the orchestrator does

1. Keeps the task status in `14-engineering-backlog.md` current (`Not Started` → `In Progress` → `In Review` → `Done`).
2. Starts at most **one** child session at a time, for the lowest-numbered task whose dependencies are `Done`.
3. Watches that task's PR:
   - relays review comments;
   - on merge, marks it Done and starts the next task.
4. Stops and asks the owner when:
   - a task hits one of the brief's hard-stop conditions;
   - CI is red twice on the same cause;
   - a task needs a product decision not covered by `15-product-decisions.md`;
   - a phase is complete.
5. Never merges PRs itself, never pushes to `main`, never applies migrations to production.

## The task prompt (sent to each child session)

```text
You are implementing ONE backlog task for BStudio Label OS: LABEL-{NN} — {TITLE}.

Read first, in this order:
  CLAUDE.md, AGENTS.md,
  docs/bstudio-label-os/00-executive-summary.md,
  docs/bstudio-label-os/15-product-decisions.md (binding decisions),
  docs/bstudio-label-os/16-execution-runbook.md,
  the task section "# LABEL-{NN}" in docs/bstudio-label-os/14-engineering-backlog.md,
  and every doc that section references.

Rules:
- Do exactly this task. Its "Out of Scope" is binding. Anything else you find goes in the PR
  description under "Found, not fixed".
- Follow the repo conventions in CLAUDE.md: Zod contracts, org-access helpers (no user_id filters
  under /api/org/*), pure logic in src/lib with Vitest tests written first, design-direction.md
  for UI.
- Migrations: next free number (check `git log --all -- supabase/migrations/`), idempotent, end with
  NOTIFY pgrst. Register them in supabase/MIGRATIONS.md as "not applied". Never apply to production.
- Everything stays behind LABEL_OS_ENABLED. No change to existing producer, store, or checkout
  behaviour unless the task says so.
- Before pushing: npx tsc --noEmit && npm test && npm run build must pass. Run /code-review on
  your diff and fix what it finds.
- Branch: label-os/LABEL-{NN}. Open a PR into claude/happy-bardeen-rnosf3 (NOT main), titled
  "LABEL-{NN}: {TITLE}", with the repo PR format: Summary / Why / Test plan /
  Required prod config / Migrations to apply.
- In the PR, check off each Acceptance Criterion with how it was verified.
- If blocked by a hard-stop condition or an undecided product question, stop and say so in the PR
  or your final message. Do not guess.
```

## Order

`14-engineering-backlog.md` → "Recommended execution order". Phase 8 items (chat, workflow builder, contract generation, multi-org store) are not started automatically. Each needs a short discovery first.

## Cost and speed notes

- **Sessions per phase:** Phase 1 is 8 sessions (LABEL-02…09; LABEL-01 is done).
- **The real pace-setter is review.** Each task waits for the owner's merge. Reviewing a small PR shortly after it opens keeps the pipeline moving.
- **If review becomes the bottleneck,** switch to "parallel where possible" for the independent pairs listed in the backlog (22 ∥ 23, 25 ∥ 26, 33 ∥ 34, 37 ∥ 38). Keep Phases 1–2 sequential.
