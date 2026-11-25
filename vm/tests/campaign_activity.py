"""Verify campaign activity reads real Hermes stores over the private workspace socket, including isolation and redaction."""

from contextlib import closing
from http.client import HTTPConnection
import json
from pathlib import Path
import socket
import sqlite3
from tempfile import TemporaryDirectory
from threading import Thread

from hermes_state import SessionDB
from workspace import ThreadingUnixStreamServer, WorkspaceHandler


class WorkspaceConnection(HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


prefix = "oma_" + "a" * 32 + "_"
other_prefix = "oma_" + "b" * 32 + "_"
legacy = "11111111-1111-4111-8111-111111111111"
root_session = prefix + "00000000-0000-4000-8000-000000000001"
foreign = other_prefix + "00000000-0000-4000-8000-000000000001"
scope = {"chatPrefix": prefix, "legacySessions": [legacy]}
secret = "fixture-provider-secret-123456"


def files(root, contents):
    for name, content in contents.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)


def request(address, campaign="fixture", **query):
    with closing(WorkspaceConnection(address, timeout=10)) as client:
        client.request("POST", f"/workspace/campaigns/{campaign}/activity", json.dumps({**scope, **query}),
                       {"Content-Type": "application/json"})
        response = client.getresponse()
        return response.status, json.load(response)


