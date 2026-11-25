"""Exercise analytics generation, observation reads, and collector status through a disposable workspace socket."""

from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
from socketserver import ThreadingUnixStreamServer
import sys
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from types import SimpleNamespace
from unittest.mock import patch


class WorkspaceConnection(HTTPConnection):
    def __init__(self, address):
        super().__init__("localhost", timeout=10)
        self.address = address

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.address)


def verify_observations(home, address):
    from hermes_cli.oma_campaigns.analytics import save_observations
    from hermes_cli.oma_campaigns.analytics_cron import ensure_job

    prefix = "/workspace/campaigns/seo/analytics"

    def request(method, suffix="", body=None):
        connection = WorkspaceConnection(address)
        try:
            connection.request(method, prefix + suffix, body)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    directory = home / "oma/campaigns/seo"
    directory.mkdir(parents=True)
    assert request("GET")[0] == 404
    config = {"id": "seo", "name": "Example", "installation_state": "installed",
              "lifecycle_state": "resumed", "agents": ["seo__analyst"]}
    config_path = directory / "config.yaml"
    config_path.write_text(json.dumps(config))
    assert request("GET") == (200, {"campaign_id": "seo", "observations": [],
                                    "last_collected_at": None, "next_cursor": None})
    assert request("GET", "/status")[1]["state"] == "unavailable"

    base = {"source": "oma-publications", "account": "seo", "metric": "drafts_created",
            "period_start": "2026-11-22", "period_end": "2026-11-23",
            "dimensions": {}, "value": 2, "unit": "count"}
    assert save_observations(home, "seo", [base, {**base, "metric": "published", "value": 1}],
                             refresh_complete=True) == 2
    status, first_page = request("GET", "?limit=1&source=oma-publications")
    assert status == 200 and first_page["last_collected_at"]
    assert first_page["observations"][0]["metric"] == "published"
    status, page = request("GET", "?before=" + str(first_page["next_cursor"]))
    assert status == 200 and page["observations"][0]["value"] == 2 and page["next_cursor"] is None
    for suffix in ("?limit=101", "?source=a&source=b", "?unknown=1", "?source=", "?start=2026-11-23&end=2026-11-23"):
        assert request("GET", suffix)[0] == 422

    profile = home / "profiles/seo__analyst"
    profile.mkdir(parents=True)
    ensure_job(profile)
    assert request("GET", "/status")[1]["state"] == "idle"
    assert request("POST", "/refresh", "{}")[0] == 422
    assert request("POST", "/refresh?limit=1")[0] == 422
    status, queued = request("POST", "/refresh")
    assert status == 202 and queued["state"] == "queued"
    assert request("POST", "/refresh")[1]["run_id"] == queued["run_id"]
    assert request("GET", "/status")[1]["last_successful_refresh_at"]
    assert save_observations(home, "seo", [{**base, "value": 6}]) == 1
    assert request("GET", "?metric=drafts_created")[1]["observations"][0]["value"] == 6

    config_path.write_text(json.dumps({**config, "lifecycle_state": "paused"}))
    assert request("POST", "/refresh")[0] == 409
    assert request("GET", "?metric=drafts_created")[0] == 200


