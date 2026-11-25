#!/usr/bin/env python3
"""Add a published stable version to an R2 index without losing concurrent releases."""
import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")


def aws(endpoint, operation, *args):
    return subprocess.run(
        ["aws", "s3api", operation, "--endpoint-url", endpoint, "--output", "json", *args],
        capture_output=True, text=True, check=False,
        env={**os.environ, "AWS_PAGER": "", "AWS_REQUEST_CHECKSUM_CALCULATION": "when_required"},
    )


def update(bucket, endpoint, key, version):
    common = ("--bucket", bucket, "--key", key)
    with tempfile.TemporaryDirectory() as work:
        body = Path(work) / "index.json"
        for attempt in range(6):
            current = aws(endpoint, "get-object", *common, str(body))
            if current.returncode == 0:
                etag = json.loads(current.stdout).get("ETag")
                old = json.loads(body.read_text(encoding="utf-8"))
                versions = old.get("versions") if isinstance(old, dict) else None
                if not etag or not isinstance(versions, list) or not all(
                    isinstance(v, str) and VERSION.fullmatch(v) for v in versions
                ):
                    raise SystemExit(f"Invalid existing R2 index {key}; refusing to overwrite it.")
                condition = ("--if-match", etag)
            elif "(NoSuchKey)" in current.stderr or "(404)" in current.stderr:
                versions = []
                condition = ("--if-none-match", "*")
            else:
                raise SystemExit(current.stderr.strip() or f"Could not read R2 index {key}.")

            if version in versions:
                print(f"==> R2 index {key} already lists {version}", flush=True)
                return
            versions = sorted(set(versions) | {version}, key=lambda v: tuple(map(int, v.split("."))), reverse=True)
            body.write_text(json.dumps({"versions": versions}, separators=(",", ":")) + "\n", encoding="utf-8")
            written = aws(endpoint, "put-object", *common, "--body", str(body), *condition,
                          "--content-type", "application/json", "--cache-control", "no-cache")
            if written.returncode == 0:
                print(f"==> R2 index {key} now lists {version}", flush=True)
                return
            if not re.search(r"\((PreconditionFailed|ConditionalRequestConflict|OperationAborted|409|412)\)", written.stderr):
                raise SystemExit(written.stderr.strip() or f"Could not write R2 index {key}.")
            time.sleep(min(2 ** attempt, 8))
    raise SystemExit(f"Concurrent writes prevented updating R2 index {key}; rerun this job.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("key", choices=("versions/index.json", "oma-cli/versions/index.json"))
    parser.add_argument("version")
    args = parser.parse_args()
    if not VERSION.fullmatch(args.version):
        parser.error("version must be a bare X.Y.Z version")
    for name in ("R2_BUCKET", "R2_ACCOUNT_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        if not os.environ.get(name):
            parser.error(f"configure {name}")
    endpoint = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    update(os.environ["R2_BUCKET"], endpoint, args.key, args.version)
