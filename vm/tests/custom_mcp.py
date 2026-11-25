"""Exercise the real MCP handshake and the revision-bound campaign save gate."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Lock
from unittest.mock import patch
import unittest

import httpx2
from hermes_yaml import safe_load

sys.path.insert(0, "/opt/oma")
from workspace import WorkspaceError, records, update_campaign_custom_mcp
from custom_mcp import check_tools

URL = "https://tools.example.test/mcp"


class CustomMcpTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.record = self.root / "campaigns" / "oss-launch" / "config.yaml"
        self.record.parent.mkdir(parents=True)
        self.original = b"# Keep me\nid: oss-launch\nname: Launch\nintegrations: [hacker-news, github]\nmcp_servers:\n  other: {url: 'https://other.example.test/mcp'}\n"
        self.record.write_bytes(self.original)
        self.update = {"revision": sha256(self.original).hexdigest(), "integrationId": "hacker-news", "url": URL}
        self.methods = []
        self.addCleanup(patch.stopall)
        patch.dict("os.environ", {"OMA_CUSTOM_MCP_URLS": URL}).start()

    def campaign(self):
        return records(self.root)["campaigns"][0]

    def probe(self, url, *, healthy=True, content_type="application/json"):
        def respond(request):
            assert request.method == "POST"
            assert str(request.url) == URL
            body = json.loads(request.content)
            method = body["method"]
            self.methods.append(method)
            if method == "notifications/initialized":
                return httpx2.Response(202)
            if method == "initialize":
                result = {"protocolVersion": body["params"]["protocolVersion"],
                          "serverInfo": {"name": "fixture", "version": "1"}, "capabilities": {"tools": {}}}
            else:
                assert method == "tools/list"
                result = {"tools": [{"name": "read_story", "inputSchema": {"type": "object"}}] if healthy else []}
            envelope = {"jsonrpc": "2.0", "id": body["id"], "result": result}
            if content_type == "text/event-stream":
                return httpx2.Response(200, headers={"Content-Type": content_type},
                                       text=f"event: message\ndata: {json.dumps(envelope)}\n\n")
            return httpx2.Response(200, json=envelope)
        return check_tools(url, transport=httpx2.MockTransport(respond))

    def save(self, **changes):
        return update_campaign_custom_mcp(self.root, "oss-launch", {**self.update, **changes}, Lock())

    def test_only_saves_after_discovery_and_preserves_managed_integration(self):
        self.assertEqual(self.campaign()["manualIntegrations"], [{"id": "hacker-news", "name": "hacker-news", "url": ""}])
        with patch("workspace.check_tools", side_effect=self.probe):
            self.assertEqual(self.save()["toolCount"], 1)
        self.assertEqual(self.methods, ["initialize", "notifications/initialized", "tools/list"])
        saved = safe_load(self.record.read_bytes())
        self.assertEqual(saved["integrations"], ["hacker-news", "github"])
        self.assertIn("other", saved["mcp_servers"])
        self.assertEqual(saved["mcp_servers"]["oma-custom-hacker-news"], {"url": URL})
        self.assertTrue(self.record.read_bytes().startswith(b"# Keep me\n"))
        self.assertEqual(self.campaign()["manualIntegrations"][0]["url"], URL)
        self.assertEqual([item["id"] for item in self.campaign()["requiredIntegrations"]], ["github"])
        self.assertFalse(self.campaign()["integrationConfigInvalid"])

    def test_empty_tools_do_not_write(self):
        with patch("workspace.check_tools", side_effect=lambda url: self.probe(url, healthy=False)):
            with self.assertRaisesRegex(WorkspaceError, "didn’t expose any tools"):
                self.save()
        self.assertEqual(self.record.read_bytes(), self.original)

    def test_http_success_alone_and_redirects_fail(self):
        for response in (httpx2.Response(200, text="OK"),
                         httpx2.Response(307, headers={"Location": "https://other.example.test/mcp"})):
            requests = []

            def respond(request):
                requests.append(str(request.url))
                return response

            with patch("workspace.check_tools", side_effect=lambda url: check_tools(url, transport=httpx2.MockTransport(respond))):
                with self.assertRaisesRegex(WorkspaceError, "health check failed"):
                    self.save()
            self.assertEqual(requests, [URL])
            self.assertEqual(self.record.read_bytes(), self.original)

    def test_streamable_http_event_stream(self):
        with patch("workspace.check_tools", side_effect=lambda url: self.probe(url, content_type="text/event-stream")):
            self.assertEqual(self.save()["toolCount"], 1)

    def test_invalid_target_never_probed(self):
        with patch("workspace.check_tools") as probe:
            for changes in ({"url": "https://unapproved.example.test/mcp"}, {"url": URL + "?token=hidden"},
                            {"integrationId": "github"}, {"integrationId": "not-required"}, {"revision": "0" * 64}):
                with self.assertRaises(WorkspaceError):
                    self.save(**changes)
            probe.assert_not_called()
        self.assertEqual(self.record.read_bytes(), self.original)

    def test_concurrent_edit_is_not_overwritten_after_probe(self):
        changed = self.original.replace(b"Launch", b"New name")

        def probe(_url):
            self.record.write_bytes(changed)
            return 1

        with patch("workspace.check_tools", side_effect=probe):
            with self.assertRaisesRegex(WorkspaceError, "campaign changed"):
                self.save()
        self.assertEqual(self.record.read_bytes(), changed)


if __name__ == "__main__":
    unittest.main()