def verify(home):
    sys.path.insert(0, "/opt/oma")
    from workspace import WorkspaceHandler

    result = 'root = Dashboard([Section("Campaign activity", [])])'
    # Match a full OpenUI schema prompt and exercise the workspace transport above the old 16 KiB limit.
    prompt = "Generate an OpenUI dashboard using the workspace activity.\n" + "Use the documented components.\n" * 675
    received = []

    class Provider(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path, self.headers.get("Authorization"),
                             json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            payload = json.dumps({
                "id": "fixture", "model": "default-profile-fixture", "object": "chat.completion", "created": 1,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": result},
                             "finish_reason": "stop"}],
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    def post(address, payload, *, details=False):
        connection = WorkspaceConnection(address)
        headers = {"Content-Type": "application/json"}
        if details:
            headers["X-OMA-Analytics-Details"] = "1"
        try:
            connection.request("POST", "/workspace/analytics", json.dumps(payload), headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    source = {"rows": [], "campaignsRead": 1, "partial": False}
    snapshot = {"updatedAt": 1, "campaignCount": 1, "tasks": source, "timeline": [],
                "schedules": source, "publications": source}
    campaign = {"scope": "campaigns", "targetId": "seo", "campaignIds": ["seo"], "snapshot": snapshot,
                "prompt": prompt}
    address = str(home / "workspace.sock")
    with ThreadingHTTPServer(("127.0.0.1", 0), Provider) as provider, \
            ThreadingUnixStreamServer(address, WorkspaceHandler) as workspace:
        (home / "config.yaml").write_text(json.dumps({
            "model": {"provider": "custom:oma-inference", "default": "default-profile-fixture"},
            "providers": {"oma-inference": {
                "api": f"http://127.0.0.1:{provider.server_port}/v1",
                "key_env": "OMA_LITELLM_KEY", "transport": "chat_completions",
            }},
        }))
        (home / ".env").write_text("OMA_LITELLM_KEY=synthetic-key-for-test-only\n")
        workspace.root = home / "oma"
        workspace.analytics_lock = Lock()
        threads = [Thread(target=server.serve_forever, daemon=True) for server in (provider, workspace)]
        for thread in threads:
            thread.start()
        try:
            assert len(json.dumps(campaign).encode()) > 16_384
            assert post(address, {**campaign, "prompt": "x" * 65_536})[0] == 413
            assert post(address, {"scope": "all"})[0] == 422
            assert post(address, {**campaign, "campaignIds": ["different-campaign"]})[0] == 422
            assert post(address, {**campaign, "scope": "playbooks"})[0] == 422
            assert post(address, {**campaign, "snapshot": {**snapshot, "campaignCount": 2}})[0] == 422
            with workspace.analytics_lock:
                assert post(address, campaign)[0] == 429
            with patch("hermes_cli.oma_campaigns.install.default_home", return_value=home / "different-profile"):
                assert post(address, campaign)[0] == 503
            assert not received
            assert post(address, campaign) == (200, result)
            status, details = post(address, campaign, details=True)
            assert status == 200
            assert details == {"source": result, "userMessage": received[-1][2]["messages"][-1]["content"]}
            layout_request = {key: value for key, value in campaign.items() if key != "snapshot"}
            status, layout = post(address, layout_request, details=True)
            assert status == 200 and layout["source"] == result
            assert layout["userMessage"] == received[-1][2]["messages"][-1]["content"]
            assert layout["userMessage"].endswith("\n\nCampaign ID: seo") and '"updatedAt"' not in layout["userMessage"]
            observation_context = {
                "campaign_id": "seo", "observations": [{
                    "source": "search", "metric": "performance", "dimensions": {"country": "नेपाल"},
                    "value": {"totals": {"clicks": 0}, "rows": [["/pricing", None, False]]},
                }], "measurement_fields": [{"id": "m1111111111111111", "path": ["totals", "clicks"]}],
            }
            observed_request = {**layout_request, "observationContext": observation_context}
            assert post(address, {**observed_request, "snapshot": snapshot})[0] == 422
            assert post(address, {**observed_request, "observationContext": {**observation_context, "campaign_id": "other"}})[0] == 422
            status, layout = post(address, observed_request, details=True)
            assert status == 200 and layout["source"] == result
            message = received[-1][2]["messages"][-1]
            assert message == {"role": "user", "content": layout["userMessage"]}
            _, sample, campaign_id = message["content"].split("\n\n")
            assert json.loads(sample) == observation_context and campaign_id == "Campaign ID: seo"
            verify_observations(home, address)
            for finish_reason, content, expected_error in (
                ("length", None, "response limit"),
                ("stop", None, "empty report"),
                ("stop", "x" * 16_001, "exceeds the report limit"),
            ):
                choice = SimpleNamespace(finish_reason=finish_reason, message=SimpleNamespace(content=content))
                completion = SimpleNamespace(choices=[choice])
                with patch("agent.auxiliary_client.call_llm", return_value=completion) as model:
                    status, response = post(address, campaign)
                    assert status == 502 and expected_error in response["message"]
                    assert model.call_args.kwargs["reasoning_config"] == {"enabled": False}
        finally:
            for server in (provider, workspace):
                server.shutdown()
            for thread in threads:
                thread.join()

    assert len(received) == 4 and received[0] == received[1]
    path, auth, body = received[0]
    assert path == "/v1/chat/completions" and auth == "Bearer synthetic-key-for-test-only"
    assert body["model"] == "default-profile-fixture"
    assert not body.get("tools")
    assert body["messages"][0] == {"role": "system", "content": prompt}
    aggregate, context = body["messages"][-1]["content"].split("\n\n", 1)
    assert json.loads(aggregate) == snapshot
    assert context == "Campaign ID: seo"

with TemporaryDirectory(prefix="oma-analytics-") as directory:
    os.environ.update(HERMES_HOME=directory, HOME=directory)
    verify(Path(directory))

print("Analytics workspace route used the default profile’s provider and model")
