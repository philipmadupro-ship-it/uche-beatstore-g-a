#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/scripts/claude/open-doc.sh" .claude/agents/qa-test.md
printf '\n'
"$ROOT/scripts/claude/open-doc.sh" .claude/skills/testing-release.md
printf '\n'
"$ROOT/scripts/claude/open-doc.sh" .claude/skills/product-context.md
