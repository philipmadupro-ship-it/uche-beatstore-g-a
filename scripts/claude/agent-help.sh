#!/usr/bin/env bash
set -euo pipefail

cat <<'TXT'
Antigravity Claude agent helpers

Available roles:
  planner               Plan and route work before editing.
  app-router            Route, layout, page, and server/client boundary changes.
  ui-system             Component, interaction, and design-system work.
  supabase-data         Migrations, RLS, schema, and ownership-sensitive data work.
  commerce-storefront   Storefront, checkout, merchandising, and conversion work.
  qa-test               Regression review, test planning, and release verification.

Recommended usage flow:
  1. Start with planner.
  2. Move to one specialist agent.
  3. Load matching skills from .claude/skills.

Quick examples:
  npm run claude:planner
  npm run claude:ui
  npm run claude:storefront
  npm run claude:qa
TXT
