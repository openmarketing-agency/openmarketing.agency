"""Serve selected default-profile workspace records to the local OMA console.

The Unix socket is shared with the console. All paths and editable fields are
fixed by the service, and runtime configuration and credentials stay private.
"""

from contextlib import ExitStack, contextmanager
from hashlib import sha256
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
from secrets import token_hex
from socketserver import UnixStreamServer
import stat

from hermes_yaml import YAMLError, roundtrip_yaml, safe_load
from ruamel.yaml.scalarstring import LiteralScalarString


COLLECTIONS = ("brands", "playbooks", "campaigns", "agents")
SINGLETONS = {"brands": "brand", "playbooks": "playbook"}
EDITABLE = {"brands": ("name", "description", "knowledge_base"), "playbooks": ("strategy",)}
SLUG = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*")
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
MAX_FILE_SIZE = 256 * 1024


class WorkspaceError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


@contextmanager
def open_directory(path, parent=None):
    fd = os.open(path, DIRECTORY, dir_fd=parent)
    try:
        yield fd
    finally:
        os.close(fd)


def read_file(directory):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open("config.yaml", flags, dir_fd=directory), "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_SIZE:
            raise WorkspaceError(422, "This workspace record is not a supported YAML file.")
        source = file.read(MAX_FILE_SIZE + 1)
        if len(source) > MAX_FILE_SIZE:
            raise WorkspaceError(422, "This workspace record is too large.")
        return source, stat.S_IMODE(info.st_mode)


def valid_id(record_id):
    return isinstance(record_id, str) and len(record_id) <= 64 and SLUG.fullmatch(record_id) is not None


def parse_record(source, record_id=None):
    try:
        data = safe_load(source)
    except (UnicodeError, YAMLError, RecursionError):
        raise WorkspaceError(422, "This workspace record contains invalid YAML.") from None
    if not isinstance(data, dict) or not valid_id(data.get("id")):
        raise WorkspaceError(422, "This workspace record has an invalid ID.")
    if record_id is not None and data["id"] != record_id:
        raise WorkspaceError(422, "The workspace record ID does not match its directory.")
    return data


def string(value, default=""):
    return value if isinstance(value, str) else default


def strings(value):
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def mapping(value):
    return value if isinstance(value, dict) else {}


def string_map(value):
    return {key: item for key, item in mapping(value).items() if isinstance(key, str) and isinstance(item, str)}


def project(collection, source, record_id=None):
    data = parse_record(source, record_id)
    record_id = data["id"]
    record = {
        "id": record_id, "name": string(data.get("name"), record_id) or record_id,
        "description": string(data.get("description")),
    }
    if collection == "brands":
        return {
            **record, "revision": sha256(source).hexdigest(), "knowledge": string(data.get("knowledge_base")),
            "palette": string_map(data.get("palette")), "logos": string_map(data.get("logos")),
            "assets": {key: strings(data.get(key)) for key in ("fonts", "illustrations", "icons", "backgrounds", "images")},
        }
    if collection == "playbooks":
        return {
            **record, "revision": sha256(source).hexdigest(),
            "brandId": string(data.get("brand_id")), "strategy": string(data.get("strategy")),
        }
    if collection == "campaigns":
        return {
            **record, "playbookId": string(data.get("playbook")), "version": string(data.get("version")),
            "orchestrator": string(data.get("orchestrator")), "agentIds": strings(data.get("agents")),
            "goals": strings(data.get("goals")), "plans": strings(data.get("plans")),
            "board": string(data.get("kanban_board_name")) or string(data.get("kanban_board")),
        }
    jobs = data.get("jobs")
    return {
        **record, "campaignId": string(data.get("campaign_id")),
        "toolsets": strings(mapping(data.get("agent")).get("enabled_toolsets")),
        "jobs": [
            {"name": string(job.get("name")) or string(job.get("id")), "schedule": string(job.get("schedule"))}
            for job in jobs if isinstance(job, dict)
        ] if isinstance(jobs, list) else [],
    }


def records(root):
    result = {collection: [] for collection in COLLECTIONS}
    singletons = {}
    skipped = 0
    try:
        with open_directory(root) as workspace:
            for collection, path in SINGLETONS.items():
                try:
                    with open_directory(path, workspace) as record:
                        source, _ = read_file(record)
                    singletons[collection] = project(collection, source)
                except FileNotFoundError:
                    continue
                except (OSError, WorkspaceError):
                    skipped += 1
            for collection in COLLECTIONS:
                try:
                    with open_directory(collection, workspace) as directory:
                        for record_id in sorted(os.listdir(directory)):
                            if not valid_id(record_id):
                                continue
                            try:
                                with open_directory(record_id, directory) as record:
                                    source, _ = read_file(record)
                                result[collection].append(project(collection, source, record_id))
                            except (OSError, WorkspaceError):
                                skipped += 1
                except FileNotFoundError:
                    continue
                except OSError:
                    skipped += 1
    except FileNotFoundError:
        pass
    # Current campaigns share one strategy and brand. Legacy records retain their explicit links.
    if playbook := singletons.get("playbooks"):
        playbook["brandId"] = singletons.get("brands", {}).get("id", "")
        for campaign in result["campaigns"]:
            if not campaign["playbookId"]:
                campaign["playbookId"] = playbook["id"]
    for collection, record in singletons.items():
        result[collection] = [record, *(item for item in result[collection] if item["id"] != record["id"])]
    return {**result, "skipped": skipped}


