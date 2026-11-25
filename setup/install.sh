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

# omactl publishes an x86-64 archive; OMA Agent publishes a native source installer.
omactl_tag=v0.1.0
omactl_sha=24bbb2443de35879b8952f9db8cb61e2f59b5d4e2bc33bba5eb6f10d71f03f40
agent_commit=a3d92e8232cb19e6027075238883c650c47c4fc4 # v0.1.25
agent_installer_sha=8cc2786bf717f1038b5b49f5457ab454a654bb542bca1d339f8520f3f875fe42
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

log "Downloading and verifying omactl $omactl_tag and OMA Agent v0.1.25"
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
log "If the commands are not on PATH, run: export PATH=\"\$HOME/.local/bin:\$PATH\""
