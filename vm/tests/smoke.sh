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
    -e OMA_LITELLM_URL=http://127.0.0.1:8080/v1 \
    -e OMA_LITELLM_KEY=image-smoke-test-key \
    -e OMA_HERMES_MODEL=oma-image-smoke \
    -e OMA_HERMES_CLARIFY_TIMEOUT=0 \
    -e OMA_INIT_CATALOG="${OMA_TEST_CATALOG:-0}" \
    "$image"

guest() { "$engine" exec --interactive --user hermes "$container" "$@"; }
omactl_tag=$("$engine" image inspect "$image" --format '{{index .Config.Labels "agency.openmarketing.omactl.version"}}')
guest /opt/hermes/.venv/bin/python - fresh < "$root/tests/smoke.py"
guest bash -euo pipefail -c '
    test -x /usr/local/bin/omactl
    omactl version --json | python -c "import json, sys; assert json.load(sys.stdin)[\"data\"][\"version\"] == sys.argv[1]" "$1"
    test -s /opt/omactl/catalog/catalog.json
    omactl doctor --json
    docker compose version
    test "$(docker info --format "{{.DockerRootDir}}")" = /opt/data/.docker-engine
    docker volume create oma-smoke-persist
' _ "${omactl_tag#v}"

# Seed the old source references before the restart to model an existing VM volume.
guest /opt/hermes/.venv/bin/python - <<'PY'
import json
from pathlib import Path

from hermes_cli.config import atomic_config_replace, require_readable_config_before_write

root = Path("/opt/data")
config_path = root / "config.yaml"
config = require_readable_config_before_write(config_path)
config.setdefault("clarify", {})["timeout"] = 90
atomic_config_replace(config_path, config)

registry = root / ".oma" / "installed.json"
installed = json.loads(registry.read_bytes())
for campaign in installed["playbooks"]:
    campaign["source"] = str(Path("/opt/oma/playbooks") / campaign["id"])
registry.write_text(json.dumps(installed))
soul = root / "SOUL.md"
soul.write_text(soul.read_text().replace(
    "Their sources are in `/opt/oma/campaigns`",
    "The bundled sources are in `/opt/oma/playbooks`",
    1,
))
PY

"$engine" stop "$container" >/dev/null
# Simulate a previous daemon leaving its PID file behind. PID 1 belongs to
# the container's init on the next boot, so dockerd must ignore this file.
printf '1\n' > "$stale_pid_file"
"$engine" cp "$stale_pid_file" "$container:/run/docker.pid"
"$engine" start "$container" >/dev/null
guest /opt/hermes/.venv/bin/python - restart < "$root/tests/smoke.py"
guest docker volume inspect oma-smoke-persist >/dev/null
