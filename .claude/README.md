# Claude workspace setup

This project includes an autonomous Claude multi-agent setup for Antigravity.

## Structure

- `.claude/agents/` — orchestration and specialist agent briefs.
- `.claude/skills/` — reusable project skills capturing domain context, repo conventions, design system rules, Supabase safety, storefront behavior, and testing/release rules.

## Agent model

- `orchestrator` is the default autonomous lead agent.
- `planner` supports decomposition for broad or risky work.
- Specialists handle implementation and validation by domain.

## Autonomous flow

1. Start with `orchestrator`.
2. Let it classify the task and load the right skills.
3. Route to the smallest set of specialist agents needed.
4. Run `qa-test` for risky or user-facing flows before considering work done.
5. Keep `AGENTS.md` as product truth and `CLAUDE.md` as engineering truth.

## Recommended mapping

- Product definition → `AGENTS.md`
- Engineering conventions → `CLAUDE.md`
- Autonomous lead → `.claude/agents/orchestrator.md`
- Specialist roles → `.claude/agents/*`
- Reusable implementation rules → `.claude/skills/*`
