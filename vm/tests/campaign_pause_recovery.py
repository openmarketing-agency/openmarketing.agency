"""Verify the VM recovers interrupted campaign pauses and Hermes recognizes claims after recreation."""

from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from unittest.mock import patch

from hermes_cli import kanban_db
from hermes_cli.kanban_db_connect import connect_closing

from workspace import WorkspaceError, campaign_lifecycle_status, pending_campaign_pauses, recover_campaign_pauses


def save_campaign(root, campaign_id, state):
    path = root / "campaigns" / campaign_id / "config.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"id": campaign_id, "lifecycle_state": state}))
    return sha256(path.read_bytes()).hexdigest()


def verify_startup_recovery(root):
    original_revision = save_campaign(root, "fixture", "pausing")
    save_campaign(root, "operator-moved", "pausing")
    save_campaign(root, "running", "resumed")
    save_campaign(root, "stopped", "paused")
    pending = pending_campaign_pauses(root)
    assert pending == ["fixture", "operator-moved"]
    assert campaign_lifecycle_status(root, "fixture") == {"state": "pausing", "revision": original_revision}

    # The campaign may change after discovery, so each retry checks the current state and revision.
    save_campaign(root, "operator-moved", "resumed")
    lock = Lock()
    requests = []

    def pause(path, campaign_id, request):
        assert lock.locked()
        requests.append((campaign_id, request))
        assert path == root and campaign_id == "fixture" and request["state"] == "paused"
        if len(requests) == 1:
            raise WorkspaceError(503, "Gateway is still starting.")
        if len(requests) == 2:
            record = root / "campaigns" / campaign_id / "config.yaml"
            record.write_bytes(record.read_bytes() + b"\n")
            return {"state": "pausing"}
        save_campaign(root, campaign_id, "paused")
        return {"state": "paused"}

    with patch("workspace.change_campaign_lifecycle", side_effect=pause), patch("workspace.sleep") as wait:
        recover_campaign_pauses(root, pending, lock)
        assert wait.call_count == 2
    assert len(requests) == 3 and requests[0][1]["revision"] == original_revision
    assert requests[2][1]["revision"] != original_revision
    assert pending_campaign_pauses(root) == []
    assert campaign_lifecycle_status(root, "fixture")["state"] == "paused"
    assert campaign_lifecycle_status(root, "running")["state"] == "resumed"


def verify_restart_claims(home):
    database = kanban_db.init_db(home / "restart.db")
    with connect_closing(database) as conn:
        same_host = kanban_db.create_task(conn, title="Task from the previous VM", initial_status="running")
        other_host = kanban_db.create_task(conn, title="Task on another host", initial_status="running")
        for task_id, owner in ((same_host, kanban_db._host_prefix()), (other_host, "unrelated-host:")):
            # Reuse the test process PID like a VM restart can, with the old container's fingerprint.
            assert kanban_db.claim_task(conn, task_id, claimer=owner + "previous-worker")
            conn.execute("UPDATE tasks SET worker_pid = ?, worker_started_at = ? WHERE id = ?",
                         (os.getpid(), "previous-epoch|1", task_id))
            conn.commit()

        def reject_signal(*_args):
            raise AssertionError("Restart recovery must not signal a reused or foreign process")

        assert kanban_db.reclaim_task(conn, same_host, require_stopped=True, signal_fn=reject_signal)
        assert kanban_db.get_task(conn, same_host).status != "running"
        assert not kanban_db.reclaim_task(conn, other_host, require_stopped=True, signal_fn=reject_signal)
        assert kanban_db.get_task(conn, other_host).status == "running"


with TemporaryDirectory() as folder:
    root = Path(folder)
    verify_startup_recovery(root / "oma")
    verify_restart_claims(root)

print("Interrupted campaign pauses recover with stable VM ownership")
