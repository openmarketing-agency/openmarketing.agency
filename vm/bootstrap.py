from copy import deepcopy
import hmac
import json
import os
from pathlib import Path
import re
from secrets import token_hex
from shutil import copytree
from tempfile import TemporaryDirectory

from dotenv import dotenv_values, set_key
from hermes_cli.config import atomic_config_replace, require_readable_config_before_write
from hermes_cli.profiles import create_profile


def managed_path(root, *parts):
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"Refusing symlink in managed VM state: {path}")
    return path


def read_registry(path):
    registry = json.loads(path.read_bytes())
    if registry.get("schemaVersion") != 1 or not isinstance(registry.get("playbooks"), list):
        raise ValueError("Invalid OMA installation registry")
    for playbook in registry["playbooks"]:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", playbook["id"]):
            raise ValueError("Invalid installed playbook ID")
        ids = [agent["id"] for agent in playbook["agents"]]
        if playbook["orchestrator"] not in ids or any(
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", name)
            or not name.startswith(playbook["id"] + "__") for name in ids
        ):
            raise ValueError("Invalid installed profile ID")
    return registry["playbooks"]


def atomic_write(path, data, mode=0o600):
    with TemporaryDirectory(dir=path.parent) as staging:
        temporary = Path(staging) / path.name
        temporary.write_bytes(data)
        temporary.chmod(mode)
        temporary.replace(path)


def seed_disk(root, seed):
    registry = managed_path(root, ".oma", "installed.json")
    if registry.exists():
        return registry

    bundled_registry = seed / ".oma" / "installed.json"
    bundled_bytes = bundled_registry.read_bytes()
    paths = []
    for playbook in read_registry(bundled_registry):
        paths.append((".oma", "setups", playbook["id"]))
        paths.extend(("profiles", agent["id"]) for agent in playbook["agents"])

    marker = managed_path(root, ".oma", ".vm-seed-in-progress")
    if marker.exists():
        if marker.read_bytes() != bundled_bytes:
            raise ValueError("Finish seeding the disk with the original image before updating")
    else:
        for parts in paths:
            if managed_path(root, *parts).exists():
                raise ValueError(f"Bundled profile or setup already exists: {'/'.join(parts)}")
        marker.parent.mkdir(mode=0o700, exist_ok=True)
        atomic_write(marker, bundled_bytes)

    # Publish complete directories individually and commit the registry last. A
    # restart can resume a partial seed without copying over completed profiles.
    with TemporaryDirectory(prefix=".vm-seed-", dir=marker.parent) as staging:
        temporary = Path(staging) / "payload"
        for parts in paths:
            target = managed_path(root, *parts)
            if target.is_dir():
                continue
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            copytree(seed.joinpath(*parts), temporary, symlinks=True)
            temporary.rename(target)
    marker.replace(registry)
    return registry


def write_env(path, values):
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    current = dotenv_values(path, interpolate=False)
    for name, value in values.items():
        if current.get(name) != value:
            set_key(path, name, value)


def configure_model(path, provider, model, *, gateway=False, toolsets=None):
    config = require_readable_config_before_write(path)
    previous = deepcopy(config)
    config["model"] = model
    if provider:
        config.setdefault("providers", {})["oma-inference"] = provider
    if toolsets is not None:
        config.setdefault("agent", {})["enabled_toolsets"] = toolsets
        config.setdefault("tools", {}).setdefault("tool_search", {})["enabled"] = False
    if gateway:
        config.setdefault("gateway", {})["multiplex_profiles"] = True
        selected = config.get("agent", {}).get("enabled_toolsets")
        if selected is None:
            selected = config.setdefault("platform_toolsets", {}).setdefault("api_server", ["hermes-api-server"])
        # OMA's Runs API uses clarify for conversational onboarding.
        eager = config.get("tools", {}).get("tool_search", {}).get("eager_toolsets")
        for toolsets in (selected, eager):
            if isinstance(toolsets, list) and "clarify" not in toolsets:
                toolsets.append("clarify")
    if config != previous:
        atomic_config_replace(path, config)


