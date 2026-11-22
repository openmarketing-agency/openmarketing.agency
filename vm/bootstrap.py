from copy import deepcopy
import hmac
import os
from pathlib import Path
from secrets import token_hex
import sys
from tempfile import TemporaryDirectory

from dotenv import dotenv_values, set_key
from hermes_cli.config import atomic_config_replace, require_readable_config_before_write
from hermes_constants import named_profile_is_live


def managed_path(root, *parts):
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"Refusing symlink in managed VM state: {path}")
    return path


def atomic_write(path, data, mode=0o600):
    with TemporaryDirectory(dir=path.parent) as staging:
        temporary = Path(staging) / path.name
        temporary.write_bytes(data)
        temporary.chmod(mode)
        temporary.replace(path)


def write_env(path, values):
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    current = dotenv_values(path, interpolate=False)
    for name, value in values.items():
        if current.get(name) != value:
            set_key(path, name, value)


def configure_camofox(root, url, key):
    maintenance = managed_path(root, "profiles", "maintenance")
    if not (url and key and named_profile_is_live(maintenance)):
        raise SystemExit("Camofox requires a URL, an API key, and an installed maintenance profile")
    paths = [managed_path(profile, ".env") for profile in (root, maintenance)]
    for path in paths:
        write_env(path, {"CAMOFOX_URL": url, "CAMOFOX_API_KEY": key})


def configure_model(path, provider, model, *, preserve_model=False, gateway=False, clarify_timeout=None):
    config = require_readable_config_before_write(path)
    previous = deepcopy(config)
    if not (preserve_model and "model" in config):
        config["model"] = model
    if provider:
        config.setdefault("providers", {})["oma-inference"] = provider
    if gateway:
        config.setdefault("gateway", {})["multiplex_profiles"] = True
        if clarify_timeout is not None:
            config.setdefault("agent", {})["clarify_timeout"] = clarify_timeout
            # Hermes gives the legacy key precedence over agent.clarify_timeout.
            legacy_clarify = config.get("clarify")
            if isinstance(legacy_clarify, dict):
                legacy_clarify.pop("timeout", None)
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


def bootstrap(root, model, provider, credentials, gateway_seed, *, clarify_timeout=None):
    if not gateway_seed:
        seed_dir = managed_path(root, ".oma")
        seed_dir.mkdir(mode=0o700, exist_ok=True)
        seed_path = managed_path(seed_dir, "gateway-seed")
        if not seed_path.exists():
            atomic_write(seed_path, token_hex(32).encode())
        gateway_seed = seed_path.read_text()

    def gateway_key(profile):
        return hmac.digest(gateway_seed.encode(), profile.encode(), "sha256").hex()


    configure_model(
        managed_path(root, "config.yaml"), provider, model, gateway=True, clarify_timeout=clarify_timeout,
        # Without a deployment credential, the model is only a first-boot default.
        preserve_model=not credentials or managed_path(root, "oma", "agents", "default", "config.yaml").is_file(),
    )
    write_env(managed_path(root, ".env"), {
        **credentials,
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_PORT": "8642",
        "API_SERVER_KEY": gateway_key("default"),
    })
    if os.environ.get("OMA_EXPORT_CONSOLE_GATEWAY_KEY") == "1":
        atomic_write(Path("/run/oma-console/gateway.key"), gateway_key("default").encode(), mode=0o640)
    dashboard = managed_path(root, ".oma-dashboard-token")
    atomic_write(dashboard, (gateway_key("dashboard") + "\n").encode())


if __name__ == "__main__":
    os.umask(0o077)
    home = Path(os.environ["HERMES_HOME"])
    if sys.argv[1:] == ["--configure-camofox"]:
        configure_camofox(home, os.environ.get("CAMOFOX_URL"), os.environ.get("CAMOFOX_API_KEY"))
        sys.exit(0)
    model_name = os.environ.get("OMA_HERMES_MODEL")
    timeout = os.environ.get("OMA_HERMES_CLARIFY_TIMEOUT", "").strip()
    try:
        clarify_timeout = int(timeout) if timeout else None
        if clarify_timeout is not None and clarify_timeout < 0:
            raise ValueError
    except ValueError:
        raise SystemExit("Set OMA_HERMES_CLARIFY_TIMEOUT to a non-negative number of seconds") from None
    openrouter_key = os.environ.pop("OPENROUTER_API_KEY", "")
    litellm_url = os.environ.pop("OMA_LITELLM_URL", "")
    litellm_key = os.environ.pop("OMA_LITELLM_KEY", "")
    if not openrouter_key and (litellm_url or litellm_key):
        if not (litellm_url and litellm_key):
            raise SystemExit("Set both OMA_LITELLM_URL and OMA_LITELLM_KEY when configuring LiteLLM")
        model = {"provider": "custom:oma-inference", "default": model_name or "oma-hermes"}
        provider = {"api": litellm_url, "key_env": "OMA_LITELLM_KEY", "transport": "chat_completions"}
        credentials = {"OMA_LITELLM_KEY": litellm_key}
    else:
        model = {"provider": "openrouter", "default": model_name or "openai/gpt-4.1-mini"}
        provider = None
        credentials = {"OPENROUTER_API_KEY": openrouter_key} if openrouter_key else {}
    bootstrap(
        home,
        model, provider, credentials,
        os.environ.pop("OMA_HERMES_GATEWAY_SEED", ""),
        clarify_timeout=clarify_timeout,
    )