@contextmanager
def open_editable_record(workspace, collection, record_id):
    with ExitStack() as handles:
        try:
            record = handles.enter_context(open_directory(SINGLETONS[collection], workspace))
            source, mode = read_file(record)
            matches = parse_record(source)["id"] == record_id
        except (OSError, WorkspaceError):
            matches = False
        if not matches:
            directory = handles.enter_context(open_directory(collection, workspace))
            record = handles.enter_context(open_directory(record_id, directory))
            source, mode = read_file(record)
            parse_record(source, record_id)
        yield record, source, mode


def update_record(root, collection, record_id, request):
    fields = EDITABLE.get(collection)
    if not fields or not valid_id(record_id):
        raise WorkspaceError(404, "This workspace record was not found.")
    if not isinstance(request, dict) or set(request) != {"revision", *fields}:
        raise WorkspaceError(422, "Some workspace fields are missing or invalid.")
    for field in fields:
        value = request[field]
        limit = 120 if field == "name" else 4_000 if field == "description" else 48_000
        if not isinstance(value, str) or len(value) > limit or "\0" in value or (field == "name" and not value.strip()):
            raise WorkspaceError(422, "Some workspace fields are missing or invalid.")
    try:
        with open_directory(root) as workspace, open_editable_record(workspace, collection, record_id) as entry:
            record, source, mode = entry
            if request["revision"] != sha256(source).hexdigest():
                raise WorkspaceError(409, "This record changed while you were editing. Reopen it and try again.")
            yaml = roundtrip_yaml()
            data = yaml.load(source)
            for field in fields:
                value = request[field]
                data[field] = LiteralScalarString(value) if "\n" in value else value
            temp = ".config-" + token_hex(12) + ".tmp"
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=record)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    yaml.dump(data, file)
                    file.flush()
                    os.fchmod(file.fileno(), mode & 0o666)
                    os.fsync(file.fileno())
                if read_file(record)[0] != source:
                    raise WorkspaceError(409, "This record changed while you were editing. Reopen it and try again.")
                os.replace(temp, "config.yaml", src_dir_fd=record, dst_dir_fd=record)
            finally:
                try:
                    os.unlink(temp, dir_fd=record)
                except FileNotFoundError:
                    pass
    except (FileNotFoundError, NotADirectoryError):
        raise WorkspaceError(404, "This workspace record was not found.") from None
    except (UnicodeError, YAMLError, RecursionError):
        raise WorkspaceError(422, "This workspace record contains invalid YAML.") from None


class WorkspaceHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def log_message(self, *_args):
        # Requests can contain unpublished workspace data.
        pass

    def reply(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path != "/workspace":
            self.reply(404, {"message": "Unknown workspace request."})
            return
        try:
            result = records(self.server.root)
        except OSError:
            self.reply(503, {"message": "Could not read the agent workspace."})
            return
        self.reply(200, result)

    def do_PUT(self):
        path = re.fullmatch(r"/workspace/([^/]+)/([^/]+)", self.path)
        if not path:
            self.reply(404, {"message": "Unknown workspace request."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_FILE_SIZE:
                raise WorkspaceError(413, "The workspace update is too large.")
            request = json.loads(self.rfile.read(length))
            update_record(self.server.root, *path.groups(), request)
        except (ValueError, RecursionError):
            self.reply(400, {"message": "Invalid workspace update."})
        except WorkspaceError as error:
            self.reply(error.status, {"message": str(error)})
        except OSError:
            self.reply(503, {"message": "Could not save the agent workspace record."})
        else:
            self.reply(200, {})


if __name__ == "__main__":
    socket_path = Path(os.environ.get("OMA_WORKSPACE_SOCKET", "/run/oma-console/workspace.sock"))
    socket_path.unlink(missing_ok=True)
    os.umask(0o077)
    with UnixStreamServer(str(socket_path), WorkspaceHandler) as server:
        server.root = Path(os.environ["HERMES_HOME"]) / "oma"
        socket_path.chmod(0o660)
        server.serve_forever()
