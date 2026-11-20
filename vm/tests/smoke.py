import hashlib
import hmac
import json
import os
from pathlib import Path
from shutil import copytree
import socket
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from cron.jobs import load_jobs, use_cron_store
from hermes_cli.oma_playbooks.source import resolve as resolve_campaign
from hermes_yaml import safe_load
from tools.clarify_gateway import resolve_clarify_timeout


def check_seed_recovery(playbook):
    sys.path.insert(0, "/opt/oma")
    from bootstrap import seed_disk

    seed = Path("/opt/oma/seed")
    with TemporaryDirectory() as staging:
        disk = Path(staging)
        metadata = disk / ".oma"
        metadata.mkdir()
        marker = metadata / ".vm-seed-in-progress"
        marker.write_bytes((seed / ".oma" / "installed.json").read_bytes())
        profile = Path("profiles") / playbook["orchestrator"]
        copytree(seed / profile, disk / profile, symlinks=True)
        sentinel = disk / profile / "seeded-before-restart"
        sentinel.touch()

        registry = seed_disk(disk, seed)
        assert registry.is_file() and not marker.exists()
        assert sentinel.is_file()
        for agent in playbook["agents"]:
            assert (disk / "profiles" / agent["id"] / "config.yaml").is_file()


def check_routes(coordinators):
    started = time.monotonic()
    for profile in ["default", *coordinators]:
        prefix = "" if profile == "default" else f"/p/{profile}"
        url = f"http://127.0.0.1:8642{prefix}/v1/models"
        while True:
            try:
                key = hmac.digest(gateway_seed.read_bytes(), profile.encode(), "sha256").hex()
                request = Request(url, headers={"Authorization": f"Bearer {key}"})
                with urlopen(request, timeout=2) as response:
                    assert json.load(response)["data"], f"No models for {profile}"
                break
            except (FileNotFoundError, TimeoutError, URLError, ConnectionError) as error:
                if time.monotonic() - started > 90:
                    raise RuntimeError(f"Gateway route unavailable for {profile}") from error
                time.sleep(1)
        try:
            urlopen(url, timeout=2).close()
        except HTTPError as error:
            assert error.code == 401, f"Unexpected unauthenticated status for {profile}: {error.code}"
        else:
            raise AssertionError(f"Gateway accepted an unauthenticated request for {profile}")

    while True:
        try:
            with socket.create_connection(("127.0.0.1", 9119), timeout=2):
                print(f"Gateway and dashboard ready after {time.monotonic() - started:.1f}s of probing")
            break
        except OSError:
            if time.monotonic() - started > 90:
                raise
            time.sleep(1)


root = Path("/opt/data")
registry = root / ".oma" / "installed.json"
gateway_seed = root / ".oma" / "gateway-seed"
campaigns_dir = Path("/opt/oma/campaigns")
assert not Path("/opt/oma/playbooks").exists()
manifests = [safe_load(path.read_text()) for path in campaigns_dir.glob("*/config.yaml")]
for manifest in manifests:
    resolved = resolve_campaign(campaigns_dir, Path("/opt/oma/skills"), manifest["id"])
    assert resolved.orchestrator == manifest["orchestrator"]
check_routes([manifest["orchestrator"] for manifest in manifests])
installed = json.loads(registry.read_bytes())
playbooks = installed["playbooks"]
assert all(playbook["source"] == str(campaigns_dir / playbook["id"]) for playbook in playbooks)
assert manifests and {playbook["id"] for playbook in playbooks} == {manifest["id"] for manifest in manifests}

assert gateway_seed.stat().st_mode & 0o777 == 0o600
docker_state = {
    str(registry.relative_to(root)): hashlib.sha256(json.dumps(installed, sort_keys=True).encode()).hexdigest(),
    str(gateway_seed.relative_to(root)): hashlib.sha256(gateway_seed.read_bytes()).hexdigest(),
}
config = safe_load((root / "config.yaml").read_text())
model = config["model"]
assert model["default"] == "oma-image-smoke"
assert model["provider"] == "custom:oma-inference"
assert resolve_clarify_timeout(config) == 0
if os.environ["OMA_INIT_CATALOG"] == "1":
    assert (root / ".oma" / "omactl.yml").is_file()
    try:
        urlopen("http://127.0.0.1:9080", timeout=2).close()
    except HTTPError as error:
        assert error.code == 404, f"Unexpected ingress status: {error.code}"
for playbook in playbooks:
    assert any(agent["active"] for agent in playbook["agents"])
    for agent in playbook["agents"]:
        profile = root / "profiles" / agent["id"]
        for skill in agent["skills"]:
            assert (profile / "skills" / skill["id"] / "SKILL.md").is_file()
        with use_cron_store(profile):
            jobs = load_jobs()
        assert {job["id"] for job in jobs} == set(agent["jobs"])
        assert all(job["state"] == "paused" and job["enabled"] is False for job in jobs)
        job_store = profile / "cron" / "jobs.json"
        if job_store.is_file():
            docker_state[str(job_store.relative_to(root))] = hashlib.sha256(job_store.read_bytes()).hexdigest()

soul = root / "SOUL.md"
state_file = root / ".oma-smoke-test.json"
member_skill = root / "profiles" / playbooks[0]["orchestrator"] / "skills" / "member-smoke" / "SKILL.md"
if sys.argv[1] == "fresh":
    check_seed_recovery(playbooks[0])
    with soul.open("a") as stream:
        stream.write("\nMember edit from image smoke test.\n")
    member_skill.parent.mkdir(parents=True)
    member_skill.write_text("Member-created skill\n")
    state_file.write_text(json.dumps(docker_state))
else:
    assert "Member edit from image smoke test." in soul.read_text()
    assert "`/opt/oma/campaigns`" in soul.read_text()
    assert "`/opt/oma/playbooks`" not in soul.read_text()
    assert member_skill.read_text() == "Member-created skill\n"
    assert json.loads(state_file.read_text()) == docker_state
