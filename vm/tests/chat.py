import hmac
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

seed = Path("/opt/data/.oma/gateway-seed").read_bytes()
key = hmac.digest(seed, b"default", "sha256").hex()
payload = {
    "model": os.environ["OMA_HERMES_MODEL"],
    "messages": [{"role": "user", "content": "Reply with a brief greeting."}],
}
request = Request(
    "http://127.0.0.1:8642/v1/chat/completions",
    json.dumps(payload).encode(),
    {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
)
with urlopen(request, timeout=240) as response:
    reply = json.load(response)["choices"][0]["message"]["content"]
assert reply.strip(), "Hermes returned an empty reply"
print("Hermes returned an authenticated reply through OpenRouter")
