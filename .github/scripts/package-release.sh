#!/bin/bash
# Build stack release assets without shipping or building the standalone CLI.
set -euo pipefail
log() { printf '==> %s\n' "$*" >&2; }

release_version=${1:?Pass the bare OMA release version.}
output=${2:?Pass an output directory.}
semver='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ $release_version =~ $semver ]] || { printf 'Expected a bare OMA release version.\n' >&2; exit 1; }

manifest="versions/$release_version.yaml"
[[ -f $manifest && $(awk '$1 == "version:" { print $2; exit }' "$manifest") == "$release_version" ]] \
    || { printf 'Missing or mismatched release manifest %s.\n' "$manifest" >&2; exit 1; }
if grep -q '^oma-cli:' "$manifest"; then printf 'The CLI version must not be pinned by the stack.\n' >&2; exit 1; fi
installer=oma-cli/scripts/install-stack.sh
bash -n "$installer"

setup_package="oma-setup-v$release_version-linux-amd64"

mkdir -p "$output"
output=$(CDPATH='' cd -- "$output" && pwd)
stage=$(mktemp -d "$output/.stage.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT

mkdir -p "$stage/$setup_package/setup"
cp "$installer" "$stage/$setup_package/setup/install.sh"
cp vm/workspace.py vm/campaign_activity.py vm/custom_mcp.py vm/sync_standalone.py "$stage/$setup_package/setup/"
cp "$manifest" "$stage/$setup_package/setup/versions.yaml"
cp LICENSE "$stage/$setup_package/"
cp "$manifest" "$output/versions.yaml"
log "Packaging the OMA $release_version stack installer"
tar -C "$stage" -czf "$output/$setup_package.tar.gz" "$setup_package"
(cd "$output" && sha256sum "$setup_package.tar.gz" versions.yaml > SHA256SUMS)
log 'Stack archive and checksums are ready'
