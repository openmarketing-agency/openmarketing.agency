"""Exercise the bundled Hermes gateway with a loopback model and no connected chat client."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import subprocess
from threading import Event, Thread
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

home = Path(os.environ["HERMES_HOME"])
home.mkdir(parents=True, exist_ok=True)
gateway = "http://127.0.0.1:8642"
python = "/opt/hermes/.venv/bin/python"
child_can_finish = Event()
wake_started = Event()
wake_can_finish = Event()


class Model(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        inputs = [m.get("content") for m in req.get("messages", []) if m.get("role") == "user"]
        last = str(inputs[-1]) if inputs else ""
        model = req.get("model", "fixture-model")
        tool_calls = None
        if "[OMA_INTERNAL_DELEGATION_WAKE_V1]" in last:
            wake_started.set()
            wake_can_finish.wait(20)
            answer = "Parent woke and received the child result." if any("CHILD_RESULT" in str(item) for item in inputs) else "Parent did not see result."
        elif "Fixture child task" in last:
            child_can_finish.wait(25)
            answer = "CHILD_RESULT"
        elif "Fixture parent task" in last and "delegate_task" in {t["function"]["name"] for t in req.get("tools", [])} and not any(m.get("role") == "tool" for m in req["messages"]):
            args = {"goal": "Fixture child task. Reply with CHILD_RESULT.", "context": "Run fixture only.", "toolsets": []}
            tool_calls = [{"id": "call_fixture", "type": "function", "function": {"name": "delegate_task", "arguments": json.dumps(args)}}]
            answer = None
        else:
            answer = "Delegated. I’ll wait for the result."
        finish = "tool_calls" if tool_calls else "stop"
        message = {"role": "assistant", "content": answer, **({"tool_calls": tool_calls} if tool_calls else {})}
        common = {"id": "chatcmpl-smoke", "model": model, "created": int(time.time())}
        if req.get("stream"):
            if tool_calls:
                tool_calls[0]["index"] = 0
            chunk = {**common, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": message, "finish_reason": finish}]}
            body = ("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode()
        else:
            body = json.dumps({**common, "object": "chat.completion", "choices": [{"index": 0, "message": message, "finish_reason": finish}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if req.get("stream") else "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def until(check, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.25)
    raise AssertionError(f"Timed out: {check.__name__}")


def api(path, data=None, authenticated=True):
    headers = {"Content-Type": "application/json"}
    if authenticated:
        headers["Authorization"] = f"Bearer {key}"
    req = Request(gateway + path, None if data is None else json.dumps(data).encode(), headers)
    with urlopen(req, timeout=10) as result:
        return json.load(result)


with ThreadingHTTPServer(("127.0.0.1", 0), Model) as mock:
    Thread(target=mock.serve_forever, daemon=True).start()
    subprocess.run([python, "/opt/oma/bootstrap.py"], check=True, env={**os.environ,
        "OMA_LITELLM_URL": f"http://127.0.0.1:{mock.server_port}/v1", "OMA_LITELLM_KEY": "fixture-model-key-only",
        "OMA_HERMES_MODEL": "fixture-model"})
    key = hmac.digest((home / ".oma/gateway-seed").read_bytes(), b"default", "sha256").hex()
    from hermes_cli.config import atomic_config_replace, require_readable_config_before_write
    config_path = home / "config.yaml"
    config = require_readable_config_before_write(config_path)
    config.setdefault("agent", {})["enabled_toolsets"] = ["delegation"]
    config.setdefault("tools", {}).setdefault("tool_search", {})["enabled"] = "off"
    atomic_config_replace(config_path, config)
    proc = subprocess.Popen(["hermes", "gateway", "run"])
    try:
        def available():
            try:
                return api("/health")
            except OSError:
                return None
        until(available)
        sid = "oma_" + "f" * 32 + "_afd1b604-b2de-4bab-81f8-024318bfb534"
        session = f"/api/sessions/{sid}"
        try:
            api(session + "/oma-activity", authenticated=False)
            raise AssertionError("Activity did not require gateway auth")
        except HTTPError as err:
            assert err.code == 401, err
        run_id = api("/v1/runs", {"session_id": sid, "input": "Fixture parent task. Delegate once and wait."})["run_id"]
        def sleeping():
            try:
                state = api(session + "/oma-activity")
            except HTTPError as err:
                if err.code == 404:
                    return None
                raise
            return state if not state["run_id"] and state["delegations"] else None
        assert until(sleeping)["delegations"][0]["status"] == "running"
        with urlopen(Request(f"{gateway}/v1/runs/{run_id}/events", headers={"Authorization": f"Bearer {key}"}), timeout=5) as stream:
            frames = stream.read().decode()
        assert "run.completed" in frames and "Delegated." in frames, frames
        print("Parent turn settled while the detached child was still running.", flush=True)
        # Stop making client requests: only the gateway notification watcher may start a turn.
        child_can_finish.set()
        assert wake_started.wait(25), "The gateway did not wake the parent without a chat client"
        wake_id = api(session + "/oma-activity")["run_id"]
        assert wake_id and wake_id != run_id, "The resumed run was not discoverable from the session"
        wake_can_finish.set()
        def resumed():
            rows = api(session + "/messages?include_compacted=true")["data"]
            if not any(row.get("content") == "Parent woke and received the child result." for row in rows):
                return None
            return rows
        rows = until(resumed)
        assert sum(row.get("display_kind") == "async_delegation_complete" for row in rows) == 1, rows
        assert sum(row.get("content") == "Parent woke and received the child result." for row in rows) == 1, rows
        print("One durable notification and one parent follow-up in the original session.", flush=True)
    finally:
        child_can_finish.set()
        wake_can_finish.set()
        proc.terminate()
        proc.wait(timeout=20)
