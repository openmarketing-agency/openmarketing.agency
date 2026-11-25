"""Regression coverage for the bundled console gateway extension."""

from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import oma_chat_delivery as delivery


class ChatDeliveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_persists_then_wakes_only_owning_oma_session_with_stable_key(self):
        root = "oma_" + "a" * 32 + "_11000000-0000-4000-8000-000000000001"
        store = SimpleNamespace(aio=SimpleNamespace(
            lineage=SimpleNamespace(conversation_root=AsyncMock(return_value=root)),
            sessions=SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(source="api_server"))),
        ))
        adapter = SimpleNamespace(_ensure_store=lambda: store, _store_beside=lambda db: db)
        persist, wake = AsyncMock(), AsyncMock()
        event = {"type": "async_delegation", "delegation_id": "deleg_01234567"}
        wake.side_effect = lambda *_: self.assertEqual(persist.await_count, wake.await_count)
        await delivery.deliver_oma_completion(adapter, "result", "compacted", event, persist, lambda _: True, wake)
        await delivery.deliver_oma_completion(adapter, "result", "compacted", event, persist, lambda _: True, wake)
        self.assertEqual(wake.await_args_list[0], wake.await_args_list[1])
        self.assertEqual(wake.await_args_list[0].args[1], root)
        await delivery.deliver_oma_completion(adapter, "diagnostic", "compacted", event, persist, lambda _: False, wake)
        store.aio.lineage.conversation_root.return_value = "not-an-oma-session"
        await delivery.deliver_oma_completion(adapter, "other", "compacted", event, persist, lambda _: True, wake)
        self.assertEqual(persist.await_count, 4)
        self.assertEqual(wake.await_count, 2)

    async def test_failed_admission_is_not_acknowledged(self):
        root = "oma_" + "a" * 32 + "_11000000-0000-4000-8000-000000000001"
        store = SimpleNamespace(aio=SimpleNamespace(
            lineage=SimpleNamespace(conversation_root=AsyncMock(return_value=root)),
            sessions=SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(source="api_server"))),
        ))
        adapter = SimpleNamespace(_ensure_store=lambda: store, _store_beside=lambda db: db)
        with self.assertRaisesRegex(RuntimeError, "busy"):
            await delivery.deliver_oma_completion(adapter, "result", root, {"delegation_id": "deleg_x"},
                                                  AsyncMock(), lambda _: True, AsyncMock(side_effect=RuntimeError("busy")))

    def test_session_projection_exposes_only_owned_runs_and_safe_tasks(self):
        rows = [SimpleNamespace(request_id="run_user", payload={"api_turn_v1": {"run_owner_scope": "ours"}}),
                SimpleNamespace(request_id="run_other", payload={"api_turn_v1": {"run_owner_scope": "other"}})]
        children = [dict(delegation_id="deleg_a", parent_session_id="tip", status="running", task_count=2, secret="no"),
                    dict(delegation_id="deleg_b", parent_session_id="other", status="running", task_count=3)]
        self.assertEqual(delivery.project_activity(rows, children, {"root", "tip"}, "ours"), {
            "run_id": "run_user", "delegations": [{"id": "deleg_a", "status": "running", "task_count": 2}],
        })


if __name__ == "__main__":
    unittest.main()
