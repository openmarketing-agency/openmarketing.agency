#!/bin/bash
set -euo pipefail
shopt -s nullglob

export HERMES_HOME=/opt/oma/seed
export HOME="$HERMES_HOME" HERMES_DIR=/opt/hermes
export HERMES_WRITE_SAFE_ROOT="$HERMES_HOME"
cd /opt/oma

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
printf '{}\n' > "$scratch/setup.yaml"
touch "$scratch/setup.env"

manifests=(campaigns/*/config.yaml)
(( ${#manifests[@]} > 0 )) || { echo 'No campaigns found' >&2; exit 1; }
for manifest in "${manifests[@]}"; do
    campaign=${manifest%/config.yaml}
    bun installer/src/cli.ts install "${campaign##*/}" \
        --setup "$scratch/setup.yaml" --setup-env "$scratch/setup.env" --skills-dir /opt/oma/skills
done
cp oma-soul.md "$HERMES_HOME/SOUL.md"
