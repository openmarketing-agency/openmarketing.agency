"""Register console-managed campaign fields in the pinned agent's schema."""

import json
from pathlib import Path
import sys


if __name__ == "__main__":
    path = Path(sys.argv[1])
    schema = json.loads(path.read_text(encoding="utf-8"))
    properties = schema["properties"]
    if "tool_suggestions" not in properties:
        properties["tool_suggestions"] = {
            "description": "Legacy suggestion metadata retained for older campaign records.",
            "type": "array",
            "uniqueItems": True,
            "items": {"type": "string", "pattern": r"^[a-z0-9][a-z0-9_-]{0,127}(?![\s\S])"},
        }
    if "mode" not in properties:
        properties["mode"] = {"enum": ["approve", "control", "yolo"], "default": "approve"}
    path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
