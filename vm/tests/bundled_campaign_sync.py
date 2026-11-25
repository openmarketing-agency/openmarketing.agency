"""Exercise first sync for an older bundled campaign against disposable native profiles."""

from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory


def verify_sync(home):
    sys.path.insert(0, "/opt/oma")
    from agent.secret_scope import load_env_file
    from hermes_cli import kanban_db
    from hermes_cli.config import atomic_config_replace
    from hermes_cli.config_home import OMA_BASE_TOOLSETS, OMA_EAGER_TOOLSETS
    from hermes_cli.oma_campaigns.install import _status
    from hermes_yaml import safe_load
    from workspace import WorkspaceError, change_campaign_lifecycle, sync_campaign_configuration

    root = home / "oma"
    campaign_id = "fixture"
    board = "campaign-fixture"
    coordinator = "fixture__orchestrator"
    specialist = "fixture__researcher"
    agents = [coordinator, specialist]
    record = root / "campaigns" / campaign_id / "config.yaml"
    record.parent.mkdir(parents=True)
    data = {
        "id": campaign_id, "name": "Bundled campaign", "description": "Legacy fixture.",
        "orchestrator": coordinator, "agents": agents,
        "integrations": ["github", "hacker-news"],
        "model": {"default": "fixture-model", "provider": "openai-api",
                  "base_url": "https://provider.example.test/v1", "key_env": "HERMES_MODEL_API_KEY",
                  "api_key": "${HERMES_MODEL_API_KEY}"},
        "mcp_servers": {
            "composio": {"url": "https://backend.composio.dev/tool_router/trs_fixture/mcp",
                         "headers": {"x-api-key": "${COMPOSIO_API_KEY}"}},
            "oma-custom-hacker-news": {"url": "https://mcp.example.test/mcp"},
        },
    }
    atomic_config_replace(record, data)
    registry = home / ".oma" / "installed.json"
    registry.parent.mkdir()
    registry.write_text(json.dumps({"schemaVersion": 1, "playbooks": [{
        "id": campaign_id, "source": "/opt/oma/campaigns/fixture", "orchestrator": coordinator,
        "agents": [{"id": name, "active": True} for name in agents],
    }]}))
    profiles = home / "profiles"
    for name in agents:
        agent = root / "agents" / name / "config.yaml"
        agent.parent.mkdir(parents=True)
        atomic_config_replace(agent, {
            "id": name, "name": name, "description": "Fixture profile.", "campaign_id": campaign_id,
        })
        profile = profiles / name
        (profile / "cron").mkdir(parents=True)
        (profile / "cron" / "jobs.json").write_text('{"jobs":[]}')
        (profile / ".env").write_text("EXISTING_FIXTURE_KEY=keep\n")
        (profile / "SOUL.md").write_text("Preserve this installed legacy persona.")
        atomic_config_replace(profile / "config.yaml", {"agent": {"enabled_toolsets": ["file"]}})
    owner_config = profiles / coordinator / "config.yaml"
    atomic_config_replace(owner_config, {
        "agent": {"enabled_toolsets": ["file"]},
        "kanban": {"orchestrator_profile": coordinator, "profile_board": "campaign-unrelated"},
    })
    assert _status(home, campaign_id, data)["state"] == "draft"
    request = {"revision": sha256(record.read_bytes()).hexdigest(), "env": {
        "HERMES_MODEL_API_KEY": "fixture-model-key", "COMPOSIO_API_KEY": "fixture-composio-key",
    }}
    try:
        sync_campaign_configuration(root, campaign_id, request)
    except WorkspaceError as error:
        assert error.status == 412
    else:
        raise AssertionError("Should refuse to change an existing profile’s board")
    assert not kanban_db.board_exists(board)
    assert sha256(record.read_bytes()).hexdigest() == request["revision"]

    atomic_config_replace(owner_config, {
        "agent": {"enabled_toolsets": ["file"]},
        "kanban": {"orchestrator_profile": coordinator, "dispatch_profiles": [specialist]},
    })
    result = sync_campaign_configuration(root, campaign_id, request)
    updated = safe_load(record.read_bytes())
    assert _status(home, campaign_id, updated)["state"] == "installed"
    assert updated["all-keys"] == updated["available-keys"] == sorted({*request["env"], "EXISTING_FIXTURE_KEY"})
    assert result["revision"] != request["revision"]
    analyst = f"{campaign_id}__analyst"
    if analyst in updated["agents"]:
        analyst_env = load_env_file(profiles / analyst / ".env")
        assert all(analyst_env.get(key) == value for key, value in request["env"].items()), (
            "The newly provisioned analyst did not receive the explicitly supplied campaign keys"
        )
        assert "EXISTING_FIXTURE_KEY" not in analyst_env
    for name in agents:
        profile = profiles / name
        native = safe_load((profile / "config.yaml").read_bytes())
        assert native["kanban"]["profile_board"] == board
        assert (profile / "SOUL.md").read_text() == "Preserve this installed legacy persona."
        assert native["kanban"]["orchestrator_profile"] == coordinator
        required_tools = ["file", *OMA_BASE_TOOLSETS]
        if name == coordinator:
            required_tools.append("kanban")
        required_tools.extend(["mcp-composio", "mcp-oma-custom-hacker-news"])
        assert native["agent"]["enabled_toolsets"] == list(dict.fromkeys(required_tools))
        assert native["tools"]["tool_search"] == {"enabled": "on", "eager_toolsets": list(OMA_EAGER_TOOLSETS)}
        assert native["model"] == data["model"] and native["mcp_servers"] == data["mcp_servers"]
        assert (profile / "cron" / "jobs.json").read_text() == '{"jobs":[]}'
        env = load_env_file(profile / ".env")
        assert env["EXISTING_FIXTURE_KEY"] == "keep"
        assert all(env[key] == value for key, value in request["env"].items())
    assert safe_load(owner_config.read_bytes())["kanban"]["dispatch_profiles"] == [specialist]
    stopped = change_campaign_lifecycle(root, campaign_id, {"state": "paused", "revision": result["revision"]})
    assert stopped["state"] == "paused"
    synced = sync_campaign_configuration(root, campaign_id, {"revision": stopped["revision"], "env": {}})
    assert synced["revision"] == stopped["revision"]
    assert sync_campaign_configuration(root, campaign_id, {"revision": synced["revision"], "env": {}}, deploy=True) == synced


with TemporaryDirectory(prefix="oma-bundled-sync-") as directory:
    home = Path(directory).resolve()
    os.environ.update(HERMES_HOME=str(home), HOME=str(home))
    verify_sync(home)

print("Legacy bundled profiles linked and synced successfully")
