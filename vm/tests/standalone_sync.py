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

from agent.runtime_scope import bind_profile_scope
from agent.secret_scope import load_env_file
from hermes_cli.config import atomic_config_replace
from hermes_cli.runtime_provider import resolve_runtime_provider
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
            base_url = "https://openrouter.ai/api/v1"
            missing = {"revision": "0" * 64, "modelId": "not-applied", "provider": "openrouter", "baseUrl": base_url}
            assert request(address, "POST", endpoint, missing)[0] == 404
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
            assert baseline["default"]["modelId"] == "after"
            assert baseline["maintenance"]["modelId"] == "old-maintenance"
            assert baseline["maintenance"]["provider"] == "custom"
            assert "FIXTURE_KEY" not in json.dumps(baseline)
            payload = {"revision": baseline["revision"], "modelId": "provider/new-model",
                       "provider": "openrouter", "baseUrl": base_url}
            assert request(address, "POST", endpoint, {**payload, "profile": "demo__worker"})[0] == 422
            assert request(address, "POST", endpoint, {**payload, "modelId": "${INVALID}"})[0] == 422
            for invalid in ("", "http://openrouter.ai/api/v1", "https://user@openrouter.ai/api/v1"):
                assert request(address, "POST", endpoint, {**payload, "baseUrl": invalid})[0] == 422
            assert request(address, "POST", endpoint, {**payload, "provider": "custom", "baseUrl": ""})[0] == 422
            status, staged = request(address, "POST", endpoint, payload)
            assert status == 200, staged
            assert request(address, "POST", endpoint, payload)[0] == 409
            expected = {"default": payload["modelId"], "provider": "openrouter", "base_url": base_url}
            for agent_id, path in (("default", record), ("maintenance", saved_maintenance)):
                assert safe_load(path.read_bytes())["model"] == expected
                assert staged["revisions"][agent_id] == sha256(path.read_bytes()).hexdigest()
            assert safe_load(native.read_bytes())["model"] == "after"
            assert safe_load(maintenance.read_bytes()) == previous
            assert post(address, "default", {"revision": staged["revisions"]["default"]})[0] == 200
            assert safe_load(maintenance.read_bytes()) == previous
            assert post(address, "maintenance", {"revision": staged["revisions"]["maintenance"]})[0] == 200
            assert safe_load(native.read_bytes()) == {"model": expected, "agent": {"enabled_toolsets": ["file", "web"]}}
            assert safe_load(maintenance.read_bytes()) == {"model": expected, "agent": {"enabled_toolsets": ["terminal"]}}

            key = "sk-or-v1-test-standalone-key"
            key_env = {"HERMES_MODEL_API_KEY": key}
            settings = request(address, "GET", "/workspace")[1]["standaloneModels"]
            reasoning = "xhigh"
            payload = {**payload, "revision": settings["revision"], "setModelKey": True, "reasoningEffort": reasoning}
            assert request(address, "POST", endpoint, {**payload, "reasoningEffort": {"default": "none"}})[0] == 422
            assert request(address, "POST", endpoint, {**payload, "reasoningEffort": "show"})[0] == 422
            assert request(address, "POST", endpoint, {**payload, "provider": "openai-codex"})[0] == 422
            status, staged = request(address, "POST", endpoint, payload)
            assert status == 200
            default_revision = staged["revisions"]["default"]
            assert post(address, "default", {"revision": default_revision, "env": {"PATH": key}})[0] == 422
            assert post(address, "default", {"env": key_env})[0] == 422
            assert post(address, "default", {"revision": default_revision, "env": {"HERMES_MODEL_API_KEY": "bad\nkey"}})[0] == 422
            assert post(address, "default", {"revision": "0" * 64, "env": key_env})[0] == 409
            assert not (home / ".env").exists()
            for agent_id, saved, profile_config in (("default", record, native), ("maintenance", saved_maintenance, maintenance)):
                saved_record = safe_load(saved.read_bytes())
                assert saved_record["agent"]["reasoning_effort"] == reasoning
                assert saved_record["model"] == {**expected, "api_key": "${OPENROUTER_API_KEY}"}
                status, response = post(address, agent_id, {"revision": staged["revisions"][agent_id], "env": key_env})
                assert status == 200 and "env" not in response
                assert key.encode() not in saved.read_bytes() and key.encode() not in profile_config.read_bytes()
                assert "OPENROUTER_API_KEY" in safe_load(saved.read_bytes())["available-keys"]
                native_record = safe_load(profile_config.read_bytes())
                assert native_record["agent"]["reasoning_effort"] == reasoning
                assert native_record["model"] == saved_record["model"]
                assert load_env_file(profile_config.parent / ".env")["OPENROUTER_API_KEY"] == key
                with bind_profile_scope(profile_config.parent):
                    runtime = resolve_runtime_provider(requested="openrouter", target_model=expected["default"])
                    assert runtime["api_key"] == key

            settings = request(address, "GET", "/workspace")[1]["standaloneModels"]
            assert all(settings[name]["reasoningEffort"] == reasoning for name in ("default", "maintenance"))
            assert key not in json.dumps(settings)
            status, rotated = request(address, "POST", endpoint, {**payload, "revision": settings["revision"]})
            assert status == 200 and rotated["revisions"] != staged["revisions"]
            assert post(address, "maintenance", {"revision": staged["revisions"]["maintenance"], "env": key_env})[0] == 409
            new_key = "sk-or-v1-test-rotated-key"
            for name, profile in (("default", home), ("maintenance", maintenance.parent)):
                assert post(address, name, {"revision": rotated["revisions"][name],
                                            "env": {"HERMES_MODEL_API_KEY": new_key}})[0] == 200
                assert load_env_file(profile / ".env")["OPENROUTER_API_KEY"] == new_key

            # A failed native sync must leave the key previously accepted by that profile in place.
            saved = record.read_bytes()
            atomic_config_replace(record, {**safe_load(saved), "oma_skills": ["missing-fixture"]})
            failed = post(address, "default", {"revision": sha256(record.read_bytes()).hexdigest(), "env": key_env})
            assert failed[0] == 422
            assert load_env_file(home / ".env")["OPENROUTER_API_KEY"] == new_key
            record.write_bytes(saved)

            with bind_profile_scope(home):
                runtime = resolve_runtime_provider(requested="openrouter", target_model=expected["default"])
                assert runtime["api_key"] == new_key

            # Exercise both legacy aliases with a model-only save and the existing profile credentials.
            for alias, saved, profile_config in (("key_env", record, native), ("api_key_env", saved_maintenance, maintenance)):
                for path in (saved, profile_config):
                    config = safe_load(path.read_bytes())
                    config["model"] = {**expected, alias: "OPENROUTER_API_KEY"}
                    atomic_config_replace(path, config)
            settings = request(address, "GET", "/workspace")[1]["standaloneModels"]
            model_only = {field: value for field, value in payload.items() if field != "setModelKey"}
            status, migrated = request(address, "POST", endpoint, {**model_only, "revision": settings["revision"]})
            assert status == 200
            for name, saved, profile_config in (("default", record, native), ("maintenance", saved_maintenance, maintenance)):
                assert post(address, name, {"revision": migrated["revisions"][name]})[0] == 200
                for path in (saved, profile_config):
                    assert safe_load(path.read_bytes())["model"] == {**expected, "api_key": "${OPENROUTER_API_KEY}"}
                assert load_env_file(profile_config.parent / ".env")["OPENROUTER_API_KEY"] == new_key

            from bootstrap import bootstrap

            bootstrap(home, expected, None, {"OPENROUTER_API_KEY": "sk-or-v1-fixture-startup-seed"}, "test-gateway-seed")
            assert load_env_file(home / ".env")["OPENROUTER_API_KEY"] == new_key

            current = request(address, "GET", "/workspace")[1]["standaloneModels"]["revision"]
            custom = {**payload, "revision": current, "provider": "custom", "baseUrl": "https://example.invalid/v1"}
            custom["reasoningEffort"] = ""
            status, staged = request(address, "POST", endpoint, custom)
            assert status == 200
            for name, profile_config in (("default", native), ("maintenance", maintenance)):
                assert post(address, name, {"revision": staged["revisions"][name], "env": key_env})[0] == 200
                assert safe_load(profile_config.read_bytes())["agent"]["reasoning_effort"] == ""
            custom_model = {"provider": "custom", "default": expected["default"], "base_url": custom["baseUrl"],
                            "api_key": "${HERMES_MODEL_API_KEY}"}
            for path in (record, native, saved_maintenance, maintenance):
                assert safe_load(path.read_bytes())["model"] == custom_model
            assert load_env_file(maintenance.parent / ".env")["HERMES_MODEL_API_KEY"] == key
            with bind_profile_scope(maintenance.parent):
                runtime = resolve_runtime_provider(requested="custom", target_model=expected["default"])
                assert runtime["base_url"] == custom["baseUrl"] and runtime["api_key"] == key

            current = request(address, "GET", "/workspace")[1]["standaloneModels"]["revision"]
            openai = {**payload, "revision": current, "provider": "openai-api", "baseUrl": "https://api.openai.com/v1"}
            status, staged = request(address, "POST", endpoint, openai)
            assert status == 200
            openai_key = "sk-fixture-openai-test-key"
            for name, profile_config in (("default", native), ("maintenance", maintenance)):
                status, _ = post(address, name, {"revision": staged["revisions"][name],
                                                "env": {"HERMES_MODEL_API_KEY": openai_key}})
                assert status == 200
                assert safe_load(profile_config.read_bytes())["model"] == {
                    "provider": "openai-api", "default": expected["default"], "base_url": openai["baseUrl"],
                    "api_key": "${OPENAI_API_KEY}",
                }
                with bind_profile_scope(profile_config.parent):
                    runtime = resolve_runtime_provider(requested="openai-api", target_model=expected["default"])
                    assert runtime["api_key"] == openai_key
        finally:
            server.shutdown()
            worker.join()
print("Standalone agent sync passed over the private Unix socket")
