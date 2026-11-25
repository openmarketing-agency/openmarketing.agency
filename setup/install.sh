#!/bin/bash
set -euo pipefail

usage() {
    printf 'Usage: bash %s\nInstall omactl and OMA Agent for the current user on x86-64 Debian.\n' "${0##*/}"
}
log() { printf '==> %s\n' "$*" >&2; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

case ${1:-} in
    -h|--help) usage; exit 0 ;;
    '') [[ $# == 0 ]] || { usage >&2; exit 2; } ;;
    *) usage >&2; exit 2 ;;
esac

[[ $(uname -s) == Linux && $(uname -m) == x86_64 && -r /etc/os-release ]] \
    || fail 'This installer requires x86-64 Debian.'
# shellcheck source=/dev/null
source /etc/os-release
[[ ${ID:-} == debian ]] || fail 'This installer requires Debian.'
[[ $EUID != 0 ]] || fail 'Run this installer as the Debian user who will use OMA Agent, not with sudo.'
for command in curl git; do
    command -v "$command" >/dev/null || fail 'Install prerequisites: sudo apt-get install ca-certificates curl git libatomic1'
done

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
versions_file="$script_dir/versions.yaml"
[[ -r $versions_file ]] || fail "Missing $versions_file; run the installer from the setup directory."

read_version() {
    local value
    value=$(awk -v key="$1" '
        $0 ~ "^" key ":" {
            sub(/^[^:]*:[[:space:]]*/, "")
            sub(/[[:space:]]*#.*$/, "")
            sub(/[[:space:]]+$/, "")
            print
            exit
        }
    ' "$versions_file")
    [[ -n $value ]] || fail "versions.yaml is missing a value for '$1'."
    printf '%s' "$value"
}

# setup/versions.yaml is the single source of truth for the pinned component versions.
console_version=$(read_version nextjs)
omactl_tag=$(read_version omactl)
omactl_sha=$(read_version omactl_sha256)
agent_version=$(read_version oma-agent)
agent_commit=$(read_version oma-agent_commit)
agent_installer_sha=$(read_version oma-agent_installer_sha256)
agent_repo=https://github.com/openmarketing-agency/oma-agent.git
bin_dir="$HOME/.local/bin"
omactl_dir="$HOME/.local/share/omactl/$omactl_tag"
agent_home="$HOME/.local/share/oma-agent"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

fetch_verified() {
    local url=$1 file=$2 sha=$3
    curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$url" -o "$tmp/$file"
    (cd "$tmp" && printf '%s  %s\n' "$sha" "$file" | sha256sum --check --status) \
        || fail "SHA-256 checksum mismatch for $file."
}

log "Downloading and verifying omactl $omactl_tag and OMA Agent $agent_version"
fetch_verified "https://github.com/openmarketing-agency/omactl/releases/download/$omactl_tag/omactl-linux-x64.tar.gz" omactl.tar.gz "$omactl_sha"
fetch_verified "https://raw.githubusercontent.com/openmarketing-agency/oma-agent/$agent_commit/scripts/install.sh" agent-install.sh "$agent_installer_sha"
tar -xzf "$tmp/omactl.tar.gz" --no-same-owner -C "$tmp"
[[ -x "$tmp/bin/omactl" && -s "$tmp/catalog/catalog.json" && -f "$tmp/LICENSE" ]] \
    || fail 'The omactl package is missing its executable, catalog, or license.'

log 'Installing OMA Agent from its pinned source as the current user'
HERMES_REPO_URL="$agent_repo" bash "$tmp/agent-install.sh" \
    --branch main --commit "$agent_commit" --hermes-home "$agent_home" --dir "$agent_home/hermes-agent" \
    --non-interactive --skip-browser --skip-computer-use

log "Installing omactl to $bin_dir"
install -d "$bin_dir" "$omactl_dir"
cp -a "$tmp/catalog" "$tmp/LICENSE" "$omactl_dir/"
install -m 0755 "$tmp/bin/omactl" "$bin_dir/omactl"
"$bin_dir/omactl" version
"$bin_dir/oma-agent" --version

log 'Native installation complete. Use oma-agent setup to configure your model provider.'
log "This setup pairs with the OMA console image ghcr.io/openmarketing-agency/oma-server:$console_version"
log "If the commands are not on PATH, run: export PATH=\"\$HOME/.local/bin:\$PATH\""
