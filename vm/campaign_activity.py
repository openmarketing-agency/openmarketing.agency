"""Read campaign-owned Hermes sessions and retained logs from native runtime stores.

Reads are scoped to verified profiles and chat roots supplied by the console. The
service projects display fields, redacts text, and never opens SQLite for writes.
"""

from contextlib import ExitStack, contextmanager, closing
from io import StringIO
import json
import os
import re
import sqlite3
import stat
from urllib.parse import quote


SLUG = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
SESSION_ID = re.compile(r"[A-Za-z0-9_-]{1,200}")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", re.I)
CHAT_PREFIX = re.compile(r"oma_[a-f0-9]{32}_")
TASK_FILE = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\.log(?:\.1)?")
CRON_FILE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}\.md")
LOG_FILE = re.compile(r"(?:agent|gateway|errors)\.log(?:\.[0-9]+)?")
LOG_SESSION = re.compile(r"^\d{4}-\d\d-\d\d [\d:.,]+ [A-Z]+ \[([^\]]+)\] ")
SECRET_NAME = re.compile(r"(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)", re.I)
PAGE_SIZE = 30
MESSAGE_SIZE = 25
LOG_PAGE_SIZE = 24_000
MAX_LOG_BYTES = 32 * 1024 * 1024
CATEGORIES = {"chat", "agent", "worker", "cron", "delegated"}


class ActivityError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


@contextmanager
def directory(path, parent=None):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        yield fd
    finally:
        os.close(fd)


@contextmanager
def regular_file(parent, name):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(name, flags, dir_fd=parent), "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise OSError("Unsupported runtime file")
        yield stream, info


@contextmanager
def database(parent):
    # Keep the directory open so SQLite can see the live WAL. Reject links
    # before letting SQLite open the standard database and its sidecars.
    with regular_file(parent, "state.db"):
        for name in ("state.db-wal", "state.db-shm", "state.db-journal"):
            try:
                with regular_file(parent, name):
                    pass
            except FileNotFoundError:
                continue
        fd_path = f"/proc/self/fd/{parent}"
        uri = "file:" + quote(fd_path + "/state.db", safe="/") + "?mode=ro&nofollow=1"
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
            yield connection


def columns(db, table):
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def redactor(*profiles):
    from agent.redact import redact_credential_shapes
    from dotenv import dotenv_values

    secrets = {value for name, value in os.environ.items() if SECRET_NAME.search(name) and len(value) >= 4}
    for parent in set(profiles):
        for name in (".env", ".oma-dashboard-token"):
            try:
                with regular_file(parent, name) as (stream, info):
                    if info.st_size > 256 * 1024:
                        raise OSError("Runtime credentials exceed size limit")
                    text = stream.read(256 * 1024 + 1).decode("utf-8", errors="replace")
            except FileNotFoundError:
                continue
            if name == ".env":
                secrets.update(value for key, value in dotenv_values(stream=StringIO(text), interpolate=False).items()
                               if SECRET_NAME.search(key) and value and len(value) >= 4)
            elif text.strip():
                secrets.add(text.strip())
    values = sorted(secrets, key=len, reverse=True)

    def clean(text):
        for value in values:
            text = text.replace(value, "[redacted]")
        return redact_credential_shapes(text, force=True, redact_url_credentials=True)

    return clean


def timestamp(value):
    return value if type(value) in (int, float) and 0 < value < 253402300800 else None