def bootstrap(root, seed, model, provider, credentials, gateway_seed):
    registry = seed_disk(root, seed)
    if not gateway_seed:
        seed_path = managed_path(root, ".oma", "gateway-seed")
        if not seed_path.exists():
            atomic_write(seed_path, token_hex(32).encode())
        gateway_seed = seed_path.read_text()

    def gateway_key(profile):
        return hmac.digest(gateway_seed.encode(), profile.encode(), "sha256").hex()

    soul = managed_path(root, "SOUL.md")
    if not soul.exists():
        atomic_write(soul, (seed / "SOUL.md").read_bytes())

    # Console-owned profiles only converse or return drafts. Catalog and existing
    # playbook profiles retain their own operational toolsets.
    console_profiles = {
        "oma-onboarding": (
            "You help people set up their Open Marketing Agency workspace. Learn about their brand and goals.",
            ["clarify", "no_mcp"],
        ),
        "oma-campaign-researcher": ("Research marketing questions from evidence and flag gaps.", ["no_mcp"]),
        "oma-campaign-strategist": ("Plan campaigns around the owner's goals, audience, and constraints.", ["no_mcp"]),
        "oma-campaign-creator": ("Develop campaign materials for owner review in the brand's voice.", ["no_mcp"]),
        "oma-campaign-reviewer": ("Review materials against the brief and flag unsupported claims.", ["no_mcp"]),
    }
    export_console_keys = os.environ.get("OMA_EXPORT_CONSOLE_GATEWAY_KEY") == "1"
    for name, (persona, toolsets) in console_profiles.items():
        profile = managed_path(root, "profiles", name)
        if not profile.exists():
            create_profile(name, no_alias=True, no_skills=True, seed_model=False, soul=persona)
        configure_model(managed_path(profile, "config.yaml"), provider, model, toolsets=toolsets)
        write_env(managed_path(profile, ".env"), {**credentials, "API_SERVER_KEY": gateway_key(name)})
        if export_console_keys:
            atomic_write(Path("/run/oma-console") / f"{name}.key", gateway_key(name).encode(), mode=0o640)

    for playbook in read_registry(registry):
        setup = managed_path(root, ".oma", "setups", playbook["id"])
        setup.mkdir(mode=0o700, parents=True, exist_ok=True)
        configure_model(managed_path(setup, "setup.yaml"), provider, model)
        write_env(managed_path(setup, ".env"), credentials)
        for agent in playbook["agents"]:
            if not agent["active"]:
                continue
            name = agent["id"]
            profile = managed_path(root, "profiles", name)
            if not profile.is_dir():
                raise ValueError(f"Missing managed profile: {name}")
            configure_model(managed_path(profile, "config.yaml"), provider, model)
            values = credentials
            if name == playbook["orchestrator"]:
                values = {**credentials, "API_SERVER_KEY": gateway_key(name)}
            write_env(managed_path(profile, ".env"), values)

    configure_model(managed_path(root, "config.yaml"), provider, model, gateway=True)
    write_env(managed_path(root, ".env"), {
        **credentials,
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_PORT": "8642",
        "API_SERVER_KEY": gateway_key("default"),
    })
    if export_console_keys:
        atomic_write(Path("/run/oma-console/gateway.key"), gateway_key("default").encode(), mode=0o640)
    dashboard = managed_path(root, ".oma-dashboard-token")
    atomic_write(dashboard, (gateway_key("dashboard") + "\n").encode())


if __name__ == "__main__":
    os.umask(0o077)
    model_name = os.environ.get("OMA_HERMES_MODEL")
    if openrouter_key := os.environ.pop("OPENROUTER_API_KEY", ""):
        model = {"provider": "openrouter", "default": model_name or "openai/gpt-4.1-mini"}
        provider = None
        credentials = {"OPENROUTER_API_KEY": openrouter_key}
    else:
        if not os.environ.get("OMA_LITELLM_URL") or not os.environ.get("OMA_LITELLM_KEY"):
            raise SystemExit("Set OPENROUTER_API_KEY or both OMA_LITELLM_URL and OMA_LITELLM_KEY")
        model = {"provider": "custom:oma-inference", "default": model_name or "oma-hermes"}
        provider = {"api": os.environ.pop("OMA_LITELLM_URL"), "key_env": "OMA_LITELLM_KEY", "transport": "chat_completions"}
        credentials = {"OMA_LITELLM_KEY": os.environ.pop("OMA_LITELLM_KEY")}
    bootstrap(
        Path(os.environ["HERMES_HOME"]), Path("/opt/oma/seed"),
        model, provider, credentials,
        os.environ.pop("OMA_HERMES_GATEWAY_SEED", ""),
    )
