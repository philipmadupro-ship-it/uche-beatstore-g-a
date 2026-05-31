#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUERY="${*:-}"

if [ -z "$QUERY" ]; then
  cat <<'TXT'
Usage:
  npm run claude:auto -- "your task here"

Examples:
  npm run claude:auto -- "fix mobile checkout trust section"
  npm run claude:auto -- "add project bundle analytics"
  npm run claude:auto -- "tighten RLS for purchase downloads"
TXT
  exit 1
fi

lower_query=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')

agents=("orchestrator")
skills=("product-context" "repo-conventions")
risks=()
notes=()
matched_domains=()

contains() {
  case "$lower_query" in
    *"$1"*) return 0 ;;
    *) return 1 ;;
  esac
}

contains_word() {
  local pattern="$1"
  printf '%s' "$lower_query" | grep -Eqi "(^|[^a-z0-9])(${pattern})([^a-z0-9]|$)"
}

add_agent() {
  local item="$1"
  for existing in "${agents[@]}"; do
    [ "$existing" = "$item" ] && return 0
  done
  agents+=("$item")
}

add_skill() {
  local item="$1"
  for existing in "${skills[@]}"; do
    [ "$existing" = "$item" ] && return 0
  done
  skills+=("$item")
}

add_risk() {
  local item="$1"
  for existing in "${risks[@]}"; do
    [ "$existing" = "$item" ] && return 0
  done
  risks+=("$item")
}

add_note() {
  local item="$1"
  for existing in "${notes[@]}"; do
    [ "$existing" = "$item" ] && return 0
  done
  notes+=("$item")
}

add_domain() {
  local item="$1"
  for existing in "${matched_domains[@]}"; do
    [ "$existing" = "$item" ] && return 0
  done
  matched_domains+=("$item")
}

broad=false
for token in redesign refactor overhaul architecture system end-to-end full complete autonomous multi-step cross-cutting platform; do
  if contains "$token"; then broad=true; break; fi
done

ui_hit=false
for token in route routes page pages layout metadata component ui design button modal drawer form interaction theme style screen view; do
  if contains_word "$token"; then
    ui_hit=true
    add_domain "ui"
    break
  fi
done

if contains_word 'dashboard|storefront|store'; then
  ui_hit=true
  add_domain "ui"
fi

if [ "$ui_hit" = true ]; then
  add_agent "app-router"
  add_agent "ui-system"
  add_skill "design-system"
fi

data_hit=false
for token in migration migrations supabase rls policy policies schema column sql database ownership permission permissions row row-level query queries; do
  if contains_word "$token"; then
    data_hit=true
    add_domain "data"
    break
  fi
done

if contains_word 'auth|session|oauth|protected'; then
  data_hit=true
  add_domain "data"
fi

if [ "$data_hit" = true ]; then
  add_agent "supabase-data"
  add_skill "supabase-safety"
  add_risk "data/security"
fi

commerce_hit=false
for token in checkout cart purchase purchases buyer license licenses bundle bundles promo merchandising merch conversion download delivery pricing price prices sale sales; do
  if contains_word "$token"; then
    commerce_hit=true
    add_domain "commerce"
    break
  fi
done

if contains_word 'project bundle|producer profile|store editor'; then
  commerce_hit=true
  add_domain "commerce"
fi

if [ "$commerce_hit" = true ]; then
  add_agent "commerce-storefront"
  add_skill "storefront-commerce"
  add_risk "commerce"
fi

test_hit=false
for token in test tests testing qa playwright vitest regression verify validation release bug broken failing failure debug debugging; do
  if contains_word "$token"; then
    test_hit=true
    add_domain "qa"
    break
  fi
done

if [ "$test_hit" = true ]; then
  add_agent "qa-test"
  add_skill "testing-release"
fi

critical_hit=false
for token in auth login session protected private oauth callback invite password checkout download share token payment stripe public purchase delivery; do
  if contains_word "$token"; then
    critical_hit=true
    break
  fi
done

if [ "$critical_hit" = true ]; then
  add_risk "user-facing-critical-flow"
  add_agent "qa-test"
  add_skill "testing-release"
fi

if contains_word 'debug|debugging|routing logic|orchestrator script|task router|task-router'; then
  add_domain "router"
  add_note "Router/orchestrator debugging detected; inspect classification rules before changing agent prompts."
  add_agent "planner"
fi

if [ "$broad" = true ] || [ ${#matched_domains[@]} -ge 3 ]; then
  add_agent "planner"
  add_note "Broad or cross-domain task detected; use planner before implementation."
fi

if [ ${#matched_domains[@]} -eq 0 ]; then
  add_note "No strong domain match detected; start with orchestrator and planner for clarification."
  add_agent "planner"
fi

if printf '%s' "$lower_query" | grep -Eq '\b(add|create|build|implement|fix|update|improve|refactor|tighten|change|debug)\b'; then
  add_note "This looks actionable; orchestrator should sequence implementation, then QA if risks apply."
else
  add_note "This may be exploratory; orchestrator can clarify intent before editing code."
fi

printf '\n=== Claude autonomous task router ===\n\n'
printf 'Task: %s\n\n' "$QUERY"
printf 'Primary entrypoint: orchestrator\n\n'

if [ ${#matched_domains[@]} -gt 0 ]; then
  printf 'Matched domains:\n'
  for domain in "${matched_domains[@]}"; do
    printf ' - %s\n' "$domain"
  done
  printf '\n'
fi

printf 'Recommended agents:\n'
for agent in "${agents[@]}"; do
  printf ' - %s\n' "$agent"
done
printf '\n'

printf 'Recommended skills:\n'
for skill in "${skills[@]}"; do
  printf ' - %s\n' "$skill"
done
printf '\n'

if [ ${#risks[@]} -gt 0 ]; then
  printf 'Risk flags:\n'
  for risk in "${risks[@]}"; do
    printf ' - %s\n' "$risk"
  done
  printf '\n'
fi

printf 'Execution order:\n'
for agent in "${agents[@]}"; do
  printf ' - %s\n' "$agent"
done
printf '\n'

printf 'Notes:\n'
for note in "${notes[@]}"; do
  printf ' - %s\n' "$note"
done
printf '\n'

printf 'Context bundle:\n\n'
for agent in "${agents[@]}"; do
  if [ -f "$ROOT/.claude/agents/$agent.md" ]; then
    printf '===== .claude/agents/%s.md =====\n\n' "$agent"
    cat "$ROOT/.claude/agents/$agent.md"
    printf '\n\n'
  fi
done

for skill in "${skills[@]}"; do
  if [ -f "$ROOT/.claude/skills/$skill.md" ]; then
    printf '===== .claude/skills/%s.md =====\n\n' "$skill"
    cat "$ROOT/.claude/skills/$skill.md"
    printf '\n\n'
  fi
done