with TemporaryDirectory() as disposable:
    home = Path(disposable)
    workspace = home / "oma"
    files(home, {
        "oma/campaigns/fixture/config.yaml": "id: fixture\nkanban_board: campaign-fixture\nagents: [writer, other]\n",
        "oma/campaigns/other/config.yaml": "id: other\nkanban_board: campaign-other\nagents: [other]\n",
        "oma/agents/writer/config.yaml": "id: writer\ncampaign_id: fixture\n",
        "oma/agents/other/config.yaml": "id: other\ncampaign_id: other\n",
        "profiles/writer/.env": "OPENROUTER_API_KEY=" + secret,
        "profiles/other/.env": "OPENROUTER_API_KEY=foreign-secret",
        "profiles/writer/cron/jobs.json": '{"jobs":[{"id":"123456abcdef","name":"Weekly insights"}]}',
        "profiles/writer/cron/output/123456abcdef/2026-11-24_01-02-03.md": "Weekly brief\n" + secret,
        "profiles/writer/logs/agent.log": "2026-11-24 01:02:05,390 INFO [worker] agent: Draft saved\n"
                                         "2026-11-24 01:02:06,390 INFO [delegated-b] agent: Delegated log\n",
        "kanban/boards/campaign-fixture/logs/t_fixture.log": "Running task\n" + secret + "\n" + "m" * 25000,
        "kanban/boards/campaign-fixture/logs/t_fixture.log.1": "Earlier worker output",
        "kanban/boards/campaign-other/logs/t_other.log": "Other board log",
        "logs/agent.log": f"2026-11-24 01:02:03,390 INFO [{root_session}] agent: Started chat\n"
                          f"2026-11-24 01:02:04,390 INFO [{foreign}] agent: Unrelated chat\n",
        "logs/agent.log.1": f"2026-11-24 01:00:03,390 INFO [{root_session}] agent: Previous log\n",
    })
    (home / "profiles/writer/logs/errors.log").symlink_to(home / "profiles/other/.env")
    for profile, sid in (("writer", "worker"), ("other", "foreign-worker")):
        with closing(SessionDB(home / "profiles" / profile / "state.db")) as db:
            db.create_session(sid, "kanban", model="fixture-model")
            db.create_session("cron_123456abcdef_20261124_010203", "cron")
            db.create_session("worker-child", "subagent", parent_session_id=sid)
            db.append_message(sid, "tool", content="Saved outline", tool_name="write_file")
    with closing(SessionDB(home / "state.db")) as db:
        db.create_session(root_session, "api_server", system_prompt="INTERNAL SYSTEM PROMPT")
        db.create_session(foreign, "api_server")
        db.create_session(legacy, "api_server")
        db.create_session("delegated-a", "subagent", parent_session_id=root_session)
        db.create_session("delegated-b", "subagent", parent_session_id="delegated-a")
        db.create_session("foreign-child", "subagent", parent_session_id=foreign)
        db.create_session("default-worker", "kanban", cwd=str(home / "kanban/boards/campaign-fixture/workspaces/t_fixture"))
        first_id = db.append_message(root_session, "user", content="Write a brief\n\nCampaign ID: fixture")
        db.append_message(root_session, "assistant", tool_calls=[{"type": "function", "function": {
            "name": "search", "arguments": '{"topic":"brief"}',
        }}], reasoning="PRIVATE PROVIDER REASONING")
        tool_id = db.append_message(root_session, "tool", content="a" * 25_000 + "Long output ends here", tool_name="search")
        db.append_message(root_session, "user", content="HIDDEN CONTROL", display_kind="hidden")
        db.append_message("delegated-b", "assistant", content="Delegated draft")
        for index in range(26):
            db.append_message(root_session, "assistant", content=f"Message {index}")

        # Keep the runtime database open to exercise reads alongside its WAL.
        with closing(sqlite3.connect(home / "state.db")) as reader:
            assert reader.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        address = str(home / "socket")
        with ThreadingUnixStreamServer(address, WorkspaceHandler) as server:
            server.root = workspace
            thread = Thread(target=server.serve_forever)
            thread.start()
            try:
                status, index = request(address)
                assert status == 200, index
                by_ref = {item["ref"]: item for item in index["entries"]}
                expected = {root_session, legacy, "delegated-a", "delegated-b", "worker-child", "default-worker", "worker",
                            "cron_123456abcdef_20261124_010203", "t_fixture.log", "t_fixture.log.1",
                            "123456abcdef/2026-11-24_01-02-03.md", "agent.log"}
                assert expected == set(by_ref), by_ref
                assert by_ref["delegated-b"]["parent"] == "delegated-a"
                assert by_ref["worker"]["category"] == "worker"
                assert by_ref["123456abcdef/2026-11-24_01-02-03.md"]["title"] == "Weekly insights"
                assert by_ref["default-worker"]["category"] == "worker"
                assert index["partial"], "wrong-campaign profile is reported unavailable"
                status, delegated = request(address, category="delegated", agent="writer")
                assert status == 200 and [entry["ref"] for entry in delegated["entries"]] == ["worker-child"], delegated

                details = {"kind": "session", "profile": "default", "ref": root_session}
                status, transcript = request(address, **details)
                assert status == 200, transcript
                assert transcript["nextOffset"] == 25 and transcript["messages"][0]["id"] == first_id
                assert transcript["messages"][0]["text"] == "Write a brief"
                assert transcript["messages"][1]["calls"] == [{"name": "search", "arguments": '{"topic":"brief"}'}]
                assert transcript["messages"][2]["truncated"] and transcript["messages"][2]["tool"] == "search"
                assert "INTERNAL" not in str(transcript) and "PRIVATE" not in str(transcript) and "HIDDEN" not in str(transcript)
                assert request(address, offset=25, **details)[1]["nextOffset"] is None
                status, full = request(address, view="message", message=tool_id, **details)
                assert status == 200 and full["nextOffset"] == 24_000
                assert request(address, view="message", message=tool_id, offset=24_000, **details)[1]["text"].endswith("Long output ends here")
                status, logs = request(address, view="log", **details)
                assert status == 200 and "Started chat" in logs["text"] and "Previous log" in logs["text"]
                assert "Unrelated chat" not in logs["text"]
                assert request(address, kind="session", profile="default", ref="delegated-b")[1]["messages"][0]["text"] == "Delegated draft"
                nested_log = request(address, kind="session", profile="default", ref="delegated-b", view="log")
                assert nested_log[0] == 200 and "Delegated log" in nested_log[1]["text"], nested_log

                status, worker_log = request(address, kind="task-log", profile="", ref="t_fixture.log")
                assert status == 200 and "Running task" in worker_log["text"] and worker_log["nextOffset"] == 24_000
                assert secret not in worker_log["text"] and "[redacted]" in worker_log["text"]
                assert request(address, kind="task-log", profile="", ref="t_fixture.log.1")[1]["text"] == "Earlier worker output"
                assert request(address, kind="job-log", profile="writer", ref="123456abcdef/2026-11-24_01-02-03.md")[1]["text"] == "Weekly brief\n[redacted]"
                assert "Draft saved" in request(address, kind="profile-log", profile="writer", ref="agent.log")[1]["text"]

                for kind, profile, ref in (
                    ("session", "default", foreign), ("session", "default", "foreign-child"),
                    ("session", "other", "foreign-worker"), ("task-log", "", "t_other.log"),
                    ("task-log", "", "../campaign-other/logs/t_other.log"),
                    ("profile-log", "default", "agent.log"), ("job-log", "writer", "../other/.env"),
                ):
                    assert request(address, kind=kind, profile=profile, ref=ref)[0] == 404, ref
                assert request(address, kind="profile-log", profile="writer", ref="errors.log")[0] != 200
                assert request(address, "missing")[0] == 404
                assert request(address, "other", kind="session", profile="writer", ref="worker")[0] == 404
                assert request(address, "other", chatPrefix=other_prefix, kind="session", profile="default", ref=root_session)[0] == 404
            finally:
                server.shutdown()
                thread.join()
