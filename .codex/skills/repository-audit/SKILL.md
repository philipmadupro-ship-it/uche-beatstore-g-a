---
name: repository-audit
description: Use before major Beatstor or Antigravity implementation work to inspect architecture, dependencies, routes, APIs, auth, storage, audio, styling, tests, deployment config, incomplete areas, and technical risks so new work preserves useful existing code.
---

# Repository Audit

## Activation

Use when starting broad product work, investigating unknown code, planning a feature that spans surfaces, or before replacing existing components.

## Workflow

1. Read `AGENTS.md` and `CLAUDE.md`.
2. Inspect `package.json`, `next.config.ts`, `tsconfig.json`, `vercel.json`, and env examples.
3. Map routes under `src/app`, especially `store`, `(dashboard)`, share routes, and `api`.
4. Map reusable components under `src/components`, hooks under `src/hooks`, and pure helpers under `src/lib`.
5. Inspect Supabase migrations and security docs when data changes are likely.
6. Identify existing implementation to reuse, missing infrastructure, and likely risks.

## Checklist

- Framework, package manager, scripts, and test commands known.
- Auth boundary checked: public store/share vs private dashboard.
- Audio state, upload, storage, and public/private media paths understood.
- Styling conventions and UI primitives identified.
- Existing tests and CI known.
- Duplicate implementation risk called out.

## Expected Output

Repository map, reusable components, risk list, missing infrastructure, and recommended implementation sequence.
