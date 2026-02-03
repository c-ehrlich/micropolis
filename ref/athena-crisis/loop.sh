#!/bin/bash
set -e

cd "$(dirname "$0")"

PACKAGES=(
  apollo
  ares
  art
  artemis
  athena
  codegen
  deimos
  dionysus
  docs
  eslint-plugin
  fixtures
  hera
  hermes
  i18n
  infra
  offline
  scripts
  tests
  ui
  zeus
)

for pkg in "${PACKAGES[@]}"; do
  if [ -d "$pkg" ]; then
    echo "=== Generating OVERVIEW.md for $pkg ==="
    codex exec \
      --full-auto \
      "You are in the monorepo for the game \"Athena Crisis\". You can see an overview of the structure in @OVERVIEW.md. Analyze the '$pkg/' package and create '$pkg/OVERVIEW.md' summarizing its purpose, structure, and how it interacts with other packages in this monorepo. Be thorough. Focus especially on interfaces, data structures, data flows, systems, etc. The goal is that you could leter recreate this package in another language if we wanted to, or use the architecture and lessons learned from this package to build a version for a different game in the future."
  fi
done

echo "Done!"
