import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const updater = fileURLToPath(new URL("../../.github/scripts/update-r2-version-index.py", import.meta.url));

test("R2 catalog publication preserves versions and retries conditional conflicts", () => {
  const work = mkdtempSync(join(tmpdir(), "oma-r2-index-"));
  try {
    const fixture = join(work, "check.py");
    writeFileSync(fixture, `
import json
import runpy
import sys
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

mod = runpy.run_path(sys.argv[1])
update = mod['update']
state = None
attempts = []

def fake(endpoint, operation, *args):
    global state
    assert endpoint == 'https://fixture.r2.cloudflarestorage.com'
    assert args[:4] == ('--bucket', 'oma-fixture', '--key', 'versions/index.json')
    if operation == 'get-object':
        if state is None:
            return CompletedProcess([], 1, '', '(NoSuchKey)')
        Path(args[-1]).write_text(json.dumps({'versions': state}))
        return CompletedProcess([], 0, json.dumps({'ETag': '"current"'}), '')
    assert operation == 'put-object' and args[-2:] == ('--cache-control', 'no-cache')
    next_versions = json.loads(Path(args[args.index('--body') + 1]).read_text())['versions']
    attempts.append(next_versions)
    if state is None:
        assert args[6:8] == ('--if-none-match', '*')
        state = ['0.9.0', '0.1.0']
        return CompletedProcess([], 1, '', '(PreconditionFailed)')
    assert args[6:8] == ('--if-match', '"current"')
    state = next_versions
    return CompletedProcess([], 0, '{}', '')

with patch.dict(update.__globals__, aws=fake), patch.object(mod['time'], 'sleep'):
    for _ in range(2):
        update('oma-fixture', 'https://fixture.r2.cloudflarestorage.com', 'versions/index.json', '0.10.0')
    assert attempts == [['0.10.0'], ['0.10.0', '0.9.0', '0.1.0']], attempts
    state = ['bad-version']
    try:
        update('oma-fixture', 'https://fixture.r2.cloudflarestorage.com', 'versions/index.json', '0.11.0')
    except SystemExit as exc:
        assert 'refusing to overwrite' in str(exc)
    else:
        raise AssertionError('malformed index accepted')
    assert len(attempts) == 2
`);
    const result = Bun.spawnSync(["python3", fixture, updater]);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("already lists 0.10.0");
  } finally { rmSync(work, { recursive: true, force: true }); }
});
