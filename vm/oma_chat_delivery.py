"""OMA chat integration for the bundled Hermes gateway (not a public wake API)."""
import asyncio
from hashlib import sha256
import re

OMA_SESSION = re.compile(r"oma_[0-9a-f]{32}_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
API_SESSION = re.compile(r"[A-Za-z0-9_-]{1,128}")
RUN_ID = re.compile(r"run_[A-Za-z0-9_-]{1,128}")
WAKE_TEXT = ("[OMA_INTERNAL_DELEGATION_WAKE_V1] The gateway saved a background delegation result above. "
             "This is not a human message. Continue from that result; surface only new outcomes or blockers.")
LIVE_DELEGATION = {"running", "stalling", "finalizing"}


def project_activity(rows, children, lineage, owner):
    # The run's own auth uses this same profile/API-key scope. Never turn another principal's
    # admission into a web run handle (including on a shared listener).
    current = next((row.request_id for row in rows if RUN_ID.fullmatch(row.request_id)
                    and row.payload.get("api_turn_v1", {}).get("run_owner_scope") == owner), None)
    delegations = [{"id": child["delegation_id"], "status": child["status"],
                    "task_count": child.get("task_count") or len(child.get("tasks") or []) or 1}
                   for child in children if child.get("status") in LIVE_DELEGATION and any(
                       child.get(key) in lineage for key in ("parent_session_id", "origin_session_id", "session_key"))]
    return {"run_id": current, "delegations": delegations[:64]}


async def session_activity(adapter, request):
    from aiohttp import web
    from gateway.platforms.api_server_authority_runs import _authority
    from gateway.platforms.api_server_store import authority_store
    if not adapter._expected_api_key():
        return adapter._auth_failed_response()
    if (error := adapter._check_auth(request)) is not None:
        return error
    sid = request.match_info["session_id"]
    if not API_SESSION.fullmatch(sid):
        return web.json_response({"error": "Session not found"}, status=404)
    authority = _authority(adapter)
    if authority is None:
        return web.json_response({"error": "Session authority unavailable"}, status=503)
    store = authority_store(authority)
    room = await store.aio.sessions.get(sid)
    if room is None or room.source != "api_server":
        return web.json_response({"error": "Session not found"}, status=404)
    tip = await store.aio.lineage.resolve_resume_target(sid)
    lineage = set(await store.aio.lineage.resume_lineage_ids(tip)) | {sid, tip}
    rows = await store.aio.admissions.list(session_id=tip)
    from tools.async_delegation import list_async_delegations
    children = await asyncio.to_thread(list_async_delegations)
    return web.json_response(project_activity(rows, children, lineage, adapter._run_idempotency_scope(request)))


async def deliver_oma_completion(adapter, text, sid, event, persist=None, resumes=None, wake=None):
    if persist is None:
        from gateway.wake import persist_delegation_delivery as persist
    if resumes is None:
        from tools.process_registry_notifications import completion_resumes_parent as resumes
    wake = wake or admit_wake
    # The watcher owns retry and its claim is acknowledged only after both durable writes.
    # A native delivery row is keyed by the delegation; a lost wake receipt replays its keyed Run.
    await persist(adapter, text=text, session_id=sid, evt=event)
    delegation = event.get("delegation_id")
    if not delegation or not resumes(event):
        return
    db = await asyncio.to_thread(adapter._ensure_store)
    store = adapter._store_beside(db)
    root = str(await store.aio.lineage.conversation_root(sid) or sid)
    if not OMA_SESSION.fullmatch(root):
        return
    row = await store.aio.sessions.get(root)
    if row is None or row.source != "api_server" or getattr(row, "profile_name", None) not in (None, "default"):
        return
    key = sha256(f"oma-chat-delegation-v1\0{root}\0{delegation}".encode()).hexdigest()
    await wake(adapter, root, key)


async def admit_wake(adapter, root, key):
    import aiohttp
    # Only this gateway's own default listener. The console never calls this as a mutation.
    port = adapter._port or 8642
    if not adapter._api_key:
        raise RuntimeError("OMA delegation wake requires the default gateway key")
    host = "[::1]" if adapter._host in ("::", "::1") else "127.0.0.1"
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as http:
        async with http.post(f"http://{host}:{port}/v1/runs", headers={
            "Authorization": f"Bearer {adapter._api_key}", "Idempotency-Key": key,
        }, json={"session_id": root, "input": WAKE_TEXT}, allow_redirects=False) as response:
            if response.status not in (200, 202):
                raise RuntimeError(f"OMA delegation wake was not admitted (HTTP {response.status})")
            receipt = await response.json()
            if not RUN_ID.fullmatch(str(receipt.get("run_id", ""))):
                raise RuntimeError("OMA delegation wake returned no valid run receipt")
