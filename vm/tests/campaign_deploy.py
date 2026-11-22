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
    assert body["messages"][-1] == request["history"][-1]


def verify(home):
    sys.path.insert(0, "/opt/oma")
    from hermes_cli import kanban_db
    from hermes_cli.oma_campaigns.install import _status
    from hermes_yaml import safe_load
    from workspace import WorkspaceError, ask_campaign_plan, sync_campaign_configuration, update_campaign_plan

    root = home / "oma"
    campaign_id = "fixture"
    agent_id = "fixture__orchestrator"
    record = root / "campaigns" / campaign_id / "config.yaml"
    record.parent.mkdir(parents=True)
    plan = {"name": "Fixture campaign", "description": "Fixture plan.", "goals": ["Reach developers"], "plans": ["Review current docs"]}
    data = {"id": campaign_id, **plan, "orchestrator": agent_id, "agents": [agent_id]}
    record.write_text(json.dumps(data))
    agent = root / "agents" / agent_id / "config.yaml"
    agent.parent.mkdir(parents=True)
    agent.write_text(json.dumps({
        "id": agent_id, "name": "Coordinator", "campaign_id": campaign_id, "description": "Coordinates the campaign.",
        "oma_skills": [], "agent": {"enabled_toolsets": ["kanban"]},
    }))
    agent.with_name("SOUL.md").write_text("You coordinate fixture tasks.")
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
    verify_model_request(home, ask_campaign_plan, root, {"draft": plan, "history": [message]}, reply)
    assert record.read_bytes() == source
    saved = update_campaign_plan(root, campaign_id, {**suggestion, "revision": initial_revision})
    assert safe_load(record.read_bytes()) == {**data, **suggestion}
    for status, update in [(409, {"revision": initial_revision}), (422, {"agents": []})]:
        try:
            update_campaign_plan(root, campaign_id, {**plan, "revision": saved["revision"], **update})
        except WorkspaceError as error:
            assert error.status == status
        else:
            raise AssertionError("An invalid plan edit must be rejected")

    board = "campaign-fixture"
    assert not kanban_db.board_exists(board)
    result = sync_campaign_configuration(root, campaign_id, {"revision": saved["revision"], "env": {}}, deploy=True)
    deployed = safe_load(record.read_bytes())
    assert _status(home, campaign_id, deployed)["state"] == "installed"
    assert deployed["lifecycle_state"] == "paused"
    assert deployed["plans"] == suggestion["plans"]
    assert kanban_db.board_exists(board)
    profile = home / "profiles" / agent_id
    assert safe_load((profile / "config.yaml").read_bytes())["kanban"]["profile_board"] == board
    jobs = profile / "cron" / "jobs.json"
    if jobs.exists():
        assert not json.loads(jobs.read_bytes())["jobs"]
    assert sync_campaign_configuration(root, campaign_id, {"revision": result["revision"], "env": {}}, deploy=True) == result


with TemporaryDirectory(prefix="oma-campaign-deploy-") as directory:
    os.environ.update(HERMES_HOME=directory, HOME=directory)
    verify(Path(directory))

print("Proposal, plan save, native deployment, and repeat deployment passed")
