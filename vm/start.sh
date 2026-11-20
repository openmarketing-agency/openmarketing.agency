#!/bin/bash
set -euo pipefail

# Agent37 mounts the member disk over the image's /opt/data directory.
if [[ -L "$HERMES_HOME" || -L "$XDG_RUNTIME_DIR" ]]; then
    echo 'VM state and runtime directories must not be symlinks' >&2
    exit 1
fi
mkdir -p "$HERMES_HOME" "$XDG_RUNTIME_DIR"
chown -h hermes:hermes "$HERMES_HOME" "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"
cd "$HERMES_HOME"
/command/s6-setuidgid hermes /opt/hermes/.venv/bin/python /opt/oma/bootstrap.py
unset OPENROUTER_API_KEY OMA_LITELLM_URL OMA_LITELLM_KEY OMA_HERMES_GATEWAY_SEED

trap 'kill $(jobs -pr) 2>/dev/null || true; wait' EXIT
# Agent37's custom VM kernels can need these modules before Docker can use nftables.
if ! iptables -t nat -S >/dev/null 2>&1 && [[ -r "/lib/modules/$(uname -r)/modules.dep" ]]; then
    modprobe -a nf_tables nft_compat nft_chain_nat br_netfilter
fi
dockerd --host=unix:///run/docker.sock --group=docker --data-root=/opt/data/.docker-engine &
/command/s6-setuidgid hermes timeout 45 bash -c 'until docker info >/dev/null 2>&1; do sleep 1; done'

if [[ "${OMA_INIT_CATALOG:-0}" == 1 ]]; then
    /command/s6-setuidgid hermes omactl init --catalog /opt/omactl/catalog --channel pinned --http-port 9080
fi

if [[ "$HERMES_DASHBOARD" == 1 ]]; then
    HERMES_DASHBOARD_SESSION_TOKEN="file:$HERMES_HOME/.oma-dashboard-token" \
        /command/s6-setuidgid hermes hermes dashboard \
        --host "$HERMES_DASHBOARD_HOST" --port "$HERMES_DASHBOARD_PORT" --no-open &
fi
/command/s6-setuidgid hermes hermes gateway run &

# An unexpected exit should be visible to the hosting provider.
wait -n
exit 1
