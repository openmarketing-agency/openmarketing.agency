"""Verify reviewed plan writes and native deployment using disposable campaign and profile records."""

from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch


def verify_model_request(home, ask, root, request, reply):
    received = []

    class Provider(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((self.path, self.headers.get("Authorization"), body))
            payload = json.dumps({
                "id": "chatcmpl-fixture", "model": "fixture-model", "object": "chat.completion", "created": 1,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": json.dumps(reply)}, "finish_reason": "stop"}],
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Provider) as server:
        base_url = f"http://127.0.0.1:{server.server_port}/v1"
        (home / "config.yaml").write_text(json.dumps({
            "model": {"provider": "custom:oma-inference", "default": "fixture-model"},
            "providers": {"oma-inference": {
                "api": base_url, "key_env": "OMA_LITELLM_KEY", "transport": "chat_completions",
            }},
        }))
        (home / ".env").write_text("OMA_LITELLM_KEY=synthetic-key-for-test-only\n")
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert ask(root, "fixture", request) == reply
        finally:
            server.shutdown()
            thread.join()
    [(path, auth, body)] = received
    assert path == "/v1/chat/completions"
    assert auth == "Bearer synthetic-key-for-test-only"
    assert body["model"] == "fixture-model"
    assert not body.get("tools")
    context, *history = body["messages"]
    assert context["role"] == "system"
    assert json.loads(context["content"].split("\nCampaign context:\n", 1)[1]) == {
        "campaign_id": "fixture", "draft": request["draft"],
    }
    assert history == request["history"]


def verify(home):
    sys.path.insert(0, "/opt/oma")
    from agent.secret_scope import load_env_file
    from hermes_cli import kanban_db
    from hermes_cli.oma_campaigns.install import _status
    from hermes_cli.oma_campaigns.publications import save_publication
    from hermes_cli.oma_campaigns.schema import validate_record
    from hermes_yaml import safe_load
    from workspace import (
        WorkspaceError, approve_campaign_publication, ask_campaign_plan, campaign_configuration, campaign_publications,
        change_campaign_lifecycle, sync_campaign_configuration,
        update_campaign_configuration, update_campaign_mode, update_campaign_plan,
    )

    root = home / "oma"
    campaign_id = "fixture"
    agent_id = "fixture__orchestrator"
    reviewer_id = "fixture__reviewer"
    publisher_id = "fixture__publisher"
    record = root / "campaigns" / campaign_id / "config.yaml"
    record.parent.mkdir(parents=True)
    plan = {"name": "Fixture campaign", "description": "Fixture plan.", "goals": ["Reach developers"], "plans": ["Review current docs"]}
    tool_suggestions = ["google_analytics", "github"]
    data = {
        "id": campaign_id, **plan, "orchestrator": agent_id, "agents": [agent_id, reviewer_id, publisher_id],
        "tool_suggestions": tool_suggestions,
    }
    validate_record("campaign", data, record)
    validate_record("campaign", {**data, "integrations": ["discord", "facebook"]}, record)
    for invalid in ("discord", {"discord": True}, [42], [{"id": "discord"}],
                    ["https://discord.com"], ["discord", "discord"]):
        try:
            validate_record("campaign", {**data, "integrations": invalid}, record)
        except ValueError as error:
            assert "integrations" in str(error)
        else:
            raise AssertionError("Campaign integration IDs must be unique and syntactically valid")
    for invalid in ("github", ["GitHub"], ["github\n"], ["github", "github"]):
        try:
            validate_record("campaign", {**data, "tool_suggestions": invalid}, record)
        except ValueError as error:
            assert "tool_suggestions" in str(error)
        else:
            raise AssertionError("The native schema must reject invalid tool suggestions")
    record.write_text(json.dumps(data))
    agent = root / "agents" / agent_id / "config.yaml"
    agent.parent.mkdir(parents=True)
    agent.write_text(json.dumps({
        "id": agent_id, "name": "Coordinator", "campaign_id": campaign_id, "description": "Coordinates the campaign.",
        "oma_skills": [], "agent": {"enabled_toolsets": ["kanban"]},
    }))
    agent.with_name("SOUL.md").write_text("You coordinate fixture tasks.")
    reviewer = root / "agents" / reviewer_id / "config.yaml"
    reviewer.parent.mkdir()
    reviewer_model = {"provider": "custom", "default": "review-model", "base_url": "https://review.example.test/v1"}
    reviewer.write_text(json.dumps({
        "id": reviewer_id, "name": "Reviewer", "description": "Reviews fixture tasks.", "campaign_id": campaign_id,
        "model": reviewer_model, "oma_skills": [], "agent": {"enabled_toolsets": ["file"]},
    }))
    reviewer.with_name("SOUL.md").write_text("You review fixture tasks.")
    publisher = root / "agents" / publisher_id / "config.yaml"
    publisher.parent.mkdir()
    publisher.write_text(json.dumps({
        "id": publisher_id, "name": "Publisher", "description": "Publishes approved fixtures.",
        "campaign_id": campaign_id, "oma_skills": [], "agent": {"enabled_toolsets": ["file"]},
    }))
    publisher.with_name("SOUL.md").write_text("You publish reviewed fixture drafts.")
    source = record.read_bytes()
    initial_revision = sha256(source).hexdigest()
    assert _status(home, campaign_id, data)["state"] == "draft"

    message = {"role": "user", "content": "Prioritize the quickstart"}
    suggestion = {**plan, "plans": ["Improve the quickstart"]}
    reply = {"reply": "I prioritized the quickstart.", "plan": suggestion}
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(reply)))])
    with patch("agent.auxiliary_client.call_llm", return_value=response) as model:
        assert ask_campaign_plan(root, campaign_id, {"draft": plan, "history": [message]}) == reply
        assert model.call_args.kwargs["tools"] == []
        assert model.call_args.kwargs["messages"][-1] == message
    verify_model_request(home, ask_campaign_plan, root, {"draft": plan, "history": [
        message, {"role": "assistant", "content": reply["reply"]},
        {"role": "user", "content": "Keep the original goal and suggest another step."},
    ]}, reply)
    assert record.read_bytes() == source
    record.write_text(json.dumps({**data, "id": "different-campaign"}))
    with patch("agent.auxiliary_client.call_llm") as model:
        try:
            ask_campaign_plan(root, campaign_id, {"draft": plan, "history": [message]})
        except WorkspaceError as error:
            assert error.status == 422
        else:
            raise AssertionError("Campaign chat must reject mismatched saved IDs.")
        model.assert_not_called()
    record.write_bytes(source)
    saved = update_campaign_plan(root, campaign_id, {**suggestion, "revision": initial_revision})
    assert safe_load(record.read_bytes()) == {**data, **suggestion}
    for status, update in [(409, {"revision": initial_revision}), (422, {"agents": []})]:
        try:
            update_campaign_plan(root, campaign_id, {**plan, "revision": saved["revision"], **update})
        except WorkspaceError as error:
            assert error.status == status
        else:
            raise AssertionError("An invalid plan edit must be rejected")

    def configure_default(name, key):
        (home / "config.yaml").write_text(json.dumps({"model": {
            "provider": "openrouter", "default": name, "api_key": "${OPENROUTER_API_KEY}",
        }}))
        (home / ".env").write_text(f"OPENROUTER_API_KEY={key}\n")

    default_key = "sk-or-v1-fixture-first"
    configure_default("default-model", default_key)
    board = "campaign-fixture"
    assert not kanban_db.board_exists(board)
    assert campaign_configuration(record.read_bytes())["mode"] == "approve"
    mode = update_campaign_mode(root, campaign_id, {"revision": saved["revision"], "mode": "control"})
    assert safe_load(record.read_bytes())["mode"] == "control"
    assert sync_campaign_configuration(root, campaign_id, {"revision": mode["revision"]}) == mode
    prepared = sync_campaign_configuration(root, campaign_id, {"revision": mode["revision"], "env": {}, "prepareDeployment": True})
    assert prepared["revision"] == mode["revision"] and not kanban_db.board_exists(board)
    result = sync_campaign_configuration(root, campaign_id, {"revision": prepared["revision"], "env": {}}, deploy=True)
    deployed = safe_load(record.read_bytes())
    assert _status(home, campaign_id, deployed)["state"] == "installed"
    assert deployed["lifecycle_state"] == "paused"
    assert deployed["plans"] == suggestion["plans"]
    assert deployed["tool_suggestions"] == tool_suggestions
    assert deployed["integrations"] == []
    assert kanban_db.board_exists(board)
    profile = home / "profiles" / agent_id
    assert safe_load((profile / "config.yaml").read_bytes())["kanban"]["profile_board"] == board
    jobs = profile / "cron" / "jobs.json"
    if jobs.exists():
        assert not json.loads(jobs.read_bytes())["jobs"]
    assert "model" not in deployed and result["modelId"] == ""
    saved_agent = safe_load(agent.read_bytes())
    assert "model" not in saved_agent and "model" not in saved_agent.get("effective", {})
    assert safe_load((profile / "config.yaml").read_bytes())["model"]["default"] == "default-model"
    assert load_env_file(profile / ".env")["OPENROUTER_API_KEY"] == default_key
    assert sync_campaign_configuration(root, campaign_id, {"revision": result["revision"], "env": {}}, deploy=True) == result

    rotated_key = "sk-or-v1-fixture-rotated"
    configure_default("rotated-model", rotated_key)
    synced = sync_campaign_configuration(root, campaign_id, {"revision": result["revision"], "env": {}})
    assert synced["modelId"] == "" and "model" not in safe_load(record.read_bytes())
    assert safe_load((profile / "config.yaml").read_bytes())["model"]["default"] == "rotated-model"
    assert load_env_file(profile / ".env")["OPENROUTER_API_KEY"] == rotated_key

    override = {
        "revision": synced["revision"], "provider": "custom", "modelId": "campaign-model",
        "baseUrl": "https://campaign.example.test/v1", "setModelKey": True, "composioUrl": "",
    }
    staged = update_campaign_configuration(root, campaign_id, override)
    synced = sync_campaign_configuration(root, campaign_id, {
        "revision": staged["revision"], "env": {"HERMES_MODEL_API_KEY": "fixture-campaign-key"},
    })
    assert synced["modelId"] == "campaign-model"
    assert safe_load((profile / "config.yaml").read_bytes())["model"]["default"] == "campaign-model"
    assert load_env_file(profile / ".env")["HERMES_MODEL_API_KEY"] == "fixture-campaign-key"
    assert "model" not in safe_load(agent.read_bytes())

    staged = update_campaign_configuration(root, campaign_id, {
        **override, "revision": synced["revision"], "modelId": "", "provider": "", "baseUrl": "", "setModelKey": False,
    })
    synced = sync_campaign_configuration(root, campaign_id, {"revision": staged["revision"], "env": {}})
    assert synced["modelId"] == "" and "model" not in safe_load(record.read_bytes())
    saved_agent = safe_load(agent.read_bytes())
    assert "model" not in saved_agent and "model" not in saved_agent.get("effective", {})
    assert safe_load((profile / "config.yaml").read_bytes())["model"]["default"] == "rotated-model"
    assert safe_load(reviewer.read_bytes())["model"] == reviewer_model
    assert safe_load((home / "profiles" / reviewer_id / "config.yaml").read_bytes())["model"] == reviewer_model

    running = change_campaign_lifecycle(root, campaign_id, {"state": "resumed"})
    assert running["state"] == "resumed"
    assert safe_load(record.read_bytes())["lifecycle_state"] == "resumed"
    assert change_campaign_lifecycle(root, campaign_id, {"state": "resumed"}) == running
    try:
        sync_campaign_configuration(root, campaign_id, {"revision": running["revision"]})
    except WorkspaceError as error:
        assert error.status == 409 and "Stop the campaign" in str(error)
    else:
        raise AssertionError("A running campaign must stop before syncing.")
    assert change_campaign_lifecycle(root, campaign_id, {"state": "paused"})["state"] == "paused"
    declarations = ["discord", "workspace-managed-tool"]
    record.write_text(json.dumps({**safe_load(record.read_bytes()), "integrations": declarations}))
    revision = campaign_configuration(record.read_bytes())["revision"]
    sync_campaign_configuration(root, campaign_id, {"revision": revision, "env": {}})
    resumed = change_campaign_lifecycle(root, campaign_id, {"state": "resumed"})
    assert resumed["state"] == "resumed"
    assert safe_load(record.read_bytes())["integrations"] == declarations

    draft = {
        "platform": "x", "kind": "reply", "account": {"id": "fixture-account", "name": "Fixture"},
        "content": {"text": "Fixture text", "media": [{"asset_id": "fixture-image", "kind": "image", "alt_text": "Fixture"}]},
        "target": {"id": "fixture-target", "author_handle": "@fixture"},
    }
    saved_publication = save_publication(home, campaign_id, reviewer_id, draft)
    publication_id = saved_publication["id"]
    review = {"revision": saved_publication["revision"], "approver": "fixture-operator"}
    assert campaign_publications(root, campaign_id)["publications"] == [saved_publication]
    try:
        approve_campaign_publication(root, campaign_id, publication_id, {**review, "revision": 2})
    except WorkspaceError as error:
        assert error.status == 409
    else:
        raise AssertionError("A different publication revision must be rejected.")
    approved = approve_campaign_publication(root, campaign_id, publication_id, review)
    assert approved["approval"]["by"] == "fixture-operator" and approved["task_id"]
    assert approved["content"] == draft["content"] and approved["target"] == draft["target"]
    assert approve_campaign_publication(root, campaign_id, publication_id, review) == approved


with TemporaryDirectory(prefix="oma-campaign-deploy-") as directory:
    os.environ.update(HERMES_HOME=directory, HOME=directory)
    verify(Path(directory))

print("Proposal, plan save, native deployment, and repeat deployment passed")
