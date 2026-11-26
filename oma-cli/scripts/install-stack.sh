#!/bin/bash
set -euo pipefail

usage() {
    printf 'Usage: sudo oma install [version]\nInstalls the entire pinned release under /opt/oma on x86-64 Debian or Ubuntu. The native agent runs as root.\n'
}
log() { printf '==> %s\n' "$*" >&2; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

if [[ $# -eq 1 && ( $1 == -h || $1 == --help ) ]]; then usage; exit 0; fi
[[ $# -eq 0 ]] || { usage >&2; exit 2; }
mode=${OMA_STACK_STAGE:-install}
[[ $mode == install || $mode == setup || $mode == docker ]] || fail 'Unknown stack installer stage.'

log 'Checking host and release prerequisites'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 && -r /etc/os-release ]] \
    || fail 'This installer requires x86-64 Debian or Ubuntu.'
# shellcheck source=/dev/null
source /etc/os-release
[[ ${ID:-} == debian || ${ID:-} == ubuntu ]] || fail 'This installer requires Debian or Ubuntu.'
[[ $EUID == 0 ]] || fail 'Run OMA installation as root: sudo oma install'


script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
versions_file="$script_dir/versions.yaml"
[[ -r $versions_file ]] || fail "Missing $versions_file; use the installer from the extracted stack release."

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

# The release build ships its selected versions/<release>.yaml as versions.yaml.
console_version=$(read_version oma-console)
omactl_version=$(read_version omactl)
agent_version=$(read_version oma-agent)
semver='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ $console_version =~ $semver ]] || fail 'oma-console must be a bare X.Y.Z version.'
[[ $omactl_version =~ $semver ]] || fail 'omactl must be a bare X.Y.Z version.'
[[ $agent_version =~ $semver ]] || fail 'oma-agent must be a bare X.Y.Z version.'
omactl_tag="v$omactl_version"
camofox_image=$(read_version camofox_image)
agent_repo=https://github.com/openmarketing-agency/oma-agent.git
omactl_release="https://github.com/openmarketing-agency/omactl/releases/download/$omactl_tag"
oma_root=/opt/oma
bin_dir="$oma_root/bin"
agent_dir="$oma_root/oma-agent"
agent_home="$oma_root/oma-agent-data"
omactl_dir="$oma_root/omactl/$omactl_tag"
console_data="$oma_root/oma-console-data"
camofox_env="$agent_home/camofox.env"
keys_file="$oma_root/keys.txt"
shared_dir="$oma_root/run/console"
private_network=oma-console-private
release=$(read_version version)
[[ $release =~ $semver ]] || fail 'version must be a bare X.Y.Z version.'

if [[ -e $oma_root || -L $oma_root ]]; then
    [[ ! -L $oma_root && -d $oma_root && -O $oma_root ]] \
        || fail "$oma_root must be a root-owned directory, not a symlink."
    root_mode=$(stat -c '%a' "$oma_root")
    (( (8#$root_mode & 022) == 0 )) || fail "$oma_root must not be group- or world-writable."
fi

console_image="ghcr.io/openmarketing-agency/oma-console:v$console_version"
frontend_port=${OMA_FRONTEND_PORT:-3000}
bind_address=${OMA_BIND_ADDRESS:-127.0.0.1}
ownership="agency.openmarketing.oma.installation=$oma_root"
release_label="agency.openmarketing.oma.release=$release"
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///var/run/docker.sock

ensure_docker() {
    command -v docker >/dev/null || fail 'Docker is missing; run sudo oma install.'
    docker info >/dev/null 2>&1 && return 0
    log 'Starting the Docker daemon'
    if [[ -d /run/systemd/system ]]; then
        systemctl start docker || fail 'Could not start Docker. Check: sudo systemctl status docker'
    else
        service docker start || fail 'Could not start Docker. Check: sudo service docker status'
    fi
    for ((attempt=0; attempt<30; attempt++)); do
        docker info >/dev/null 2>&1 && return 0
        sleep 1
    done
    fail 'Docker did not become ready.'
}

if [[ $mode == docker ]]; then ensure_docker; exit 0; fi

check_container() {
    local name=$1 existing managed
    existing=$(docker container ls -a --filter "name=^/${name}$" --format '{{.Names}}')
    managed=$(docker container ls -a --filter "name=^/${name}$" --filter "label=$ownership" --format '{{.Names}}')
    [[ -z $existing || $existing == "$managed" ]] || fail "Container $name already exists and is not managed by oma."
}

install_stack() {
local packages=() dependency
for dependency in ca-certificates curl git libatomic1; do
    [[ $(dpkg-query -W -f='${Status}' "$dependency" 2>/dev/null) == 'install ok installed' ]] || packages+=("$dependency")
done
command -v docker >/dev/null || packages+=(docker.io)
if [[ ${#packages[@]} -gt 0 ]]; then
    log "Installing host packages: ${packages[*]}"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
fi
ensure_docker
for image in "$console_image" "$camofox_image"; do
    log "Pulling $image"
    docker pull "$image" || fail "Could not pull $image; check that the pinned version is published."
done
install -d -m 0755 "$oma_root" "$bin_dir"

tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

fetch() {
    curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$1" -o "$tmp/$2"
}

log "Resolving OMA Agent $agent_version"
agent_ref="refs/tags/v$agent_version"
# Use the commit behind an annotated tag, or the ref itself for a lightweight tag.
agent_commit=$(git ls-remote --exit-code "$agent_repo" "$agent_ref" "$agent_ref^{}" |
    awk -v ref="$agent_ref" '$2 == ref { tag = $1 }
        $2 == ref "^{}" { commit = $1 }
        END { print (commit != "" ? commit : tag) }') \
    || fail "Could not resolve OMA Agent release tag $agent_version."
[[ $agent_commit =~ ^[0-9a-f]{40}$ ]] || fail "Invalid commit for OMA Agent release tag $agent_version."

fetch "https://raw.githubusercontent.com/openmarketing-agency/oma-agent/$agent_commit/scripts/install.sh" agent-install.sh

log "Installing OMA Agent as root in $agent_dir"
install -d -m 0700 "$agent_home" "$agent_home/install-home"
# Keep upstream's user-local launcher, shell files, and bootstrap caches out of /root.
HOME="$agent_home/install-home" XDG_DATA_HOME="$agent_home/install-home/.local/share" \
    XDG_CACHE_HOME="$agent_home/install-home/.cache" XDG_CONFIG_HOME="$agent_home/install-home/.config" \
    HERMES_RUNTIME_DIR="$agent_home/tools" HERMES_REPO_URL="$agent_repo" bash "$tmp/agent-install.sh" \
    --branch main --commit "$agent_commit" --hermes-home "$agent_home" --dir "$agent_dir" \
    --non-interactive --skip-browser --skip-computer-use
agent_launcher="$agent_dir/.hermes/bin/hermes"
[[ -x $agent_launcher ]] || fail "OMA Agent did not publish its launcher at $agent_launcher."
printf '#!/bin/sh\nif [ "$(id -u)" -ne 0 ]; then echo "Run oma-agent as root." >&2; exit 1; fi\nexport PATH="%s:$PATH"\nexport HERMES_HOME="${HERMES_HOME:-%s}"\nexec "%s" "$@"\n' \
    "$bin_dir" "$agent_home" "$agent_launcher" > "$tmp/oma-agent"
install -m 0755 "$tmp/oma-agent" "$bin_dir/oma-agent"
"$bin_dir/oma-agent" --version

log "Downloading omactl $omactl_tag"
fetch "$omactl_release/omactl-linux-x64.tar.gz" omactl-linux-x64.tar.gz
fetch "$omactl_release/SHA256SUMS" omactl.sha256
(cd "$tmp" && awk '$2 == "omactl-linux-x64.tar.gz" { print; exit }' omactl.sha256 |
    sha256sum --check --status) || fail "SHA-256 checksum verification failed for omactl $omactl_tag."
tar -xzf "$tmp/omactl-linux-x64.tar.gz" --no-same-owner -C "$tmp"
[[ -x "$tmp/bin/omactl" && -s "$tmp/catalog/catalog.json" && -f "$tmp/LICENSE" ]] \
    || fail 'The omactl package is missing its executable, catalog, or license.'
log "Installing omactl to $bin_dir"
install -d "$omactl_dir/bin"
cp -a "$tmp/catalog" "$tmp/LICENSE" "$omactl_dir/"
install -m 0755 "$tmp/bin/omactl" "$omactl_dir/bin/omactl"
printf '#!/bin/sh\nexport OMA_HOME="${OMA_HOME:-%s/omactl-data}"\nexec "%s/bin/omactl" "$@"\n' \
    "$oma_root" "$omactl_dir" > "$tmp/omactl"
install -m 0755 "$tmp/omactl" "$bin_dir/omactl"
"$bin_dir/omactl" version
log 'Stack installed. Next: sudo oma setup, then sudo oma start.'
}

create_container() {
    local name=$1 image=$2
    shift 2
    if docker container inspect "$name" >/dev/null 2>&1; then
        if [[ $(docker container inspect --format '{{index .Config.Labels "agency.openmarketing.oma.release"}}' "$name") == "$release" ]]; then
            return 0
        fi
        [[ $(docker container inspect --format '{{.State.Status}}' "$name") =~ ^(created|exited|dead)$ ]] \
            || fail "$name is running; run sudo oma stop before reconfiguring it."
        log "Replacing the stopped $name container"
        docker rm "$name" >/dev/null
    fi
    log "Creating stopped container $name"
    docker create --pull never --name "$name" --label "$ownership" --label "$release_label" --init "$@" "$image" >/dev/null
}

write_env() {
    local file=$1 name=$2 value=$3 dir staging
    dir=$(dirname -- "$file")
    install -d -m 700 "$dir"
    staging=$(mktemp "$dir/.env.XXXXXX")
    chmod 600 "$staging"
    if [[ -f $file ]]; then
        if [[ $(read_env "$file" "$name") == "$value" ]]; then rm -f -- "$staging"; return 0; fi
        awk -v name="$name" '$0 !~ "^[[:space:]]*(export[[:space:]]+)?" name "[[:space:]]*="' "$file" > "$staging"
    fi
    printf '%s=%s\n' "$name" "$value" >> "$staging"
    mv -- "$staging" "$file"
}

read_env() {
    [[ -f $1 ]] || return 0
    # Read a single assignment without sourcing the file or evaluating expansions.
    awk -v name="$2" '
        $0 ~ "^[[:space:]]*(export[[:space:]]+)?" name "[[:space:]]*=" {
            sub(/^[^=]*=[[:space:]]*/, "")
            sub(/[[:space:]]+#.*$/, "")
            sub(/[[:space:]]+$/, "")
            if ($0 ~ /^"[^"]*"$/ || $0 ~ /^\047[^\047]*\047$/) $0 = substr($0, 2, length($0)-2)
            value = $0
        }
        END { print value }
    ' "$1"
}

prepare_keys() {
    local native_env="$agent_home/.env" native_key requested_key=${OMA_INTEGRATION_ENCRYPTION_KEY:-} new_keys=false
    [[ ! -L $native_env && ( ! -e $native_env || ( -f $native_env && -O $native_env ) ) ]] \
        || fail "$native_env must be a root-owned regular file, not a symlink."
    native_key=$(read_env "$native_env" API_SERVER_KEY)
    if [[ -e $keys_file || -L $keys_file ]]; then
        [[ ! -L $keys_file && -f $keys_file && -O $keys_file && $(stat -c '%a:%h' "$keys_file") == 600:1 ]] \
            || fail "$keys_file must be a root-owned regular file with mode 0600 and no other links."
        gateway_key=$(read_env "$keys_file" API_SERVER_KEY)
        integration_key=$(read_env "$keys_file" OMA_INTEGRATION_ENCRYPTION_KEY)
        [[ -z $native_key || $native_key == "$gateway_key" ]] \
            || fail "The agent API key differs from the key saved in $keys_file; refusing to rotate it."
        [[ -z $requested_key || $requested_key == "$integration_key" ]] \
            || fail "The supplied integration key differs from the key saved in $keys_file; refusing to rotate it."
    else
        new_keys=true
        gateway_key=$native_key
        integration_key=$requested_key
        [[ -n $gateway_key ]] || gateway_key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
        [[ -n $integration_key ]] || integration_key=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_')
    fi
    [[ $gateway_key =~ ^[A-Za-z0-9._~+/-]+=*$ ]] || fail 'Invalid or missing saved API_SERVER_KEY.'
    # A Fernet key encodes 32 bytes (43 base64 characters before optional padding).
    [[ $integration_key =~ ^[A-Za-z0-9_+/-]{43}=?$ ]] || fail 'OMA_INTEGRATION_ENCRYPTION_KEY must be a valid Fernet key.'
    if [[ $new_keys == true ]]; then
        (
            umask 077
            staging=$(mktemp "$oma_root/.keys.XXXXXX")
            trap 'rm -f -- "$staging"' EXIT
            printf 'API_SERVER_KEY=%s\nOMA_INTEGRATION_ENCRYPTION_KEY=%s\n' "$gateway_key" "$integration_key" > "$staging"
            ln -- "$staging" "$keys_file" || fail "Could not create $keys_file without overwriting it; retry the installation."
        )
    fi
    [[ -n $native_key ]] || write_env "$native_env" API_SERVER_KEY "$gateway_key"
}

setup_stack() {
[[ -x $bin_dir/oma-agent && -x $bin_dir/omactl ]] || fail 'OMA is not installed. Run sudo oma install first.'
ensure_docker
check_container oma-console
check_container oma-camofox
for image in "$console_image" "$camofox_image"; do
    docker image inspect "$image" >/dev/null 2>&1 || fail "Missing $image; run sudo oma install to restore it."
done
if ! docker network inspect "$private_network" >/dev/null 2>&1; then
    log 'Creating the private Console–Hermes Docker network'
    docker network create --driver bridge --label "$ownership" "$private_network" >/dev/null
fi
[[ $(docker network inspect --format '{{index .Labels "agency.openmarketing.oma.installation"}}' "$private_network") == "$oma_root" ]] \
    || fail "Docker network $private_network is not managed by OMA."
gateway_host=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' "$private_network")
[[ $gateway_host =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || fail 'OMA Docker network has no IPv4 gateway.'

log "Preparing private service keys in $keys_file"
prepare_keys
write_env "$agent_home/.env" API_SERVER_ENABLED true
write_env "$agent_home/.env" API_SERVER_HOST "$gateway_host"
write_env "$agent_home/.env" API_SERVER_PORT 8642
write_env "$agent_home/.env" GATEWAY_MULTIPLEX_PROFILES true

[[ ! -L $oma_root/run && ! -L $shared_dir ]] || fail 'The private console runtime directory must not be a symlink.'
install -d -m 0755 "$oma_root/run"
install -d -m 2750 -o 0 -g 10000 "$shared_dir"
chmod 2750 "$shared_dir"
if [[ ! -f $shared_dir/gateway.key || $(<"$shared_dir/gateway.key") != "$gateway_key" ]]; then
    local key_stage
    key_stage=$(mktemp "$shared_dir/.key.XXXXXX")
    printf '%s\n' "$gateway_key" > "$key_stage"
    chown 0:10000 "$key_stage"
    chmod 0640 "$key_stage"
    mv -- "$key_stage" "$shared_dir/gateway.key"
fi

# Keep the same key across reinstalls and share it with the native profiles.
camofox_key=
if [[ -r $camofox_env ]]; then
    camofox_key=$(awk -F= '$1 == "CAMOFOX_API_KEY" { print $2; exit }' "$camofox_env")
fi
[[ -n $camofox_key ]] || camofox_key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
write_env "$camofox_env" CAMOFOX_API_KEY "$camofox_key"
for profile in "$agent_home" "$agent_home/profiles/maintenance"; do
    [[ -d $profile ]] || continue
    write_env "$profile/.env" CAMOFOX_URL 'http://127.0.0.1:9377'
    write_env "$profile/.env" CAMOFOX_API_KEY "$camofox_key"
done

CAMOFOX_API_KEY="$camofox_key" CAMOFOX_ACCESS_KEY="$camofox_key" create_container oma-camofox "$camofox_image" \
    --shm-size 512m \
    -p "127.0.0.1:9377:9377" \
    -e CAMOFOX_API_KEY -e CAMOFOX_ACCESS_KEY

# The console image runs as the Node image's unprivileged user (1000:1000).
install -d -m 0700 -o 1000 -g 1000 "$console_data"
OMA_INTEGRATION_ENCRYPTION_KEY="$integration_key" create_container oma-console "$console_image" \
    --network "$private_network" --group-add 10000 \
    -p "$bind_address:$frontend_port:3000" \
    -v "$console_data:/app/data" \
    --mount "type=bind,src=$shared_dir,dst=/run/oma-console,readonly" \
    -e OMA_DATA_DIR=/app/data \
    -e OMA_ENVIRONMENT=production \
    -e "OMA_BIND_ADDRESS=$bind_address" \
    -e "OMA_FRONTEND_PORT=$frontend_port" \
    -e "OMA_APP_URL=${OMA_APP_URL:-http://localhost:$frontend_port}" \
    -e "OMA_COOKIE_SECURE=${OMA_COOKIE_SECURE:-false}" \
    -e OMA_SECRET_KEY \
    -e OMA_INTEGRATION_ENCRYPTION_KEY \
    -e "OMA_REGISTRATION_ENABLED=${OMA_REGISTRATION_ENABLED:-true}" \
    -e "OMA_CORS_ORIGINS=${OMA_CORS_ORIGINS:-[]}" \
    -e "OMA_DOCS_ENABLED=${OMA_DOCS_ENABLED:-true}" \
    -e COMPOSIO_API_KEY \
    -e "OMA_AGENT_URL=http://$gateway_host:8642" \
    -e OMA_AGENT_API_KEY_FILE=/run/oma-console/gateway.key \
    -e OMA_WORKSPACE_SOCKET=/run/oma-console/workspace.sock
}

case "$mode" in
    install) install_stack ;;
    setup) setup_stack; printf '%s\n' "$gateway_host" > "$script_dir/.setup-host.$$"; mv -- "$script_dir/.setup-host.$$" "$script_dir/setup-host" ;;
esac
