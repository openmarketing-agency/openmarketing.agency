#!/bin/bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
image=${1:?Pass the image tag to test}
engine=${CONTAINER_ENGINE:-docker}
container="oma-vm-smoke-$$"
volume=$("$engine" volume create)
mount="type=volume,source=$volume,target=/opt/data,volume-nocopy"
if [[ "$engine" == podman ]]; then mount="type=volume,source=$volume,target=/opt/data"; fi
network=none
if [[ "${OMA_TEST_CATALOG:-0}" == 1 ]]; then network=bridge; fi
stale_pid_file=$(mktemp)

cleanup() {
    if (( $? != 0 )); then "$engine" logs "$container" || true; fi
    "$engine" rm -f "$container" >/dev/null 2>&1 || true
    rm -f -- "$stale_pid_file"
    "$engine" volume rm "$volume" >/dev/null
}
trap cleanup EXIT

"$engine" run --detach --name "$container" --privileged --network "$network" \
    --mount "$mount" \
    -e OMA_HERMES_MODEL=oma-image-smoke \
    -e OMA_HERMES_CLARIFY_TIMEOUT=0 \
    -e OMA_INIT_CATALOG="${OMA_TEST_CATALOG:-0}" \
    "$image"

guest() { "$engine" exec --interactive --user hermes "$container" "$@"; }
omactl_tag=$("$engine" image inspect "$image" --format '{{index .Config.Labels "agency.openmarketing.omactl.version"}}')
guest /opt/hermes/.venv/bin/python - fresh < "$root/tests/smoke.py"
guest /opt/hermes/.venv/bin/python - < "$root/tests/workspace.py"
guest /opt/hermes/.venv/bin/python - < "$root/tests/tool_selections.py"
if guest test -f /opt/hermes/hermes_cli/oma_campaigns/standalone.py; then
    guest /opt/hermes/.venv/bin/python - < "$root/tests/standalone_sync.py"
fi
guest /opt/hermes/.venv/bin/python - < "$root/tests/bundled_campaign_sync.py"
guest /opt/hermes/.venv/bin/python - < "$root/tests/campaign_deploy.py"
guest /opt/hermes/.venv/bin/python - < "$root/tests/test_campaign_publications.py"
guest /opt/hermes/.venv/bin/python - < "$root/tests/campaign_kanban.py"
guest bash -euo pipefail -c '
    test -x /usr/local/bin/omactl
    omactl version --json | python -c "import json, sys; assert json.load(sys.stdin)[\"data\"][\"version\"] == sys.argv[1]" "$1"
    test -s /opt/omactl/catalog/catalog.json
    omactl doctor --json
    docker compose version
    test "$(docker info --format "{{.DockerRootDir}}")" = /opt/data/.docker-engine
    docker volume create oma-smoke-persist
' _ "${omactl_tag#v}"

# Set a model and credential on the disposable profile after keyless startup.
guest /opt/hermes/.venv/bin/python - <<'PY'
from pathlib import Path

from dotenv import set_key
from hermes_cli.config import atomic_config_replace, require_readable_config_before_write

root = Path("/opt/data")
config_path = root / "config.yaml"
config = require_readable_config_before_write(config_path)
config.setdefault("clarify", {})["timeout"] = 90
config["model"]["default"] = "member-model"
atomic_config_replace(config_path, config)
set_key(root / ".env", "OPENROUTER_API_KEY", "synthetic-key-for-test-only")
PY

"$engine" stop "$container" >/dev/null
# Simulate a previous daemon leaving its PID file behind. PID 1 belongs to
# the container's init on the next boot, so dockerd must ignore this file.
printf '1\n' > "$stale_pid_file"
"$engine" cp "$stale_pid_file" "$container:/run/docker.pid"
"$engine" start "$container" >/dev/null
guest /opt/hermes/.venv/bin/python - restart < "$root/tests/smoke.py"
guest docker volume inspect oma-smoke-persist >/dev/null
