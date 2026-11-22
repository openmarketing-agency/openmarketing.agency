"""Exercise the private workspace socket against a disposable native profile."""

from hashlib import sha256
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from threading import Lock, Thread

from hermes_cli.config import atomic_config_replace
from hermes_yaml import safe_load

if Path("/opt/oma/workspace.py").is_file():
    sys.path.insert(0, "/opt/oma")
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace import ThreadingUnixStreamServer, WorkspaceHandler


class Connection(HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


def request(address, method, path, body=None):
    client = Connection(address, timeout=10)
    try:
        client.request(method, path, json.dumps(body) if body is not None else None)
        reply = client.getresponse()
        return reply.status, json.loads(reply.read())
    finally:
        client.close()


def post(address, agent, body):
    return request(address, "POST", f"/workspace/agents/{agent}/sync", body)


with TemporaryDirectory(prefix="oma-agent-sync-") as temporary:
    os.chdir(temporary)
    home = Path(temporary).resolve()
    # Keep the Unix socket name short even on hosts with long temporary paths.
    address = "workspace.sock"
    native = home / "config.yaml"
    atomic_config_replace(native, {"model": "before", "agent": {"enabled_toolsets": ["file"]}})
    root = home / "oma"
    record = root / "agents" / "default" / "config.yaml"
    record.parent.mkdir(parents=True)
    atomic_config_replace(record, {"id": "default", "name": "Default", "description": "Test agent", "campaign_id": None,
                                   "model": "after", "agent": {"enabled_toolsets": ["file", "web"]},
                                   "oma_skills": ["fixture"]})
    skill = home / "oma-bundle" / "skills" / "fixture" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: fixture\ndescription: Test skill\n---\nFixture instructions\n", encoding="utf-8")
    with ThreadingUnixStreamServer(address, WorkspaceHandler) as server:
        server.edit_lock = Lock()
        server.plan_chat_lock = Lock()
        server.root = root
        worker = Thread(target=server.serve_forever)
        worker.start()
        try:
            stale = post(address, "default", {"revision": "0" * 64})
            assert stale[0] == 409, stale
            assert post(address, "default", {"model": "ignored"})[0] == 422
            assert post(address, "demo__worker", {})[0] == 404
            assert safe_load(native.read_bytes())["model"] == "before"
            revision = sha256(record.read_bytes()).hexdigest()
            status, result = post(address, "default", {})
            assert (status, result) == (200, {"id": "default", "revision": revision}), (status, result)
            assert safe_load(native.read_bytes()) == {"model": "after", "agent": {"enabled_toolsets": ["file", "web"]}}
            installed = home / "skills" / "fixture" / "SKILL.md"
            assert installed.read_bytes() == skill.read_bytes()
            atomic_config_replace(record, {**safe_load(record.read_bytes()), "oma_skills": []})
            assert post(address, "default", {})[0] == 200
            assert not installed.exists() and skill.exists()

            endpoint = "/workspace/agents/model"
            assert request(address, "POST", endpoint, {"revision": "0" * 64, "modelId": "not-applied"})[0] == 404
            maintenance = home / "profiles" / "maintenance" / "config.yaml"
            maintenance.parent.mkdir(parents=True)
            previous = {"model": {"default": "old-maintenance", "provider": "custom", "api_key": "${FIXTURE_KEY}"},
                        "agent": {"enabled_toolsets": ["terminal"]}}
            atomic_config_replace(maintenance, previous)
            saved_maintenance = root / "agents" / "maintenance" / "config.yaml"
            saved_maintenance.parent.mkdir()
            atomic_config_replace(saved_maintenance, {"id": "maintenance", "name": "Maintenance",
                                  "description": "Test agent", "campaign_id": None})
            baseline = request(address, "GET", "/workspace")[1]["standaloneModels"]
            assert baseline["default"] == "after" and baseline["maintenance"] == "old-maintenance"
            assert "FIXTURE_KEY" not in json.dumps(baseline)
            payload = {"revision": baseline["revision"], "modelId": "provider/new-model"}
            assert request(address, "POST", endpoint, {**payload, "profile": "demo__worker"})[0] == 422
            assert request(address, "POST", endpoint, {**payload, "modelId": "${INVALID}"})[0] == 422
            status, synced = request(address, "POST", endpoint, payload)
            assert status == 200 and synced["default"] == synced["maintenance"] == payload["modelId"]
            assert request(address, "POST", endpoint, payload)[0] == 409
            assert safe_load(record.read_bytes())["model"] == payload["modelId"]
            assert safe_load(saved_maintenance.read_bytes())["model"] == payload["modelId"]
            previous["model"]["default"] = payload["modelId"]
            assert safe_load(maintenance.read_bytes()) == previous
            assert safe_load(native.read_bytes()) == {"model": payload["modelId"], "agent": {"enabled_toolsets": ["file", "web"]}}
        finally:
            server.shutdown()
            worker.join()
print("Standalone agent sync passed over the private Unix socket")
