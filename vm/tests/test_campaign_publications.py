"""Exercise real publication storage and the private Unix socket routes."""

from contextlib import contextmanager
from http.client import HTTPConnection
from pathlib import Path
import json
import socket
import sys
from socketserver import ThreadingUnixStreamServer
from tempfile import TemporaryDirectory
from threading import Lock, Thread
import unittest
from unittest.mock import patch

if Path("/opt/oma/workspace.py").is_file():
    sys.path.insert(0, "/opt/oma")
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace import WorkspaceHandler
from hermes_cli.oma_campaigns import publications


class UnixConnection(HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=5)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(str(self.path))


class CampaignPublicationsTest(unittest.TestCase):
    def test_reviews_are_scoped_and_stale_revisions_are_rejected(self):
        with TemporaryDirectory(prefix="pub-") as directory:
            home = Path(directory)
            for slug in ("seo", "other"):
                path = home / "oma" / "campaigns" / slug
                path.mkdir(parents=True)
                (path / "config.yaml").write_text(
                    f"id: {slug}\nname: Example\ndescription: Test\nmode: approve\n"
                    f"orchestrator: {slug}__orchestrator\nagents: [{slug}__orchestrator]\n", encoding="utf-8",
                )
            # The native campaign suite verifies real publisher and Kanban provisioning;
            # this fixture isolates the HTTP transport and the real approval transaction.
            @contextmanager
            def board(**_):
                yield object()

            with ThreadingUnixStreamServer(str(home / "s"), WorkspaceHandler) as server, \
                    patch.object(publications, "_publisher", return_value=("seo__publisher", "campaign-seo")), \
                    patch.object(publications, "connect_closing", board), \
                    patch.object(publications.kanban_db, "create_task", return_value="test-task") as enqueue:
                server.root = home / "oma"
                server.edit_lock = Lock()
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    def request(method, suffix, body=None):
                        conn = UnixConnection(home / "s")
                        try:
                            conn.request(method, "/workspace/campaigns/" + suffix,
                                         json.dumps(body) if body is not None else None,
                                         {"Content-Type": "application/json"} if body is not None else {})
                            response = conn.getresponse()
                            return response.status, json.loads(response.read())
                        finally:
                            conn.close()

                    self.assertEqual(request("GET", "seo/publications"), (200, {
                        "campaign_id": "seo", "mode": "approve", "publications": [], "next_cursor": None,
                    }))
                    draft = {"platform": "x", "account": {"id": "connected"}, "kind": "reply",
                             "target": {"id": "exact-target", "text": "Parent text"}, "content": {"text": "First"}}
                    item = publications.save_publication(home, "seo", "seo__orchestrator", draft)["id"]
                    draft["content"]["text"] = "Changed"
                    publications.save_publication(home, "seo", "seo__orchestrator", draft, publication_id=item, revision=1)
                    status, page = request("GET", "seo/publications?limit=1")
                    self.assertEqual(status, 200)
                    self.assertEqual(page["publications"][0]["target"], draft["target"])
                    self.assertEqual(request("POST", f"other/publications/{item}/approve", {"revision": 2, "approver": "owner"})[0], 404)
                    url = f"seo/publications/{item}/approve"
                    self.assertEqual(request("POST", url, {"revision": 1, "approver": "owner"})[0], 409)
                    self.assertEqual(request("POST", url, {"revision": 2, "approver": "owner", "status": "published"})[0], 422)
                    status, approved = request("POST", url, {"revision": 2, "approver": "owner"})
                    self.assertEqual(status, 200)
                    self.assertEqual(approved["status"], "approved")
                    self.assertEqual(approved["approval"]["by"], "owner")
                    self.assertEqual(approved["content"], draft["content"])
                    self.assertEqual(request("POST", url, {"revision": 2, "approver": "owner"})[1]["task_id"], "test-task")
                    enqueue.assert_called_once()
                    self.assertEqual(enqueue.call_args.kwargs["assignee"], "seo__publisher")
                finally:
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
