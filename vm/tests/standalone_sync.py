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


def post(address, agent, body):
    client = Connection(address, timeout=10)
    try:
        client.request("POST", f"/workspace/agents/{agent}/sync", json.dumps(body))
        reply = client.getresponse()
        return reply.status, json.loads(reply.read())
    finally:
        client.close()


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
        finally:
            server.shutdown()
            worker.join()
print("Standalone agent sync passed over the private Unix socket")
