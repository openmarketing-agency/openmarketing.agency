"""Serve selected default-profile workspace records to the local OMA console.

The Unix socket is shared with the console. All paths and editable fields are
fixed by the service, and runtime configuration and credentials stay private.
"""

from base64 import b64encode
from contextlib import ExitStack, contextmanager
from hashlib import sha256
from http.server import BaseHTTPRequestHandler
from io import StringIO
from itertools import chain
import json
import os
from pathlib import Path
import re
from secrets import token_hex
from signal import SIGKILL
from socketserver import ThreadingUnixStreamServer
from threading import Lock
import stat
import subprocess
from urllib.parse import urlsplit

from markdown_it import MarkdownIt

from hermes_yaml import YAMLError, roundtrip_yaml, safe_load
from ruamel.yaml.scalarstring import LiteralScalarString


COLLECTIONS = ("brands", "playbooks", "campaigns", "agents")
SINGLETONS = {"brands": "brand", "playbooks": "playbook"}
EDITABLE = {"brands": ("name", "description", "knowledge_base"), "playbooks": ("strategy",)}
SLUG = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+|__[a-z0-9]+)*")
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
MAX_FILE_SIZE = 256 * 1024
MODEL_KEY = "LITELLM_API_KEY"
COMPOSIO_KEY = "COMPOSIO_API_KEY"
RUNTIME_ENV = ("PATH", "HOME", "USER", "LOGNAME", "HERMES_HOME", "HERMES_DIR", "PYTHONPATH", "LANG",
               "LC_ALL", "XDG_RUNTIME_DIR", "VIRTUAL_ENV")


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


def read_file(directory, name="config.yaml"):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(name, flags, dir_fd=directory), "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_SIZE or (name != "config.yaml" and info.st_nlink != 1):
            raise WorkspaceError(422, "This workspace file is unsupported.")
        source = file.read(MAX_FILE_SIZE + 1)
        if len(source) > MAX_FILE_SIZE:
            raise WorkspaceError(422, "This workspace file is too large.")
        return source, stat.S_IMODE(info.st_mode)


def relative_path(value):
    if not isinstance(value, str) or len(value) > 512:
        return None
    parts = value.split("/")
    if len(parts) > 16 or any(
        not part or part.startswith(".") or re.search(r"[\\:#?%\x00-\x1f\x7f]", part)
        for part in parts
    ):
        return None
    return parts


def markdown_path(value):
    return relative_path(value) if isinstance(value, str) and value.endswith(".md") else None


@contextmanager
def open_relative_file(directory, parts):
    if parts is None:
        raise WorkspaceError(422, "The workspace file has an invalid path.")
    # Open every component relative to the record, with symlinks disabled.
    with ExitStack() as handles:
        for part in parts[:-1]:
            directory = handles.enter_context(open_directory(part, directory))
        yield directory, parts[-1]


def read_markdown(directory, reference):
    with open_relative_file(directory, markdown_path(reference)) as (parent, name):
        content, mode = read_file(parent, name)
        return content.decode("utf-8"), content, mode


def knowledge_revision(config, content):
    return sha256(config + b"\0" + content).hexdigest()


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


def objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def http_url(value):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\s\\]", value):
        return ""
    try:
        url = urlsplit(value)
        return value if url.scheme in ("https", "http") and url.hostname and url.username is None else ""
    except ValueError:
        return ""


# Markdown files are authored by the agent. Disable raw HTML and embedded images
# and allow only credential-free HTTP links before rendering anything in the console.
workspace_markdown = MarkdownIt("commonmark", {"html": False, "maxNesting": 24}).enable("table").disable("image")
workspace_markdown.validateLink = lambda value: bool(http_url(value))


def render_markdown(text, page_title=""):
    if not text.strip():
        return ""
    env = {}
    tokens = workspace_markdown.parse(text, env)
    if page_title and len(tokens) >= 3 and tokens[0].tag == "h1" and tokens[1].content.strip() == page_title:
        tokens = tokens[3:]
    for token in tokens:
        if token.type in ("heading_open", "heading_close"):
            # A saved document sits below the console page and its section heading.
            token.tag = "h" + str(min(6, 2 + int(token.tag[1:])))
    return workspace_markdown.renderer.render(tokens, workspace_markdown.options, env)


