#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUERY="${*:-}"
FULL=false

if [ "${1:-}" = "--full" ]; then
  FULL=true
  shift
  QUERY="${*:-}"
fi

if [ -z "$QUERY" ]; then
  cat <<'TXT'
Usage:
  npm run claude:auto -- "your task here"
  npm run claude:auto -- --full "your task here"
TXT
  exit 1
fi

q=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')
agents=(orchestrator)
skills=(product-context repo-conventions)
risks=()
notes=()
domains=()

has(){ printf '%s' "$q" | grep -Eqi "(^|[^a-z0-9])($1)([^a-z0-9]|$)"; }
push_unique(){ local n="$1"; shift; eval "local arr=(\"\${$n[@]}\")"; for x in "${arr[@]}"; do [ "$x" = "$1" ] && return 0; done; eval "$n+=(\"$1\")"; }
add_agent(){ push_unique agents "$1"; }
add_skill(){ push_unique skills "$1"; }
add_risk(){ push_unique risks "$1"; }
add_note(){ push_unique notes "$1"; }
add_domain(){ push_unique domains "$1"; }

has 'redesign|refactor|overhaul|architecture|autonomous|multi-step|cross-cutting|platform' && broad=1 || broad=0
has 'route|routes|page|pages|layout|metadata|component|ui|design|button|modal|drawer|form|interaction|theme|style|screen|view|dashboard|storefront' && {
  add_domain ui; add_agent app-router; add_agent ui-system; add_skill design-system;
}
has 'migration|migrations|supabase|rls|policy|policies|schema|column|sql|database|ownership|permission|permissions|row|row-level|query|queries|auth|session|oauth|protected' && {
  add_domain data; add_agent supabase-data; add_skill supabase-safety; add_risk data/security;
}
has 'checkout|cart|purchase|purchases|buyer|license|licenses|bundle|bundles|promo|merchandising|merch|conversion|download|delivery|pricing|price|prices|sale|sales|producer profile|store editor|project bundle' && {
  add_domain commerce; add_agent commerce-storefront; add_skill storefront-commerce; add_risk commerce;
}
has 'test|tests|testing|qa|playwright|vitest|regression|verify|validation|release|bug|broken|failing|failure' && {
  add_domain qa; add_agent qa-test; add_skill testing-release;
}
has 'auth|login|session|protected|private|oauth|callback|invite|password|checkout|download|share|token|payment|stripe|public|purchase|delivery' && {
  add_risk user-facing-critical-flow; add_agent qa-test; add_skill testing-release;
}
has 'debug|debugging|routing logic|orchestrator script|task router|task-router' && {
  add_domain router; add_agent planner; add_note 'Router/orchestrator debugging detected.';
}

[ ${#domains[@]} -eq 0 ] && { add_agent planner; add_note 'No strong domain match detected.'; }
([ "$broad" -eq 1 ] || [ ${#domains[@]} -ge 3 ]) && { add_agent planner; add_note 'Broad or cross-domain task detected.'; }
has 'add|create|build|implement|fix|update|improve|refactor|tighten|change|debug' && add_note 'Actionable task.' || add_note 'May need clarification.'

printf 'task: %s\n' "$QUERY"
printf 'agents: %s\n' "$(IFS=', '; echo "${agents[*]}")"
printf 'skills: %s\n' "$(IFS=', '; echo "${skills[*]}")"
[ ${#domains[@]} -gt 0 ] && printf 'domains: %s\n' "$(IFS=', '; echo "${domains[*]}")"
[ ${#risks[@]} -gt 0 ] && printf 'risks: %s\n' "$(IFS=', '; echo "${risks[*]}")"
printf 'notes: %s\n' "$(IFS=' '; echo "${notes[*]}")"

if [ "$FULL" = true ]; then
  printf '\n'
  for agent in "${agents[@]}"; do
    [ -f "$ROOT/.claude/agents/$agent.md" ] || continue
    printf '===== .claude/agents/%s.md =====\n\n' "$agent"
    cat "$ROOT/.claude/agents/$agent.md"
    printf '\n\n'
  done
  for skill in "${skills[@]}"; do
    [ -f "$ROOT/.claude/skills/$skill.md" ] || continue
    printf '===== .claude/skills/%s.md =====\n\n' "$skill"
    cat "$ROOT/.claude/skills/$skill.md"
    printf '\n\n'
  done
fi