def session_rows(db, profile, prefix, legacy, board_workspaces, ref=None):
    fields = columns(db, "sessions")
    required = {"id", "source", "started_at", "parent_session_id"}
    if not required <= fields:
        raise sqlite3.DatabaseError("Unsupported Hermes session schema")
    optional = ("title", "ended_at", "end_reason", "last_activity_at", "message_count", "tool_call_count", "cwd")
    select = ["s." + name if name in fields else "NULL AS " + name for name in optional]
    marker = "CASE WHEN json_valid(s.model_config) THEN json_extract(s.model_config, '$._delegate_from') END" \
        if "model_config" in fields else "NULL"
    select.append(marker + " AS delegate_from")
    args = []
    scope = ""
    join = ""
    if profile == "default":
        # UNION deduplicates cycles, and constrains the parent traversal to this
        # store. A model-supplied campaign mention is never a membership signal.
        board_seed = ""
        args = [prefix, prefix[:-1] + "`", json.dumps(legacy)]
        if board_workspaces and "cwd" in fields:
            path = board_workspaces + "/"
            board_seed = " OR (source IN ('kanban', 'cli') AND cwd >= ? AND cwd < ?)"
            args.extend([path, path[:-1] + "0"])
        scope = f"""WITH RECURSIVE owned(id) AS (
            SELECT id FROM sessions WHERE (id >= ? AND id < ?) OR id IN (SELECT value FROM json_each(?)) {board_seed}
            UNION SELECT s.id FROM sessions s JOIN owned ON s.parent_session_id = owned.id
        )"""
        join = "JOIN owned ON s.id = owned.id"
    query = f"{scope} SELECT s.id, s.source, s.started_at, s.parent_session_id, {', '.join(select)} FROM sessions s {join}"
    if ref is not None:
        query += " WHERE s.id = ?"
        args.append(ref)
    for row in db.execute(query, args):
        if not matches(SESSION_ID, row["id"]):
            continue
        source = row["source"]
        parent = row["parent_session_id"]
        delegated = source == "subagent" or bool(row["delegate_from"])
        cwd = row["cwd"]
        on_board = board_workspaces and isinstance(cwd, str) and cwd.startswith(board_workspaces + "/")
        kind = ("delegated" if delegated else "cron" if source == "cron" else "worker" if source == "kanban" or on_board
                else "chat" if profile == "default" else "agent")
        yield {
            "kind": "session", "category": kind, "profile": profile, "ref": row["id"],
            "parent": parent if matches(SESSION_ID, parent) else None,
            "title": str(row["title"] or "")[:512],
            "at": timestamp(row["last_activity_at"]) or timestamp(row["ended_at"]) or timestamp(row["started_at"]),
            "status": str(row["end_reason"] or ("finished" if row["ended_at"] else ""))[:80],
            "messages": max(row["message_count"] or 0, 0) if type(row["message_count"]) is int else 0,
            "tools": max(row["tool_call_count"] or 0, 0) if type(row["tool_call_count"]) is int else 0,
        }


def log_entry(kind, profile, ref, title, info):
    return {"kind": kind, "category": {"job-log": "cron", "task-log": "worker", "profile-log": "agent"}[kind], "profile": profile,
            "ref": ref, "title": title, "at": timestamp(info.st_mtime), "status": "", "parent": None,
            "messages": 0, "tools": 0}


def file_stat(folder, name):
    info = os.stat(name, dir_fd=folder, follow_symlinks=False)
    return info if stat.S_ISREG(info.st_mode) and info.st_nlink == 1 else None


def job_logs(profile, parent):
    with directory("cron", parent) as cron, directory("output", cron) as output:
        jobs = {}
        try:
            with regular_file(cron, "jobs.json") as (stream, info):
                payload = json.loads(stream.read(256 * 1024 + 1)) if info.st_size <= 256 * 1024 else {}
            rows = payload.get("jobs", []) if isinstance(payload, dict) else payload
            for job in rows if isinstance(rows, list) else []:
                if isinstance(job, dict) and matches(SLUG, job.get("id")):
                    jobs[job["id"]] = str(job.get("name") or "")[:160]
        except (FileNotFoundError, ValueError, RecursionError):
            # The retained output may outlive its scheduled job declaration.
            pass
        for job in filter(lambda name: matches(SLUG, name), os.listdir(output)):
            try:
                with directory(job, output) as folder:
                    for filename in filter(lambda name: matches(CRON_FILE, name), os.listdir(folder)):
                        info = file_stat(folder, filename)
                        if info:
                            yield log_entry("job-log", profile, job + "/" + filename, jobs.get(job) or "Scheduled job " + job, info)
            except (FileNotFoundError, NotADirectoryError):
                continue


