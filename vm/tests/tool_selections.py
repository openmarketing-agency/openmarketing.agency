"""Exercise workspace tool selection writes and migration receipts over a disposable Unix socket."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import socket
import stat
import sys
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from unittest.mock import patch

if Path("/opt/oma/workspace.py").is_file():
    sys.path.insert(0, "/opt/oma")
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace import ThreadingUnixStreamServer, WorkspaceHandler


ENDPOINT = "/workspace/tool-selections"
ADDRESS = "tool-selections.sock"


class Connection(HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


def request(method, body=None, path=ENDPOINT):
    client = Connection(ADDRESS, timeout=10)
    try:
        client.request(method, path, json.dumps(body) if body is not None else None)
        reply = client.getresponse()
        return reply.status, json.loads(reply.read())
    finally:
        client.close()


@contextmanager
def workspace_socket(root):
    try:
        with ThreadingUnixStreamServer(ADDRESS, WorkspaceHandler) as server:
            server.edit_lock = Lock()
            server.root = root
            worker = Thread(target=server.serve_forever)
            worker.start()
            try:
                yield
            finally:
                server.shutdown()
                worker.join()
    finally:
        Path(ADDRESS).unlink(missing_ok=True)


def put(campaign_id, slug, selected=True):
    return request("PUT", {"campaignId": campaign_id, "slug": slug, "selected": selected})


def import_rows(migration):
    return request("POST", migration, ENDPOINT + "/import")


with TemporaryDirectory(prefix="oma-tool-selections-") as temporary:
    # Keep the Unix socket address below host path limits and all data isolated.
    os.chdir(temporary)
    root = Path(temporary).resolve() / "oma"
    sidecar = root / "tool-selections.json"
    migration = {
        "migrationId": "1" * 64,
        "workspace": ["read_only", "read_only"],
        "campaigns": {"draft": ["search", "read_only"], "temporarily-missing": ["read_only", "archive"]},
    }

    with workspace_socket(root):
        assert request("GET") == (200, {"workspace": [], "campaigns": {}})
        assert not root.exists()
        assert put("missing", "new-tool")[0] == 404
        assert put("../draft", "new-tool")[0] == 422
        assert put(None, "a" * 129)[0] == 422
        assert put(None, "valid", 1)[0] == 422
        assert import_rows({**migration, "migrationId": "F" * 64})[0] == 422
        assert import_rows({**migration, "campaigns": {"../bad": ["valid"]}})[0] == 422
        assert put(None, "workspace-existing")[0] == 200

        campaign = root / "campaigns" / "draft" / "config.yaml"
        campaign.parent.mkdir(parents=True)
        config = b"# Keep the agent's YAML intact.\nid: draft\nname: Draft campaign\n"
        campaign.write_bytes(config)
        assert put("draft", "campaign-existing")[0] == 200
        assert import_rows(migration) == (200, {"migrationId": migration["migrationId"]})
        assert request("GET") == (200, {
            "workspace": ["read_only", "workspace-existing"],
            "campaigns": {"draft": ["campaign-existing", "read_only", "search"],
                          "temporarily-missing": ["archive", "read_only"]},
        })

        # Parallel mutations and an import retain each other’s additions.
        parallel = {"migrationId": "2" * 64, "workspace": [], "campaigns": {"draft": ["import-add"]}}
        additions = [f"tool_{index}" for index in range(20)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(import_rows, parallel), *(pool.submit(put, "draft", slug) for slug in additions)]
            assert all(result.result()[0] == 200 for result in pending)
        assert set(request("GET")[1]["campaigns"]["draft"]) == {
            "campaign-existing", "read_only", "search", "import-add", *additions,
        }
        assert put(None, "read_only", False)[0] == 200
        assert put("draft", "import-add", False)[0] == 200
        assert campaign.read_bytes() == config
        assert stat.S_IMODE(sidecar.stat().st_mode) == 0o600

        receipt = {"migrationId": "3" * 64, "workspace": [], "campaigns": {}}
        original_fsync = os.fsync

        def fail_workspace_fsync(descriptor):
            if os.fstat(descriptor).st_ino == root.stat().st_ino:
                raise OSError("test directory fsync failure")
            original_fsync(descriptor)

        # A rename succeeds before directory fsync. A retry waits for durability too.
        with patch("workspace.os.fsync", side_effect=fail_workspace_fsync):
            assert import_rows(receipt)[0] == 503
            assert receipt["migrationId"] in json.loads(sidecar.read_bytes())["imports"]
            assert import_rows(receipt)[0] == 503
        assert import_rows(receipt) == (200, {"migrationId": receipt["migrationId"]})

    with workspace_socket(root):
        assert import_rows(migration) == (200, {"migrationId": migration["migrationId"]})
        assert import_rows(parallel) == (200, {"migrationId": parallel["migrationId"]})
        assert request("GET") == (200, {
            "workspace": ["workspace-existing"],
            "campaigns": {"draft": sorted({"campaign-existing", "search", *additions}), "temporarily-missing": ["archive"]},
        })
        assert put("temporarily-missing", "archive", False)[0] == 200

        # Never overwrite corrupt/symlinked state or follow it outside the workspace.
        original = sidecar.read_bytes()
        sidecar.write_text("{broken")
        assert request("GET")[0] == 422
        assert put(None, "replacement")[0] == 422
        assert sidecar.read_text() == "{broken"
        sidecar.unlink()
        outside = root.parent / "external.json"
        outside.write_bytes(original)
        sidecar.symlink_to(outside)
        assert request("GET")[0] == 503
        assert import_rows(migration)[0] == 503
        assert sidecar.is_symlink() and outside.read_bytes() == original

print("Workspace tool selection persistence and migration passed over the private Unix socket")
