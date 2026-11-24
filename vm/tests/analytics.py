"""Exercise the analytics socket with the default profile and a disposable loopback model."""

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

    def post(address, payload):
        connection = WorkspaceConnection(address)
        try:
            connection.request("POST", "/workspace/analytics", json.dumps(payload),
                               {"Content-Type": "application/json"})
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

    [(path, auth, body)] = received
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