@contextmanager
def worker_folder(home, board):
    with directory("kanban", home) as kanban:
        if board == "default":
            with directory("logs", kanban) as folder:
                yield folder
        else:
            with directory("boards", kanban) as boards, directory(board, boards) as named, directory("logs", named) as folder:
                yield folder


def profile_logs(profile, parent):
    with directory("logs", parent) as logs:
        for name in filter(lambda filename: matches(LOG_FILE, filename), os.listdir(logs)):
            info = file_stat(logs, name)
            if info:
                yield log_entry("profile-log", profile, name, name, info)


def worker_logs(home, board):
    with worker_folder(home, board) as folder:
        for filename in filter(lambda name: matches(TASK_FILE, name), os.listdir(folder)):
            info = file_stat(folder, filename)
            if info:
                task = filename.split(".", 1)[0]
                suffix = " · previous log" if filename.endswith(".1") else " · worker log"
                yield log_entry("task-log", "", filename, task + suffix, info)


@contextmanager
def profile_directory(home, profile):
    if profile == "default":
        yield home
    else:
        with directory("profiles", home) as profiles, directory(profile, profiles) as folder:
            yield folder


def page(rows, offset, size):
    visible = rows[offset:offset + size]
    return visible, offset + size if len(rows) > offset + size else None


def entry_page(home, profiles, prefix, legacy, board, board_workspaces, query, partial):
    items = []
    for profile in profiles:
        if query.get("agent") not in (None, profile):
            continue
        try:
            with profile_directory(home, profile) as folder:
                rows = []
                try:
                    with database(folder) as db:
                        rows.extend(session_rows(db, profile, prefix, legacy, board_workspaces))
                except FileNotFoundError:
                    pass
                except (OSError, sqlite3.Error):
                    partial = True
                if profile != "default":
                    for category, logs in (("cron", job_logs), ("agent", profile_logs)):
                        if query.get("category") not in (None, category):
                            continue
                        try:
                            rows.extend(logs(profile, folder))
                        except FileNotFoundError:
                            pass
                        except OSError:
                            partial = True
                for item in rows:
                    if query.get("category") in (None, item["category"]):
                        items.append(item)
        except FileNotFoundError:
            continue
        except (OSError, ValueError):
            partial = True
    if board and query.get("category") in (None, "worker") and not query.get("agent"):
        try:
            items.extend(worker_logs(home, board))
        except FileNotFoundError:
            pass
        except OSError:
            partial = True
    items.sort(key=lambda item: (item["at"] or 0, item["kind"], item["profile"], item["ref"]), reverse=True)
    rows, next_offset = page(items, query["offset"], PAGE_SIZE)
    for profile in set(row["profile"] for row in rows) - {""}:
        selected = [row for row in rows if row["profile"] == profile]
        try:
            with profile_directory(home, profile) as folder:
                clean = redactor(home, folder)
            for row in selected:
                row["title"] = clean(row["title"])
                row["status"] = clean(row["status"])
        except OSError:
            partial = True
            for row in selected:
                row["title"] = row["status"] = ""
    return {"entries": rows, "nextOffset": next_offset, "partial": partial}


def read_text(folder, name):
    with regular_file(folder, name) as (stream, info):
        if info.st_size > MAX_LOG_BYTES:
            raise ActivityError(413, "This runtime log exceeds the display size limit.")
        data = stream.read(MAX_LOG_BYTES + 1)
        if len(data) > MAX_LOG_BYTES:
            raise ActivityError(413, "This runtime log exceeds the display size limit.")
        return data.decode("utf-8-sig", errors="replace")