def discovery(label, value):
    data = mapping(value)
    if data.get("status") not in ("not_checked", "not_found", "verified") or not label:
        return None
    return {
        "label": label, "status": data["status"],
        "url": http_url(data.get("url")), "feedUrl": http_url(data.get("feed_url")),
        "signupUrl": http_url(data.get("signup_url")),
    }


def nested_brand_documents(directory):
    remaining = 1024

    def walk(parent, prefix, depth):
        nonlocal remaining
        if remaining <= 0:
            return
        try:
            with open_directory(prefix[-1], parent) as current:
                for name in sorted(os.listdir(current))[:256]:
                    if remaining <= 0:
                        return
                    remaining -= 1
                    if not relative_path(name):
                        continue
                    parts = [*prefix, name]
                    try:
                        mode = os.stat(name, dir_fd=current, follow_symlinks=False).st_mode
                    except OSError:
                        continue
                    if stat.S_ISDIR(mode) and depth < 5:
                        yield from walk(current, parts, depth + 1)
                    elif stat.S_ISREG(mode) and name.endswith(".md"):
                        yield (name.removesuffix(".md"), "/".join(parts))
        except OSError:
            return

    for folder in ("docs", "research", "design"):
        yield from walk(directory, [folder], 0)


def brand_documents(data, directory):
    research = mapping(data.get("research"))
    candidates = [
        ("Design guidelines", mapping(data.get("design_system")).get("guidelines")),
        ("Market report", research.get("market_report")),
        ("Competitor report", research.get("competitor_report")),
        ("Internal documentation", mapping(mapping(data.get("documentation")).get("internal_reference")).get("index")),
    ]
    candidates.extend(
        (string(item.get("name")) + " research", item.get("report"))
        for item in objects(research.get("competitors")) if string(item.get("name"))
    )
    candidates.extend(
        (string(item.get("id")) + " repository notes", item.get("internal_docs"))
        for item in objects(data.get("repositories")) if string(item.get("id"))
    )
    candidates.extend(
        (provider.replace("_", " ") + " evidence", evidence.partition("#")[0])
        for provider, value in mapping(data.get("integrations")).items()
        if isinstance(provider, str) and (evidence := string(mapping(value).get("evidence")))
    )
    documents = []
    seen = set()
    for title, reference in chain(candidates, nested_brand_documents(directory)):
        if markdown_path(reference) and reference not in seen:
            documents.append({
                "id": sha256(reference.encode()).hexdigest()[:16], "title": title, "path": reference,
            })
            seen.add(reference)
            if len(documents) == 64:
                break
    return documents


def brand_metadata(data, directory):
    channels = mapping(data.get("channels"))
    design = mapping(data.get("design_system"))
    research = mapping(data.get("research"))
    presence = [
        discovery("Website", data.get("website")),
        discovery("Blog", channels.get("blog")),
        discovery("Newsletter", channels.get("newsletter")),
        discovery("Public documentation", mapping(data.get("documentation")).get("public")),
        *(discovery(string(item.get("platform")), item) for item in objects(channels.get("social"))),
    ]
    launches = [discovery(string(item.get("platform")), item) for item in objects(data.get("launches"))]
    signals = []
    for provider, value in mapping(data.get("integrations")).items():
        signal = mapping(value)
        if isinstance(provider, str) and signal.get("status") in ("observed", "not_checked", "not_detected"):
            signals.append({"label": provider, "status": signal["status"], "signal": string(signal.get("signal"))})
    repositories = []
    for item in objects(data.get("repositories")):
        url, label = http_url(item.get("url")), string(item.get("id"))
        if url and label:
            commit = string(item.get("analyzed_commit"))
            repositories.append({
                "label": label, "url": url,
                "commit": commit if re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", commit) else "",
            })
    competitors = [
        {"label": item["name"], "url": http_url(item.get("website")),
         "sources": list(filter(None, map(http_url, strings(item.get("sources")))))}
        for item in objects(research.get("competitors")) if string(item.get("name"))
    ]
    return {
        "channels": [item for item in presence if item],
        "launches": [item for item in launches if item],
        "signals": signals, "repositories": repositories, "competitors": competitors,
        "designSource": http_url(design.get("source_url")),
        "documents": brand_documents(data, directory),
    }


