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


def fetch(address, campaign_id):
    client = WorkspaceConnection(address, timeout=10)
    try:
        client.request("GET", f"/workspace/campaigns/{campaign_id}/kanban")
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
        kanban_db.create_task(connection, title="Investigate", triage=True, board=primary)
        kanban_db.create_task(connection, title="Needs attention", initial_status="blocked", board=primary)
        archived = kanban_db.create_task(connection, title="Archived work", board=primary)
        assert kanban_db.archive_task(connection, archived)
    with connect_closing(board=other) as connection:
        kanban_db.create_task(connection, title="Different board", board=other)

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
            finally:
                server.shutdown()
                worker.join()
finally:
    for slug in boards:
        kanban_db.remove_board(slug, archive=False)

print("Campaigns read exact task counts from the Kanban API")
