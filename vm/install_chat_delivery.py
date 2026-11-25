"""Attach OMA chat to two pinned Hermes gateway extension points at image build."""
from pathlib import Path
import sys


def install(root):
    changes = [
        ("gateway/run_notifications.py",
            "            deliver = lambda: persist_delegation_delivery(adapter, text=synth_text, session_id=raw_sid, evt=evt)",
            "            from gateway.oma_chat_delivery import deliver_oma_completion\n"
            "            deliver = lambda: deliver_oma_completion(adapter, synth_text, raw_sid, evt, persist_delegation_delivery)",
        ),
        ("gateway/platforms/api_server.py",
            "        routes.extend(_api_runs._http_routes(self))",
            "        routes.extend(_api_runs._http_routes(self))\n"
            "        from gateway.oma_chat_delivery import session_activity\n"
            "        from functools import partial\n"
            "        routes.append(('GET', '/api/sessions/{session_id}/oma-activity', partial(session_activity, self)))",
        ),
        ("gateway/platforms/api_server_runs.py",
            "                    run.admission, stream_delta_callback=_text_cb,\n"
            "                    tool_start_callback=_tool_start, tool_complete_callback=_tool_complete)",
            "                    run.admission, stream_delta_callback=_text_cb, interim_assistant_callback=_interim_cb,\n"
            "                    tool_start_callback=_tool_start, tool_complete_callback=_tool_complete,\n"
            "                    subagent_callback=tool_cb)",
        ),
        ("gateway/session_api_turn.py",
            "'reasoning_callback', 'status_callback', 'interim_assistant_callback')",
            "'reasoning_callback', 'status_callback', 'interim_assistant_callback', 'subagent_callback')",
        ),
        ("gateway/session_api_turn.py",
            "    def tool_progress_callback(event_type, *args, **kwargs):\n"
            "        if event_type in ('tool.started', 'tool.completed'):",
            "    def tool_progress_callback(event_type, *args, **kwargs):\n"
            "        if event_type in ('subagent.start', 'subagent.complete'):\n"
            "            publish('subagent_callback', event_type, *args, **kwargs)\n"
            "        if event_type in ('tool.started', 'tool.completed'):",
        ),
    ]
    for name, original, replacement in changes:
        path = root / name
        source = path.read_text(encoding="utf-8")
        if replacement in source:
            continue
        if source.count(original) != 1:
            raise RuntimeError(f"OMA chat integration point changed: {name}")
        result = source.replace(original, replacement)
        compile(result, str(path), "exec")
        path.write_text(result, encoding="utf-8")


if __name__ == "__main__":
    install(Path(sys.argv[1]))
