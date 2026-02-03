#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

MAX_REPS=20
PROMPT="PROMPT.md"

for ((i = 1; i <= MAX_REPS; i++)); do
  echo "=== Iteration $i of $MAX_REPS ==="

  tmp_out="$(mktemp)"
  codex exec --full-auto "@$PROMPT" 2>&1 | tee "$tmp_out" || true

  if grep -q "DONEZO" "$tmp_out"; then
    rm -f "$tmp_out"
    echo "=== Completed: DONEZO detected ==="
    exit 0
  fi

  rm -f "$tmp_out"
done

echo "=== Reached max iterations ($MAX_REPS) ==="
