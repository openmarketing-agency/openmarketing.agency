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
from unittest.mock import patch

from agent.secret_scope import load_env_file
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
        client.request(method, path, json.dumps(body) if body is not None else None,
                       {"Content-Type": "application/json"} if body is not None else {})
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
            assert post(address, "default", {"revision": "0" * 64})[0] == 422
            assert post(address, "default", {"model": "ignored"})[0] == 422
            assert post(address, "demo__worker", {})[0] == 404
            assert safe_load(native.read_bytes())["model"] == "before"
            status, result = post(address, "default", {})
            revision = sha256(record.read_bytes()).hexdigest()
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

            config = safe_load(saved_maintenance.read_bytes())
            config["model"] = {"default": payload["modelId"], "api_key": "${TEST_MODEL_KEY}"}
            config["mcp_servers"] = {
                "example": {"url": "https://example.invalid/mcp", "headers": {"X-Key": "${TEST_MCP_KEY}"}},
                "disabled": {"enabled": False, "headers": {"X-Key": "${TEST_DISABLED_KEY}"}},
            }
            atomic_config_replace(saved_maintenance, config)
            original = saved_maintenance.read_bytes()
            revision = sha256(original).hexdigest()
            profile_env = maintenance.parent / ".env"
            profile_env.write_text("KEEP_KEY=keep-me\n", encoding="utf-8")
            body = {"env": {"TEST_MODEL_KEY": "new-model-secret", "TEST_MCP_KEY": "new-mcp-secret",
                    "TEST_DISABLED_KEY": "ignored", "TEST_UNREFERENCED_KEY": "ignored"}}
            assert post(address, "maintenance", {**body, "revision": revision})[0] == 422
            assert post(address, "maintenance", {**body, "env": {"TEST_MODEL_KEY": "bad\nvalue"}})[0] == 422
            assert post(address, "maintenance", {"env": {**body["env"], "PATH": "invalid-override"}})[0] == 422
            assert load_env_file(profile_env) == {"KEEP_KEY": "keep-me"}
            status, result = post(address, "maintenance", body)
            latest = sha256(saved_maintenance.read_bytes()).hexdigest()
            assert (status, result) == (200, {"id": "maintenance", "revision": latest})
            expected = {"KEEP_KEY": "keep-me", **body["env"]}
            assert load_env_file(profile_env) == expected
            assert not (home / ".env").exists()
            assert safe_load(saved_maintenance.read_bytes()) == {
                **config, "all-keys": sorted(expected), "available-keys": sorted(expected),
            }
            assert safe_load(maintenance.read_bytes())["model"] == config["model"]
            assert safe_load(maintenance.read_bytes())["mcp_servers"] == config["mcp_servers"]
            assert post(address, "maintenance", {"env": {}})[0] == 200
            assert load_env_file(profile_env)["TEST_MODEL_KEY"] == "new-model-secret"

            from hermes_cli.oma_campaigns.install import install

            campaign = root / "campaigns" / "seo" / "config.yaml"
            campaign.parent.mkdir(parents=True)
            role = root / "agents" / "seo__orchestrator"
            role.mkdir()
            (role / "SOUL.md").write_text("Coordinate the campaign.\n", encoding="utf-8")
            atomic_config_replace(role / "config.yaml", {
                "id": "seo__orchestrator", "name": "Orchestrator", "description": "Test role.",
                "campaign_id": "seo", "agent": {"enabled_toolsets": ["kanban"]},
            })
            campaign_config = {"id": "seo", "name": "SEO", "description": "Test campaign.",
                               "agents": ["seo__orchestrator"], "orchestrator": "seo__orchestrator",
                               "integrations": ["google-analytics"], "model": ""}
            atomic_config_replace(campaign, campaign_config)
            with patch.dict(os.environ, {"HOME": str(home), "HERMES_HOME": str(home),
                                         "HERMES_DISABLE_LAZY_INSTALLS": "1"}):
                assert install(home, "seo")["lifecycle_state"] == "paused"
                lifecycle = "/workspace/campaigns/seo/lifecycle"
                assert request(address, "PUT", lifecycle, {"state": "resumed", "env": {}})[0] == 422
                no_model = request(address, "PUT", lifecycle, {"state": "resumed"})
                assert no_model == (409, {
                    "id": "seo", "state": "paused", "missing_model": True,
                    "message": "Configure a campaign model before resuming.",
                }), no_model
                atomic_config_replace(campaign, {**safe_load(campaign.read_bytes()), "model": "fixture-model"})
                sync = {"revision": sha256(campaign.read_bytes()).hexdigest(), "env": {"EXTRA_TOOL_TOKEN": "extra-fixture"}}
                assert request(address, "POST", "/workspace/campaigns/seo/sync", sync)[0] == 200
                assert load_env_file(home / "profiles/seo__orchestrator/.env")["EXTRA_TOOL_TOKEN"] == "extra-fixture"
                assert safe_load(campaign.read_bytes())["available-keys"] == ["EXTRA_TOOL_TOKEN"]
                for state in ("resumed", "paused"):
                    assert request(address, "PUT", lifecycle, {"state": state}) == (200, {"id": "seo", "state": state})
        finally:
            server.shutdown()
            worker.join()
print("Standalone sync, campaign sync, and campaign lifecycle passed over the private Unix socket")
