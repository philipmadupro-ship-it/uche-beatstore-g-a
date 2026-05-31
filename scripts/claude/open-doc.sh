#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <relative-path>" >&2
  exit 1
fi

FILE="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/$FILE"

if [ ! -f "$TARGET" ]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

printf '\n===== %s =====\n\n' "$FILE"
cat "$TARGET"
