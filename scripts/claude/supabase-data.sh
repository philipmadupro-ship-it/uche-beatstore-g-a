#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/scripts/claude/open-doc.sh" .claude/agents/supabase-data.md
printf '\n'
"$ROOT/scripts/claude/open-doc.sh" .claude/skills/supabase-safety.md
printf '\n'
"$ROOT/scripts/claude/open-doc.sh" .claude/skills/repo-conventions.md
