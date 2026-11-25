#!/bin/bash
# Shared read-only preflight for both tag-triggered release jobs.
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
log() { printf '==> %s\n' "$*" >&2; }

read_version() {
    local value
    value=$(awk -v key="$1" '
        $0 ~ "^" key ":" {
            sub(/^[^:]*:[[:space:]]*/, "")
            sub(/[[:space:]]*#.*$/, "")
            sub(/[[:space:]]+$/, "")
            print; exit
        }
    ' "$manifest")
    [[ -n $value ]] || fail "$manifest is missing a value for '$1'."
    printf '%s' "$value"
}

[[ $GITHUB_REF_NAME =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid release tag: $GITHUB_REF_NAME."
log "Validating release $GITHUB_REF_NAME"
manifest="versions/${GITHUB_REF_NAME#v}.yaml"
[[ -f $manifest ]] || fail "No release manifest $manifest for tag $GITHUB_REF_NAME."
release_version=$(read_version version)
[[ v$release_version == "$GITHUB_REF_NAME" ]] \
    || fail "$manifest version ($release_version) must match release tag $GITHUB_REF_NAME without the v prefix."
semver='^[0-9]+\.[0-9]+\.[0-9]+$'

# A tag existing in Git is expected. An existing GitHub Release is a conflict.
log 'Checking for an existing GitHub Release'
if response=$(gh api --include "repos/$GITHUB_REPOSITORY/releases/tags/$GITHUB_REF_NAME" 2>/dev/null); then
    fail "GitHub Release $GITHUB_REF_NAME already exists in $GITHUB_REPOSITORY."
fi
status=$(awk 'NR == 1 && $1 ~ /^HTTP\// { print $2 }' <<< "$response")
[[ $status == 404 ]] \
    || fail "Could not check whether GitHub Release $GITHUB_REF_NAME exists (HTTP ${status:-unavailable})."

console_version=$(read_version oma-console)
omactl_version=$(read_version omactl)
agent_version=$(read_version oma-agent)
[[ $console_version =~ $semver ]] || fail "Invalid oma-console version ($console_version) in $manifest."
[[ $omactl_version =~ $semver ]] || fail "Invalid omactl version ($omactl_version) in $manifest."
[[ $agent_version =~ $semver ]] || fail "Invalid oma-agent version ($agent_version) in $manifest."
omactl_tag="v$omactl_version"
agent_tag="v$agent_version"
camofox_image=$(read_version camofox_image)

check_asset() {
    curl --proto '=https' --proto-redir '=https' --fail --silent --show-error \
        --location --head --retry 2 --max-time 30 -o /dev/null "$1"
}

log "Checking omactl $omactl_tag archive and checksums"
omactl_url="https://github.com/openmarketing-agency/omactl/releases/download/$omactl_tag"
for asset in omactl-linux-x64.tar.gz SHA256SUMS; do
    check_asset "$omactl_url/$asset" || fail "omactl $omactl_tag: $asset is not available."
done

log "Checking oma-agent $agent_tag source tag and installer"
agent_ref="refs/tags/$agent_tag"
agent_commit=$(git ls-remote --exit-code https://github.com/openmarketing-agency/oma-agent.git "$agent_ref" "$agent_ref^{}" |
    awk -v ref="$agent_ref" '$2 == ref { tag = $1 }
        $2 == ref "^{}" { commit = $1 }
        END { print (commit != "" ? commit : tag) }') \
    || fail "oma-agent release tag $agent_tag is not available."
[[ $agent_commit =~ ^[0-9a-f]{40}$ ]] || fail "Invalid commit for oma-agent release tag $agent_tag."
check_asset "https://raw.githubusercontent.com/openmarketing-agency/oma-agent/$agent_commit/scripts/install.sh" \
    || fail "oma-agent $agent_tag: scripts/install.sh is not available."

log 'Checking the pinned Camofox image'
docker manifest inspect "$camofox_image" >/dev/null \
    || fail "Camofox image $camofox_image is not available."

{
    printf 'release_version=%s\n' "$release_version"

    printf 'console_version=%s\n' "$console_version"
    printf 'omactl_tag=%s\n' "$omactl_tag"
    printf 'agent_tag=%s\n' "$agent_tag"
    printf 'camofox_image=%s\n' "$camofox_image"
} >> "$GITHUB_OUTPUT"
log "Release $GITHUB_REF_NAME passed preflight"