def session_log(folder, ref):
    # A shared profile's untagged lines may belong to other campaigns. Only
    # exact Hermes record tags are reliable, including in rotated files.
    lines = {}
    try:
        with directory("logs", folder) as logs:
            for name in filter(lambda name: matches(LOG_FILE, name), os.listdir(logs)):
                try:
                    if not file_stat(logs, name):
                        continue
                    with regular_file(logs, name) as (stream, info):
                        if info.st_size > MAX_LOG_BYTES:
                            raise ActivityError(413, "A runtime log exceeds the display size limit.")
                        while line := stream.readline(MAX_LOG_BYTES + 1):
                            if len(line) > MAX_LOG_BYTES:
                                raise ActivityError(413, "A runtime log record exceeds the display size limit.")
                            text = line.decode("utf-8", errors="replace")
                            tag = LOG_SESSION.match(text)
                            if tag and tag[1] == ref:
                                lines.setdefault(text, None)
                except FileNotFoundError:
                    # Rotation can rename a file while it is being read.
                    continue
    except FileNotFoundError:
        pass
    return "".join(sorted(lines))


def delegated_logs(home, profiles, owner, ref):
    # A delegate may use a different campaign profile while persisting its
    # transcript in the parent's store. Match only its exact tag in either log.
    lines = set()
    for profile in profiles:
        try:
            with profile_directory(home, profile) as folder:
                clean = redactor(home, folder)
                lines.update(clean(session_log(folder, ref)).splitlines(keepends=True))
        except FileNotFoundError:
            if profile == owner:
                raise
    return "".join(sorted(lines))


def log_page(text, offset):
    result, next_offset = page(text, offset, LOG_PAGE_SIZE)
    return {"text": result, "nextOffset": next_offset}


def tool_calls(value, clean):
    try:
        calls = json.loads(value or "[]")
    except (TypeError, ValueError, RecursionError):
        return []
    result = []
    for call in calls if isinstance(calls, list) else []:
        function = call.get("function") if isinstance(call, dict) else None
        if isinstance(function, dict):
            name = function.get("name")
            arguments = function.get("arguments")
            if isinstance(name, str):
                if not isinstance(arguments, str):
                    arguments = json.dumps(arguments, ensure_ascii=False) if isinstance(arguments, (dict, list)) else ""
                result.append({"name": clean(name)[:200], "arguments": clean(arguments)})
    return result


def message_fields(db):
    fields = columns(db, "messages")
    visible = "AND COALESCE(display_kind, '') != 'hidden'" if "display_kind" in fields else ""
    if "_compressed_summary" in fields:
        visible += " AND COALESCE(_compressed_summary, 0) = 0"
    optional = [name if name in fields else "NULL AS " + name for name in ("tool_calls", "tool_name")]
    # Provider reasoning, system prompts, and hidden steering envelopes stay in the runtime.
    return f"""SELECT id, role, content, timestamp, {', '.join(optional)} FROM messages
        WHERE session_id = ? AND role IN ('user', 'assistant', 'tool') {visible}"""


def message_content(row, clean, chat_suffix):
    text = row["content"] if isinstance(row["content"], str) else ""
    if chat_suffix and row["role"] == "user":
        text = text.removesuffix(chat_suffix)
    return clean(text), tool_calls(row["tool_calls"], clean)


def transcript(db, ref, offset, clean, chat_suffix):
    rows = db.execute(message_fields(db) + " ORDER BY id LIMIT ? OFFSET ?", (ref, MESSAGE_SIZE + 1, offset)).fetchall()
    visible, next_offset = page(rows, 0, MESSAGE_SIZE)
    messages = []
    for row in visible:
        text, calls = message_content(row, clean, chat_suffix)
        truncated = len(text) > 12_000 or len(calls) > 12 or any(len(call["arguments"]) > 4_000 for call in calls)
        messages.append({"id": row["id"], "role": row["role"], "at": timestamp(row["timestamp"]),
                         "text": text[:12_000], "truncated": truncated, "tool": clean(str(row["tool_name"] or ""))[:200],
                         "calls": [{**call, "arguments": call["arguments"][:4_000]} for call in calls[:12]]})
    return {"messages": messages, "nextOffset": offset + next_offset if next_offset else None}


