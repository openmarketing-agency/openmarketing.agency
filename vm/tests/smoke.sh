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

cleanup() {
    if (( $? != 0 )); then "$engine" logs "$container" || true; fi
    "$engine" rm -f "$container" >/dev/null 2>&1 || true
    "$engine" volume rm "$volume" >/dev/null
}
trap cleanup EXIT

"$engine" run --detach --name "$container" --privileged --network "$network" \
    --mount "$mount" \
    -e OMA_LITELLM_URL=http://127.0.0.1:8080/v1 \
    -e OMA_LITELLM_KEY=image-smoke-test-key \
    -e OMA_HERMES_MODEL=oma-image-smoke \
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

"$engine" restart "$container" >/dev/null
guest /opt/hermes/.venv/bin/python - restart < "$root/tests/smoke.py"
guest docker volume inspect oma-smoke-persist >/dev/null
