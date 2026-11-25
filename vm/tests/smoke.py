import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import dotenv_values
from hermes_yaml import safe_load
from tools.clarify_gateway import resolve_clarify_timeout
from tools.skills_tool import skill_view

root = Path("/opt/data")
gateway_seed = root / ".oma" / "gateway-seed"
started = time.monotonic()
url = "http://127.0.0.1:8642/v1/models"
while True:
    try:
        key = hmac.digest(gateway_seed.read_bytes(), b"default", "sha256").hex()
        with urlopen(Request(url, headers={"Authorization": f"Bearer {key}"}), timeout=2) as response:
            assert json.load(response)["data"]
        with socket.create_connection(("127.0.0.1", 9119), timeout=2):
            break
    except (OSError, URLError):
        if time.monotonic() - started > 90:
            raise
        time.sleep(1)
try:
    urlopen(url, timeout=2).close()
except HTTPError as error:
    assert error.code == 401
else:
    raise AssertionError("Gateway accepted an unauthenticated request")

for name in ("campaigns", "skills", "seed"):
    assert not (Path("/opt/oma") / name).exists(), name
assert not (root / ".oma" / "installed.json").exists()
assert not any((root / "oma" / "campaigns").glob("*/config.yaml"))
for agent in ("default", "maintenance"):
    record = safe_load((root / "oma" / "agents" / agent / "config.yaml").read_bytes())
    assert record["id"] == agent and record["campaign_id"] is None
assert gateway_seed.stat().st_mode & 0o777 == 0o600
state = hashlib.sha256(gateway_seed.read_bytes()).hexdigest()
config = safe_load((root / "config.yaml").read_text())
assert config["model"]["provider"] == "openrouter"
assert resolve_clarify_timeout(config) == 0
if os.environ["OMA_INIT_CATALOG"] == "1":
    assert (root / ".oma" / "omactl.yml").is_file()
    try:
        urlopen("http://127.0.0.1:9080", timeout=2).close()
    except HTTPError as error:
        assert error.code == 404

state_file = root / ".oma-smoke-test.json"
member_file = root / "profiles" / "maintenance" / "skills" / "member-smoke" / "SKILL.md"
if sys.argv[1] == "fresh":
    skill = json.loads(skill_view("oma-campaigns", preprocess=False))
    content = skill.get("content", "")
    assert all(rule in content for rule in (
        "Use `integrations` for the smallest set of canonical connections",
        "Save the IDs before asking the user to connect missing accounts",
        "Use `integration_categories` to suggest the types of tools",
    ))
    assert config["model"]["default"] == "oma-image-smoke"
    assert not dotenv_values(root / ".env", interpolate=False).get("OPENROUTER_API_KEY")
    member_file.parent.mkdir(parents=True)
    member_file.write_text("Member-created skill\n")
    state_file.write_text(state)
else:
    assert config["model"]["default"] == "member-model"
    assert dotenv_values(root / ".env", interpolate=False).get("OPENROUTER_API_KEY") == "synthetic-key-for-test-only"
    assert member_file.read_text() == "Member-created skill\n"
    assert state_file.read_text() == state
print(f"VM {sys.argv[1]}: gateway, dashboard, and both standalone records ready; no preinstalled campaigns")