def brand_knowledge(data, source, directory):
    if "knowledge_base_file" not in data:
        text = string(data.get("knowledge_base"))
        return {"knowledge": text, "knowledgeHtml": render_markdown(text)}
    reference = data["knowledge_base_file"]
    result = {"knowledge": "", "knowledgeFile": reference if markdown_path(reference) else ""}
    try:
        text, content, _ = read_markdown(directory, reference)
    except (OSError, UnicodeError, WorkspaceError):
        return result
    return {
        **result, "knowledge": text, "knowledgeHtml": render_markdown(text),
        "knowledgeRevision": knowledge_revision(source, content),
    }


def model_name(value):
    return string(value) or string(mapping(value).get("default"))


def project(collection, source, directory, record_id=None):
    data = parse_record(source, record_id)
    record_id = data["id"]
    record = {
        "id": record_id, "name": string(data.get("name"), record_id) or record_id,
        "description": string(data.get("description")),
    }
    if collection == "brands":
        return {
            **record, "revision": sha256(source).hexdigest(), **brand_knowledge(data, source, directory),
            **brand_metadata(data, directory),
            "palette": string_map(data.get("palette")), "logos": string_map(data.get("logos")),
            "assets": {key: strings(data.get(key)) for key in ("fonts", "illustrations", "icons", "backgrounds", "images")},
        }
    if collection == "playbooks":
        strategy = string(data.get("strategy"))
        return {
            **record, "revision": sha256(source).hexdigest(),
            "brandId": string(data.get("brand_id")), "strategy": strategy, "strategyHtml": render_markdown(strategy),
        }
    if collection == "campaigns":
        return {
            **record, "configuration": campaign_configuration(source), "playbookId": string(data.get("playbook")), "version": string(data.get("version")),
            "orchestrator": string(data.get("orchestrator")), "agentIds": strings(data.get("agents")),
            "goals": strings(data.get("goals")), "plans": strings(data.get("plans")),
            "board": string(data.get("kanban_board_name")) or string(data.get("kanban_board")),
            "installationState": string(data.get("installation_state")), "model": model_name(data.get("model")),
        }
    jobs = data.get("jobs")
    return {
        **record, "campaignId": string(data.get("campaign_id")),
        "toolsets": strings(mapping(data.get("agent")).get("enabled_toolsets")),
        "skills": strings(data.get("oma_skills")),
        "model": model_name(mapping(data.get("effective")).get("model")) or model_name(data.get("model")),
        "jobs": [
            {
                "name": string(job.get("name")) or string(job.get("id")), "schedule": string(job.get("schedule")),
                **({"timezone": job["timezone"]} if string(job.get("timezone")) else {}),
                **({"repeat": job["repeat"]} if type(job.get("repeat")) is int and job["repeat"] > 0 else {}),
            }
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
                        singletons[collection] = project(collection, source, record)
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
                                result[collection].append(project(collection, source, record, record_id))
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
            if collection not in SINGLETONS:
                raise FileNotFoundError
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


def replace_file(directory, name, mode, content, still_current):
    temp = ".workspace-" + token_hex(12) + ".tmp"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(content)
            file.flush()
            os.fchmod(file.fileno(), mode & 0o666)
            os.fsync(file.fileno())
        if not still_current():
            raise WorkspaceError(409, "This record changed while you were editing. Reopen it and try again.")
        os.replace(temp, name, src_dir_fd=directory, dst_dir_fd=directory)
    finally:
        try:
            os.unlink(temp, dir_fd=directory)
        except FileNotFoundError:
            pass


def validate_edit(request, fields):
    if not isinstance(request, dict) or set(request) != {"revision", *fields}:
        raise WorkspaceError(422, "Some workspace fields are missing or invalid.")
    for field in fields:
        value = request[field]
        limit = 120 if field == "name" else 4_000 if field == "description" else 48_000
        if not isinstance(value, str) or len(value) > limit or "\0" in value or (field == "name" and not value.strip()):
            raise WorkspaceError(422, "Some workspace fields are missing or invalid.")


@contextmanager
def editable_record(root, collection, record_id):
    if collection not in {*EDITABLE, "campaigns"} or not valid_id(record_id):
        raise WorkspaceError(404, "This workspace record was not found.")
    try:
        with open_directory(root) as workspace, open_editable_record(workspace, collection, record_id) as entry:
            yield entry
    except (FileNotFoundError, NotADirectoryError):
        raise WorkspaceError(404, "This workspace record or file was not found.") from None
    except (UnicodeError, YAMLError, RecursionError):
        raise WorkspaceError(422, "This workspace record contains invalid text.") from None


def update_record(root, collection, record_id, request):
    if collection not in EDITABLE:
        raise WorkspaceError(404, "This workspace record was not found.")
    with editable_record(root, collection, record_id) as (record, source, mode):
        data = parse_record(source)
        fields = ("name", "description") if collection == "brands" and "knowledge_base_file" in data else EDITABLE[collection]
        validate_edit(request, fields)
        if request["revision"] != sha256(source).hexdigest():
            raise WorkspaceError(409, "This record changed while you were editing. Reopen it and try again.")
        yaml = roundtrip_yaml()
        document = yaml.load(source)
        for field in fields:
            value = request[field]
            document[field] = LiteralScalarString(value) if "\n" in value else value
        text = StringIO()
        yaml.dump(document, text)
        replace_file(record, "config.yaml", mode, text.getvalue().encode(), lambda: read_file(record)[0] == source)


def update_knowledge(root, record_id, request):
    validate_edit(request, ("knowledge_base",))
    with editable_record(root, "brands", record_id) as (record, source, _):
        reference = parse_record(source).get("knowledge_base_file")
        with open_relative_file(record, markdown_path(reference)) as (parent, name):
            content, mode = read_file(parent, name)
            if request["revision"] != knowledge_revision(source, content):
                raise WorkspaceError(409, "This record changed while you were editing. Reopen it and try again.")

            def still_current():
                if read_file(record)[0] != source:
                    return False
                with open_relative_file(record, markdown_path(reference)) as (current, current_name):
                    before, after = os.fstat(parent), os.fstat(current)
                    return (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino) and read_file(current, current_name)[0] == content

            replace_file(parent, name, mode, request["knowledge_base"].encode(), still_current)


def configuration_url(value):
    valid = http_url(value)
    if not valid:
        return ""
    parsed = urlsplit(valid)
    if parsed.scheme != "https" or parsed.query or parsed.fragment:
        return ""
    return valid


def composio_url(value):
    valid = configuration_url(value)
    return valid if re.fullmatch(
        r"https://backend\.composio\.dev/tool_router/(?:v3/)?[A-Za-z0-9_-]+/mcp/?", valid
    ) else ""


def campaign_configuration(source):
    data = parse_record(source)
    model = mapping(data.get("model"))
    server = mapping(mapping(data.get("mcp_servers")).get("composio"))
    return {
        "revision": sha256(source).hexdigest(),
        "provider": string(model.get("provider")),
        "modelId": model_name(data.get("model")),
        "baseUrl": configuration_url(model.get("base_url")),
        "hasModelKey": bool(model.get("api_key")),
        "composioUrl": composio_url(server.get("url")),
    }


def validate_campaign_settings(update):
    fields = {"revision", "provider", "modelId", "baseUrl", "composioUrl", "setModelKey"}
    if (
        not isinstance(update, dict) or set(update) != fields or type(update["setModelKey"]) is not bool
        or any(not isinstance(update[key], str) for key in fields - {"setModelKey"})
        or len(update["modelId"]) > 200 or re.search(r"[\s$]", update["modelId"])
        or not re.fullmatch(r"[A-Za-z0-9_.-]{0,80}", update["provider"])
        or (update["baseUrl"] and not configuration_url(update["baseUrl"]))
        or (update["composioUrl"] and not composio_url(update["composioUrl"]))
        or (any(update[key] for key in ("provider", "baseUrl", "setModelKey")) and not update["modelId"])
        or (update["setModelKey"] and not update["baseUrl"])
    ):
        raise WorkspaceError(422, "Check the campaign model and Composio URL fields.")


def update_campaign_configuration(root, campaign_id, update):
    validate_campaign_settings(update)
    if update["provider"] == "litellm-proxy":
        # Hermes calls an OpenAI-compatible proxy without a registered provider name "custom".
        update = {**update, "provider": "custom"}
    with editable_record(root, "campaigns", campaign_id) as (record, source, mode):
        current = campaign_configuration(source)
        if update["revision"] != current["revision"]:
            raise WorkspaceError(409, "This campaign changed. Reload its settings and try again.")
        yaml = roundtrip_yaml()
        document = yaml.load(source)
        fields = {"provider": "provider", "modelId": "default", "baseUrl": "base_url"}
        if update["setModelKey"] or any(update[key] != current[key] for key in fields):
            if not update["modelId"]:
                document.pop("model", None)
            else:
                model = mapping(document.get("model"))
                if update["baseUrl"] != current["baseUrl"] and current["hasModelKey"] and not update["setModelKey"]:
                    raise WorkspaceError(422, "Enter a model API key when changing the URL of an authenticated model.")
                for key, yaml_key in fields.items():
                    if update[key]:
                        model[yaml_key] = update[key]
                    else:
                        model.pop(yaml_key, None)
                if update["setModelKey"]:
                    model["api_key"] = "${" + MODEL_KEY + "}"
                document["model"] = model
        servers = mapping(document.get("mcp_servers"))
        if update["composioUrl"]:
            server = mapping(servers.get("composio"))
            headers = mapping(server.get("headers"))
            for header in list(headers):
                if isinstance(header, str) and header.lower() == "x-api-key" and header != "x-api-key":
                    del headers[header]
            headers["x-api-key"] = "${" + COMPOSIO_KEY + "}"
            server.update(url=update["composioUrl"], headers=headers)
            servers["composio"] = server
            document["mcp_servers"] = servers
        elif current["composioUrl"]:
            del servers["composio"]
            document["mcp_servers"] = servers
        if document == parse_record(source):
            return current
        text = StringIO()
        yaml.dump(document, text)
        updated = text.getvalue().encode()
        replace_file(record, "config.yaml", mode, updated, lambda: read_file(record)[0] == source)
        return campaign_configuration(updated)


def valid_sync_key(value):
    return (isinstance(value, str) and 0 < len(value) <= 4096 and bool(value.strip())
            and value.isascii() and all(32 <= ord(char) <= 126 for char in value))


def sync_campaign_configuration(root, campaign_id, request):
    if not isinstance(request, dict) or set(request) != {"revision", "env"} or not isinstance(request["env"], dict):
        raise WorkspaceError(422, "Invalid campaign sync request.")
    env = request["env"]
    if not set(env) <= {MODEL_KEY, COMPOSIO_KEY} or not all(valid_sync_key(value) for value in env.values()):
        raise WorkspaceError(422, "Invalid campaign API keys.")
    with editable_record(root, "campaigns", campaign_id) as (record, source, _):
        if request["revision"] != sha256(source).hexdigest():
            raise WorkspaceError(409, "This campaign changed before sync. Reload its settings and try again.")
        data = parse_record(source, campaign_id)
        model = mapping(data.get("model"))
        server = mapping(mapping(data.get("mcp_servers")).get("composio"))
        if MODEL_KEY in env and not (
            model.get("api_key") == "${" + MODEL_KEY + "}" and configuration_url(model.get("base_url"))
        ):
            raise WorkspaceError(422, "Save a model URL with the API key before syncing.")
        if COMPOSIO_KEY in env and not (
            composio_url(server.get("url")) and mapping(server.get("headers")).get("x-api-key") == "${" + COMPOSIO_KEY + "}"
        ):
            raise WorkspaceError(422, "Save a Composio MCP URL before syncing its API key.")
        try:
            # Kill the launcher and its worker together before releasing the edit lock on timeout.
            with subprocess.Popen(
                ["sync-campaign", campaign_id], cwd=root.parent, start_new_session=True,
                env={**{name: os.environ[name] for name in RUNTIME_ENV if name in os.environ}, **env},
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            ) as runner:
                try:
                    status = runner.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    os.killpg(runner.pid, SIGKILL)
                    raise
                if status:
                    raise subprocess.CalledProcessError(status, "sync-campaign")
        except (OSError, subprocess.SubprocessError):
            raise WorkspaceError(502, "oma-agent could not sync the campaign. Verify that the campaign is installed and try again.") from None
        return campaign_configuration(read_file(record)[0])


def brand_document(root, record_id, document_id):
    with editable_record(root, "brands", record_id) as (record, source, _):
        document = next((item for item in brand_documents(parse_record(source), record) if item["id"] == document_id), None)
        if document is None:
            raise WorkspaceError(404, "This brand document was not found.")
        content = read_markdown(record, document["path"])[0]
        return {**document, "content": content, "html": render_markdown(content)}


def brand_logo(root, record_id, logo_id):
    with editable_record(root, "brands", record_id) as (record, source, _):
        reference = string_map(parse_record(source).get("logos")).get(logo_id)
        parts = relative_path(reference)
        if not parts or parts[0] != "logos":
            raise WorkspaceError(404, "This brand logo was not found.")
        with open_relative_file(record, parts) as (parent, name):
            content, _ = read_file(parent, name)
        if content.startswith(bytes.fromhex("89504e470d0a1a0a")):
            media = "image/png"
        elif content.startswith(bytes.fromhex("ffd8ff")):
            media = "image/jpeg"
        elif content.startswith((b"GIF87a", b"GIF89a")):
            media = "image/gif"
        elif content.startswith(b"RIFF") and content[8:12] == b"WEBP":
            media = "image/webp"
        else:
            raise WorkspaceError(422, "This brand logo does not have a supported preview format.")
        return {"mediaType": media, "content": b64encode(content).decode("ascii")}


def agent_profile(root, record_id):
    if not valid_id(record_id):
        raise WorkspaceError(404, "This agent profile was not found.")
    try:
        with open_directory(root) as workspace, open_directory("agents", workspace) as agents, open_directory(record_id, agents) as agent:
            data = parse_record(read_file(agent)[0], record_id)
            content = read_markdown(agent, "SOUL.md")[0]
            return {"content": content, "html": render_markdown(content, string(data.get("name")))}
    except (FileNotFoundError, NotADirectoryError):
        raise WorkspaceError(404, "This agent profile was not found.") from None
    except UnicodeError:
        raise WorkspaceError(422, "This agent profile contains invalid text.") from None


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
        document = re.fullmatch(r"/workspace/brands/([^/]+)/documents/([a-f0-9]{16})", self.path)
        logo = re.fullmatch(r"/workspace/brands/([^/]+)/logos/([A-Za-z0-9_-]{1,64})", self.path)
        profile = re.fullmatch(r"/workspace/agents/([^/]+)/profile", self.path)
        try:
            if self.path == "/workspace":
                result = records(self.server.root)
            elif document:
                result = brand_document(self.server.root, *document.groups())
            elif logo:
                result = brand_logo(self.server.root, *logo.groups())
            elif profile:
                result = agent_profile(self.server.root, profile[1])
            else:
                self.reply(404, {"message": "Unknown workspace request."})
                return
        except WorkspaceError as error:
            self.reply(error.status, {"message": str(error)})
            return
        except OSError:
            self.reply(503, {"message": "Could not read the agent workspace."})
            return
        self.reply(200, result)

    def read_update(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_FILE_SIZE:
            raise WorkspaceError(413, "The workspace update is too large.")
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        path = re.fullmatch(r"/workspace/campaigns/([^/]+)/sync", self.path)
        if not path:
            self.reply(404, {"message": "Unknown workspace request."})
            return
        try:
            request = self.read_update()
            with self.server.edit_lock:
                result = sync_campaign_configuration(self.server.root, path[1], request)
        except (ValueError, RecursionError):
            self.reply(400, {"message": "Invalid campaign sync request."})
        except WorkspaceError as error:
            self.reply(error.status, {"message": str(error)})
        except OSError:
            self.reply(503, {"message": "Could not read the agent workspace."})
        else:
            self.reply(200, result)

    def do_PUT(self):
        path = re.fullmatch(r"/workspace/([^/]+)/([^/]+)(/knowledge|/config)?", self.path)
        if not path or (path[3] == "/knowledge" and path[1] != "brands") or (
            (path[1] == "campaigns") != (path[3] == "/config")
        ):
            self.reply(404, {"message": "Unknown workspace request."})
            return
        try:
            request = self.read_update()
            result = {}
            with self.server.edit_lock:
                if path[1] == "campaigns":
                    result = update_campaign_configuration(self.server.root, path[2], request)
                elif path[3]:
                    update_knowledge(self.server.root, path[2], request)
                else:
                    update_record(self.server.root, path[1], path[2], request)
        except (ValueError, RecursionError):
            self.reply(400, {"message": "Invalid workspace update."})
        except WorkspaceError as error:
            self.reply(error.status, {"message": str(error)})
        except OSError:
            self.reply(503, {"message": "Could not save the agent workspace record."})
        else:
            self.reply(200, result)


if __name__ == "__main__":
    socket_path = Path(os.environ.get("OMA_WORKSPACE_SOCKET", "/run/oma-console/workspace.sock"))
    socket_path.unlink(missing_ok=True)
    os.umask(0o077)
    with ThreadingUnixStreamServer(str(socket_path), WorkspaceHandler) as server:
        server.edit_lock = Lock()
        server.root = Path(os.environ["HERMES_HOME"]) / "oma"
        socket_path.chmod(0o660)
        server.serve_forever()