def complete_message(db, ref, message_id, offset, clean, suffix):
    if type(message_id) is not int or not 0 < message_id <= 9_007_199_254_740_991:
        raise ValueError("Invalid message identity")
    row = db.execute(message_fields(db) + " AND id = ?", (ref, message_id)).fetchone()
    if row is None:
        raise ActivityError(404, "This message was not found in the session.")
    text, calls = message_content(row, clean, suffix)
    result = "\n\n".join(filter(None, [text, *(call["name"] + "\n" + call["arguments"] for call in calls)]))
    return log_page(result, offset)


def read_detail(home, profiles, prefix, legacy, board, board_workspaces, campaign_id, query):
    kind, profile, ref, offset = (query[key] for key in ("kind", "profile", "ref", "offset"))
    missing = ActivityError(404, "Activity was not found in this campaign.")
    try:
        if kind == "task-log" and board and profile == "" and matches(TASK_FILE, ref):
            with ExitStack() as handles, worker_folder(home, board) as folder:
                credential_dirs = [home]
                for agent in profiles:
                    if agent != "default":
                        try:
                            credential_dirs.append(handles.enter_context(profile_directory(home, agent)))
                        except FileNotFoundError:
                            continue
                return log_page(redactor(*credential_dirs)(read_text(folder, ref)), offset)
        if profile not in profiles:
            raise missing
        with profile_directory(home, profile) as folder:
            clean = redactor(home, folder)
            if kind == "profile-log" and profile != "default" and matches(LOG_FILE, ref):
                with directory("logs", folder) as logs:
                    return log_page(clean(read_text(logs, ref)), offset)
            if kind == "job-log" and profile != "default":
                job, _, filename = ref.partition("/")
                if matches(SLUG, job) and matches(CRON_FILE, filename):
                    with directory("cron", folder) as cron, directory("output", cron) as output, directory(job, output) as job_folder:
                        return log_page(clean(read_text(job_folder, filename)), offset)
            if kind == "session" and matches(SESSION_ID, ref):
                with database(folder) as db:
                    session = next(session_rows(db, profile, prefix, legacy, board_workspaces, ref), None)
                    if session is None:
                        raise missing
                    if query.get("view") != "log":
                        suffix = "\n\nCampaign ID: " + campaign_id if profile == "default" else ""
                        if query.get("view") == "message":
                            return complete_message(db, ref, query.get("message"), offset, clean, suffix)
                        return transcript(db, ref, offset, clean, suffix)
                text = delegated_logs(home, profiles, profile, ref) if session["category"] == "delegated" else clean(session_log(folder, ref))
                return log_page(text, offset)
    except (FileNotFoundError, NotADirectoryError):
        raise missing from None
    except (OSError, sqlite3.Error, RecursionError):
        raise ActivityError(503, "Couldn’t read this activity from the runtime.") from None
    raise missing


def read_activity(home, campaign_id, profiles, board, request, partial=False):
    if not isinstance(request, dict):
        raise ValueError("Invalid activity request")
    prefix, legacy = request.get("chatPrefix"), request.get("legacySessions")
    if not matches(CHAT_PREFIX, prefix) or not isinstance(legacy, list) or any(not matches(UUID, ref) for ref in legacy):
        raise ValueError("Invalid campaign chat scope")
    offset = request.get("offset", 0)
    if type(offset) is not int or not 0 <= offset <= 2_000_000_000:
        raise ValueError("Invalid activity offset")
    request = {**request, "offset": offset}
    workspaces = (str(home / "kanban" / "boards" / board / "workspaces") if board and board != "default" else
                  str(home / "kanban" / "workspaces") if board else None)
    with directory(home) as folder:
        if request.get("kind") in ("session", "job-log", "task-log", "profile-log"):
            if not isinstance(request.get("profile"), str) or not isinstance(request.get("ref"), str):
                raise ValueError("Invalid activity record")
            return read_detail(folder, profiles, prefix, legacy, board, workspaces, campaign_id, request)
        if request.get("kind") is not None or request.get("category") not in (None, *CATEGORIES):
            raise ValueError("Invalid activity category")
        return entry_page(folder, profiles, prefix, legacy, board, workspaces, request, partial)
