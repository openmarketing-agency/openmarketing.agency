#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

if [[ $(uname -m) != x86_64 || $(uname -s) != Linux ]]; then
    echo 'OMA VM requires an x86-64 Linux host.' >&2
    exit 1
fi

if [[ ! -f VERSION || ! -f compose.release.yaml || ! -f compose.vm.yaml || ! -f compose.yaml ]]; then
    echo 'Run install.sh from the extracted OMA VM release package.' >&2
    exit 1
fi
export OMA_RELEASE_TAG
OMA_RELEASE_TAG=$(<VERSION)
if [[ ! "$OMA_RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo 'Invalid OMA VM package version.' >&2
    exit 1
fi

if ! command -v docker >/dev/null; then
    source /etc/os-release
    if [[ $ID != ubuntu || $VERSION_ID != 24.04 || $EUID != 0 ]]; then
        echo 'Install Docker Engine and Compose 2.24.4+ first, or run this installer as root on Ubuntu 24.04.' >&2
        exit 1
    fi
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
    systemctl enable --now docker
fi

compose_version=$(docker compose version --short 2>/dev/null || true)
compose_version=${compose_version#v}
if [[ -z "$compose_version" || $(printf '%s\n' 2.24.4 "$compose_version" | sort -V | head -n 1) != 2.24.4 ]]; then
    echo 'Install Docker Compose 2.24.4 or later.' >&2
    exit 1
fi
docker info >/dev/null
docker compose -p oma -f compose.yaml -f compose.vm.yaml -f compose.release.yaml up \
    --detach --no-build --pull missing --wait --wait-timeout 1800
