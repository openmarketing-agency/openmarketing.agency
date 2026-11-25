#!/bin/bash
set -euo pipefail

usage() {
    printf 'Usage: bash %s\nInstall omactl, OMA Agent, the console, and Camofox for the current user on x86-64 Debian.\n' "${0##*/}"
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
console_version=$(read_version oma-server)
omactl_tag=$(read_version omactl)
omactl_sha=$(read_version omactl_sha256)
agent_version=$(read_version oma-agent)
agent_commit=$(read_version oma-agent_commit)
agent_installer_sha=$(read_version oma-agent_installer_sha256)
camofox_image=$(read_version camofox_image)
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

# The console and the Camofox browser sidecar run as containers from the pinned
# versions, mirroring compose.yaml and compose.camofox.yaml.
command -v docker >/dev/null 2>&1 \
    || fail 'Docker is required for the console and Camofox containers: sudo apt-get install docker.io'
docker info >/dev/null 2>&1 \
    || fail 'The docker command is not usable by this user. Start the daemon and add this user to the docker group.'

console_image="ghcr.io/openmarketing-agency/oma-server:$console_version"
frontend_port=${OMA_FRONTEND_PORT:-3000}
bind_address=${OMA_BIND_ADDRESS:-127.0.0.1}
console_data="$HOME/.local/share/oma-server/data"
camofox_env="$agent_home/camofox.env"

run_container() {
    local name=$1 image=$2
    shift 2
    if docker container inspect "$name" >/dev/null 2>&1; then
        log "Replacing the existing $name container"
        docker rm -f "$name" >/dev/null
    fi
    docker pull "$image" || fail "Could not pull $image; check that the pinned version is published."
    docker run -d --name "$name" --restart unless-stopped --init "$@" "$image" >/dev/null
}

# Camofox and the agent share one generated API key, kept private so a re-run
# reuses it, as `make dev` does with .env.camofox.
camofox_key=
if [[ -r $camofox_env ]]; then
    camofox_key=$(awk -F= '$1 == "CAMOFOX_API_KEY" { print $2; exit }' "$camofox_env")
fi
[[ -n $camofox_key ]] || camofox_key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')

write_env() {
    local file=$1 name=$2 value=$3 dir staging
    dir=$(dirname -- "$file")
    install -d -m 700 "$dir"
    staging=$(mktemp "$dir/.env.XXXXXX")
    chmod 600 "$staging"
    if [[ -f $file ]]; then
        grep -v -E "^[[:space:]]*$name=" "$file" > "$staging" || true
    fi
    printf '%s=%s\n' "$name" "$value" >> "$staging"
    mv -- "$staging" "$file"
}

write_env "$camofox_env" CAMOFOX_API_KEY "$camofox_key"
for profile in "$agent_home" "$agent_home/profiles/maintenance"; do
    [[ -d $profile ]] || continue
    write_env "$profile/.env" CAMOFOX_URL 'http://127.0.0.1:9377'
    write_env "$profile/.env" CAMOFOX_API_KEY "$camofox_key"
done

log "Starting Camofox ($camofox_image)"
run_container oma-camofox "$camofox_image" \
    --shm-size 512m \
    -p "127.0.0.1:9377:9377" \
    -e "CAMOFOX_API_KEY=$camofox_key" \
    -e "CAMOFOX_ACCESS_KEY=$camofox_key"

install -d -m 700 "$console_data"
log "Starting the console ($console_image)"
run_container oma-server "$console_image" \
    --add-host host.docker.internal:host-gateway \
    -p "$bind_address:$frontend_port:3000" \
    -v "$console_data:/app/data" \
    -e OMA_DATA_DIR=/app/data \
    -e OMA_ENVIRONMENT=production \
    -e "OMA_BIND_ADDRESS=$bind_address" \
    -e "OMA_FRONTEND_PORT=$frontend_port" \
    -e "OMA_APP_URL=${OMA_APP_URL:-http://localhost:$frontend_port}" \
    -e "OMA_COOKIE_SECURE=${OMA_COOKIE_SECURE:-false}" \
    -e "OMA_SECRET_KEY=${OMA_SECRET_KEY:-}" \
    -e "OMA_REFRESH_SECRET_KEY=${OMA_REFRESH_SECRET_KEY:-}" \
    -e "OMA_INTEGRATION_ENCRYPTION_KEY=${OMA_INTEGRATION_ENCRYPTION_KEY:-}" \
    -e "OMA_REGISTRATION_ENABLED=${OMA_REGISTRATION_ENABLED:-true}" \
    -e "OMA_CORS_ORIGINS=${OMA_CORS_ORIGINS:-[]}" \
    -e "OMA_DOCS_ENABLED=${OMA_DOCS_ENABLED:-true}" \
    -e "COMPOSIO_API_KEY=${COMPOSIO_API_KEY:-}" \
    -e "OMA_AGENT_URL=${OMA_AGENT_URL:-}" \
    -e "OMA_AGENT_API_KEY=${OMA_AGENT_API_KEY:-}"

wait_healthy() {
    local label=$1 url=$2 limit=$3
    local deadline=$((SECONDS + limit))
    until curl -fsS -m 2 -o /dev/null "$url"; do
        ((SECONDS < deadline)) \
            || fail "$label is not healthy after ${limit}s; inspect it with: docker logs"
        sleep 2
    done
    log "$label is healthy"
}

log 'Waiting for the new containers to report healthy'
wait_healthy Camofox 'http://127.0.0.1:9377/health' 120
wait_healthy 'The console' "http://127.0.0.1:$frontend_port/health/ready" 120

log 'Native installation complete. Use oma-agent setup to configure your model provider.'
log "Console: http://localhost:$frontend_port (container oma-server from $console_image)"
log "Camofox: http://127.0.0.1:9377 (container oma-camofox); the API key is in $camofox_env"
log "If the commands are not on PATH, run: export PATH=\"\$HOME/.local/bin:\$PATH\""
