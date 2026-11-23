"""Apply a reviewed standalone agent revision using oma-agent's native sync engine."""

import os
from pathlib import Path
import sys

from hermes_cli.oma_campaigns.sync import StaleRecord, sync_agent


def main():
    agent_id, revision, *key_names = sys.argv[1:]
    value = os.environ.pop("HERMES_MODEL_API_KEY", "")
    env = {key_names[0]: value} if key_names else None
    try:
        sync_agent(Path(os.environ["HERMES_HOME"]), agent_id, revision=revision, env=env)
        return 0
    except StaleRecord:
        return 3
    except FileNotFoundError:
        return 4
    except (OSError, ValueError, RuntimeError):
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
