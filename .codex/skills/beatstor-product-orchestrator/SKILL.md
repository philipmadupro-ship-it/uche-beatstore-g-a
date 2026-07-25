---
name: beatstor-product-orchestrator
description: Use for broad Beatstor/Antigravity continuation work, especially when a request references the full product prompt, prior conversations, "the end goal", workspace skills, execution logs, acceptance gaps, or multiple surfaces such as player, discovery, commerce, upload, dashboard, accessibility, performance, and release readiness.
---

# Beatstor Product Orchestrator

## Purpose

Use this as the first skill for broad continuation work. It keeps the full prompt in view, routes to the right domain skills, and prevents accidental narrowing of the product goal to whichever feature was touched most recently.

## Required Context

Read only what the current task needs:

- `AGENTS.md` for product behavior, surfaces, data model, and design constraints.
- `CLAUDE.md` for stack, commands, folder conventions, and known gotchas.
- `docs/codex-execution-log.md` for prior passes, tests, unresolved concerns, and evidence.
- `references/current-progress-map.md` when choosing the next pass from prior conversation/work lanes.
- `references/prompt-acceptance-map.md` when auditing progress against the full build prompt or deciding the next highest-value pass.

## Routing Workflow

1. Start with the execution log and identify the most recent remaining concerns.
2. Select the smallest useful skill set that covers the next product gap.
3. Inspect the current code before trusting prior notes.
4. Implement against existing routes, helpers, hooks, primitives, and data contracts.
5. Run checks that prove the changed workflow, not just nearby syntax.
6. Append a log entry with skills used, area inspected, changes, tests, problems found/fixed, and remaining concerns.

## Skill Bundles

- Full prompt or unclear continuation: `repository-audit`, then this skill, then the relevant domain skill.
- Public discovery/search/cards: `beat-discovery-experience`, `responsive-ui-engineering`, `accessibility-and-keyboard-navigation`, `qa-and-regression-testing`.
- Player, waveform, queue, route persistence: `audio-player-engineering` or `cover-waveform-player`, plus `performance-optimization`.
- Cart, license tiers, checkout, orders, downloads: `marketplace-and-licensing`, `authentication-and-permissions`, `database-and-api-architecture`.
- Producer library, upload, publish, analytics: `producer-dashboard`, `upload-and-file-management`, `authentication-and-permissions`.
- Design-system or visual identity: `beatstor-design-system`, `de-roche-visual-system`, `design-system-configurator`, `ui-polish-review`.
- Security, storage, RLS, privileged routes: `database-and-api-architecture`, `authentication-and-permissions`, `antigravity-supabase-safety`.
- Release readiness: `qa-and-regression-testing`, `performance-optimization`, `accessibility-and-keyboard-navigation`, `ui-polish-review`.

## Completion Discipline

Treat completion as unproven until every explicit prompt deliverable has current evidence. Use `references/prompt-acceptance-map.md` as the audit checklist. A green build or a few focused tests prove only the areas they cover.

Do not mark the broad goal complete when:

- A required surface exists but has not been browser-verified.
- A workflow depends on credentials, auth state, storage, Stripe, Resend, or Supabase and has not been verified or clearly called out.
- Known warnings remain undocumented.
- The execution log has not been updated for the pass.

## Output

For broad continuations, produce a concise status summary: skills used, files changed, verification run, and the next unresolved prompt gap. Keep the execution log as the durable source of detail.
