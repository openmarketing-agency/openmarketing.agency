"""Verify campaign-to-board matching against the authenticated Kanban API in the disposable smoke VM."""

from http.client import HTTPConnection
import json
import os
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
from threading import Thread

from hermes_cli import kanban_db
from hermes_cli.kanban_db_connect import connect_closing

from workspace import ThreadingUnixStreamServer, WorkspaceHandler


class WorkspaceConnection(HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


def fetch(address, campaign_id, view="kanban"):
    client = WorkspaceConnection(address, timeout=10)
    try:
        client.request("GET", f"/workspace/campaigns/{campaign_id}/{view}")
        response = client.getresponse()
        return response.status, json.load(response)
    finally:
        client.close()


def save_campaign(root, campaign_id, **settings):
    path = root / "campaigns" / campaign_id / "config.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"id": campaign_id, **settings}))


home = Path(os.environ["HERMES_HOME"])
primary, other, empty = "campaign-stats-fixture", "other-stats-fixture", "empty-stats-fixture"
boards = {}
try:
    for slug, name in ((primary, "Shared Board Name"), (other, "Shared Board Name"), (empty, "Empty Fixture Board")):
        assert not kanban_db.board_exists(slug)
        boards[slug] = kanban_db.create_board(slug, name=name)
    with connect_closing(board=primary) as connection:
        task_id = kanban_db.create_task(connection, title="Investigate", body="Review the campaign brief", triage=True, board=primary)
        kanban_db.create_task(connection, title="Needs attention", initial_status="blocked", board=primary)
        archived = kanban_db.create_task(connection, title="Archived work", board=primary)
        assert kanban_db.archive_task(connection, archived)
    with connect_closing(board=other) as connection:
        other_task = kanban_db.create_task(connection, title="Different board", board=other)

    with TemporaryDirectory(dir=home, prefix="kanban-fixture-") as directory:
        root = Path(directory)
        save_campaign(root, "campaign-with-id", kanban_board=primary, kanban_board_name="Old display name")
        save_campaign(root, "campaign-with-name", kanban_board_name="Empty Fixture Board")
        save_campaign(root, "campaign-ambiguous", kanban_board_name="Shared Board Name")
        save_campaign(root, "campaign-missing", kanban_board="campaign-missing-fixture")
        save_campaign(root, "campaign-draft")
        save_campaign(root, "campaign-invalid", kanban_board="invalid&board=default")
        address = str(root / "socket")
        with ThreadingUnixStreamServer(address, WorkspaceHandler) as server:
            server.root = root
            worker = Thread(target=server.serve_forever)
            worker.start()
            try:
                assert fetch(address, "campaign-with-id") == (200, {"state": "ready", "counts": {"triage": 1, "blocked": 1}})
                assert fetch(address, "campaign-with-name") == (200, {"state": "ready", "counts": {}})
                assert fetch(address, "campaign-ambiguous") == (200, {"state": "ambiguous"})
                assert fetch(address, "campaign-missing") == (200, {"state": "missing"})
                assert fetch(address, "campaign-draft") == (200, {"state": "unconfigured"})
                assert fetch(address, "campaign-invalid")[0] == 422
                assert fetch(address, "not-a-campaign")[0] == 404
                status, progress = fetch(address, "campaign-with-id", "progress")
                assert status == 200 and progress["board"]["state"] == "ready", progress
                tasks = progress["board"]["tasks"]
                assert {(item["title"], item["status"]) for item in tasks} == {
                    ("Investigate", "triage"), ("Needs attention", "blocked"),
                }
                assert all("workspace_path" not in item and "claim_lock" not in item for item in tasks)
                status, detail = fetch(address, "campaign-with-id", "tasks/" + task_id)
                assert status == 200 and detail["body"] == "Review the campaign brief"
                assert any(event["kind"] == "created" for event in detail["events"])
                assert fetch(address, "campaign-with-id", "tasks/" + other_task)[0] == 404
                assert fetch(address, "campaign-draft", "progress")[1]["board"]["state"] == "unconfigured"
                assert fetch(address, "campaign-ambiguous", "progress")[1]["board"]["state"] == "ambiguous"
            finally:
                server.shutdown()
                worker.join()
finally:
    for slug in boards:
        kanban_db.remove_board(slug, archive=False)

print("Campaigns read only their board’s counts, tasks, and task history from the Kanban API")
