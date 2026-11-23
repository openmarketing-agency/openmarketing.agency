"""Verify mounted workspace reads, scoped edits, and revision protection."""

from hashlib import sha256
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

from hermes_yaml import safe_load

sys.path.insert(0, "/opt/oma")
from workspace import (
    WorkspaceError, agent_profile, brand_document, brand_logo, records, sync_campaign_configuration,
    update_campaign_configuration, update_knowledge, update_record,
)


def must_reject(status, *args):
    try:
        update_record(*args)
    except WorkspaceError as error:
        assert error.status == status, str(error)
    else:
        raise AssertionError(f"Workspace update should have returned {status}")


with TemporaryDirectory() as temporary:
    root = Path(temporary) / "oma"
    assert not records(root)["brands"]
    brand = root / "brands" / "example" / "config.yaml"
    brand.parent.mkdir(parents=True)
    brand.write_text(
        "# Keep the brand notes\nid: example\nname: Example\ndescription: Original\n"
        "logos: {primary: logos/primary.svg}\nknowledge_base: Old knowledge\nsecret: ignore\n"
    )
    playbook = root / "playbooks" / "growth" / "config.yaml"
    playbook.parent.mkdir(parents=True)
    playbook.write_text("id: growth\nname: Growth\nbrand_id: example\nstrategy: Original strategy\n")
    campaign = root / "campaigns" / "seo" / "config.yaml"
    campaign.parent.mkdir(parents=True)
    campaign.write_text(
        "id: seo\nname: Search campaign\nplaybook: growth\nagents: [seo__researcher]\n"
        "goals: [Qualified leads]\nplans: [Publish research]\n"
        "tool_suggestions: [google_analytics, github, github, invalid/path, 42]\n"
        "integrations: [discord, facebook, x, google-analytics, wordpress]\n"
    )
    agent = root / "agents" / "seo__researcher" / "config.yaml"
    agent.parent.mkdir(parents=True)
    agent.write_text(
        "id: seo__researcher\nname: Researcher\ncampaign_id: seo\n"
        "jobs: [{id: brief, schedule: weekly, prompt: internal prompt}]\n"
    )
    os.symlink(brand.parent, root / "brands" / "linked")

    saved = records(root)
    assert saved["skipped"] == 1
    assert "secret" not in saved["brands"][0]
    assert saved["playbooks"][0]["brandId"] == "example"
    assert saved["campaigns"][0]["playbookId"] == "growth"
    assert saved["campaigns"][0]["goals"] == ["Qualified leads"]
    assert "toolSuggestions" not in saved["campaigns"][0]
    assert saved["campaigns"][0]["integrationConfigInvalid"] is False
    assert saved["campaigns"][0]["requiredIntegrations"] == [
        {"id": "discord", "name": "Discord", "slug": "discord"},
        {"id": "facebook", "name": "Facebook", "slug": "facebook"},
        {"id": "x", "name": "X (Twitter)", "slug": "twitter"},
        {"id": "google-analytics", "name": "Google Analytics 4", "slug": "google_analytics"},
        {"id": "wordpress", "name": "WordPress", "slug": None},
    ]
    assert saved["agents"][0]["jobs"] == [{"name": "brief", "schedule": "weekly"}]
    update = {
        "revision": saved["brands"][0]["revision"], "name": "New name",
        "description": "New description", "knowledge_base": "New knowledge\nKeep both lines.",
    }
    update_record(root, "brands", "example", update)
    changed = brand.read_text()
    assert "# Keep the brand notes" in changed
    assert safe_load(changed) == {
        "id": "example", "name": "New name", "description": "New description",
        "logos": {"primary": "logos/primary.svg"}, "knowledge_base": "New knowledge\nKeep both lines.",
        "secret": "ignore",
    }
    must_reject(409, root, "brands", "example", update)
    must_reject(404, root, "brands", "linked", update)
    must_reject(404, root, "campaigns", "seo", update)
    must_reject(422, root, "brands", "example", {**update, "id": "changed"})
    assert brand.read_text() == changed

    update_record(root, "playbooks", "growth", {
        "revision": sha256(playbook.read_bytes()).hexdigest(), "strategy": "New strategy\nSecond line.",
    })
    assert safe_load(playbook.read_text()) == {
        "id": "growth", "name": "Growth", "brand_id": "example", "strategy": "New strategy\nSecond line.",
    }

    # The current agent uses a shared brand and playbook and leaves earlier records in place.
    current_brand = root / "brand" / "config.yaml"
    current_brand.parent.mkdir()
    current_brand.write_text("id: example\nname: Current brand\n")
    current_playbook = root / "playbook" / "config.yaml"
    current_playbook.parent.mkdir()
    current_playbook.write_text("id: launch\nname: Launch\nbrand_id: ignored\nstrategy: Original plan\n")
    new_campaign = root / "campaigns" / "social" / "config.yaml"
    new_campaign.parent.mkdir()
    new_campaign.write_text("id: social\nname: Social campaign\n")

    current = records(root)
    assert [item["name"] for item in current["brands"]] == ["Current brand"]
    assert [(item["id"], item["brandId"]) for item in current["playbooks"]] == [
        ("launch", "example"), ("growth", "example"),
    ]
    assert [(item["id"], item["playbookId"]) for item in current["campaigns"]] == [
        ("seo", "growth"), ("social", "launch"),
    ]
    assert current["campaigns"][1]["requiredIntegrations"] == []
    assert current["campaigns"][1]["integrationConfigInvalid"] is False
    base = "id: social\nname: Social campaign\ntool_suggestions: [github]\n"
    for value in ("", "integrations: []\n"):
        new_campaign.write_text(base + value)
        saved_social = records(root)["campaigns"][1]
        assert saved_social["requiredIntegrations"] == []
        assert saved_social["integrationConfigInvalid"] is False
    new_campaign.write_text(base + "integrations: [slack, slack, https://example.test, {id: discord}, 42, made-up]\n")
    saved_social = records(root)["campaigns"][1]
    assert saved_social["requiredIntegrations"] == [{"id": "slack", "name": "Slack", "slug": "slack"}]
    assert saved_social["integrationConfigInvalid"] is True
    for value in ("slack", "{slack: true}", "null"):
        new_campaign.write_text(base + "integrations: " + value + "\n")
        saved_social = records(root)["campaigns"][1]
        assert saved_social["requiredIntegrations"] == []
        assert saved_social["integrationConfigInvalid"] is True
    update_record(root, "brands", "example", {**update, "revision": current["brands"][0]["revision"]})
    assert safe_load(current_brand.read_text())["name"] == "New name"
    assert brand.read_text() == changed
    update_record(root, "playbooks", "launch", {
        "revision": current["playbooks"][0]["revision"], "strategy": "Updated launch plan",
    })
    assert safe_load(current_playbook.read_text())["strategy"] == "Updated launch plan"
    assert safe_load(playbook.read_text())["strategy"] == "New strategy\nSecond line."
    must_reject(409, root, "playbooks", "launch", {
        "revision": current["playbooks"][0]["revision"], "strategy": "Stale plan",
    })

    # File-backed brand knowledge, Markdown reports, and assets stay within the brand record.
    knowledge = current_brand.parent / "knowledge-base.md"
    knowledge.write_text("# What we make\n\n| Plan | Goal |\n| --- | --- |\n| Launch | Reach |\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n![tracking](https://example.test/pixel.png)")
    current_brand.write_text(
        "id: example\nname: Current brand\ndescription: Original details\n"
        "knowledge_base_file: knowledge-base.md\n"
        "design_system: {guidelines: design/DESIGN.md, source_url: 'https://example.test/design'}\n"
        "website: {status: verified, url: 'https://example.test', feed_url: 'https://example.test/feed'}\n"
        "research: {market_report: research/market.md, competitor_report: ../outside.md}\n"
        "logos: {mark: logos/mark.png, unsafe: logos/unsafe.svg}\n"
    )
    (current_brand.parent / "research").mkdir()
    (current_brand.parent / "research" / "market.md").write_text("## Market observations\n")
    (current_brand.parent / "design").mkdir()
    (current_brand.parent / "design" / "DESIGN.md").write_text("## Typography\n")
    (current_brand.parent / "docs" / "repo").mkdir(parents=True)
    (current_brand.parent / "docs" / "repo" / "architecture.md").write_text("## Architecture\n")
    outside = root / "outside.md"
    outside.write_text("Outside data")
    os.symlink(outside, current_brand.parent / "docs" / "linked.md")
    os.link(outside, current_brand.parent / "docs" / "hardlink.md")
    (current_brand.parent / "logos").mkdir()
    (current_brand.parent / "logos" / "mark.png").write_bytes(bytes.fromhex("89504e470d0a1a0a"))
    (current_brand.parent / "logos" / "unsafe.svg").write_text("<svg/>")
    (agent.parent / "SOUL.md").write_text("## Research role\n\nUse public sources.\n")

    active = records(root)["brands"][0]
    assert active["knowledge"] == knowledge.read_text()
    assert "<table>" in active["knowledgeHtml"] and "<h3>" in active["knowledgeHtml"]
    assert all(value not in active["knowledgeHtml"] for value in ("<script>", "<img", "href=\"javascript:"))
    assert active["channels"] == [{
        "label": "Website", "status": "verified", "url": "https://example.test",
        "feedUrl": "https://example.test/feed", "signupUrl": "",
    }]
    docs = {doc["path"]: doc["id"] for doc in active["documents"]}
    assert set(docs) == {"design/DESIGN.md", "research/market.md", "docs/repo/architecture.md", "docs/hardlink.md"}
    assert "Market observations" in brand_document(root, "example", docs["research/market.md"])["html"]
    def reject_call(status, operation, *args):
        try:
            operation(*args)
        except WorkspaceError as error:
            assert error.status == status, str(error)
        else:
            raise AssertionError(f"Workspace operation should have returned {status}")

    reject_call(404, brand_document, root, "example", "ffff")
    reject_call(422, brand_document, root, "example", docs["docs/hardlink.md"])
    assert brand_logo(root, "example", "mark")["mediaType"] == "image/png"
    reject_call(422, brand_logo, root, "example", "unsafe")
    assert "<h4>Research role</h4>" in agent_profile(root, "seo__researcher")["html"]

    update_record(root, "brands", "example", {
        "revision": active["revision"], "name": "New brand", "description": "Updated details",
    })
    assert safe_load(current_brand.read_text())["knowledge_base_file"] == "knowledge-base.md"
    active = records(root)["brands"][0]
    content_edit = {"revision": active["knowledgeRevision"], "knowledge_base": "# Revised knowledge\n"}
    original_yaml = current_brand.read_bytes()
    update_knowledge(root, "example", content_edit)
    assert knowledge.read_text() == "# Revised knowledge\n"
    assert current_brand.read_bytes() == original_yaml
    reject_call(409, update_knowledge, root, "example", content_edit)
    knowledge.unlink()
    os.symlink(outside, knowledge)
    broken = records(root)["brands"][0]
    assert broken["knowledge"] == "" and "knowledgeRevision" not in broken
    assert outside.read_text() == "Outside data"



with TemporaryDirectory() as temporary:
    root = Path(temporary) / "oma"
    campaign = root / "campaigns" / "seo" / "config.yaml"
    campaign.parent.mkdir(parents=True)
    campaign.write_text(
        "# Campaign notes\nid: seo\nname: Organic search\n"
        "model: {default: old-model, context_length: 2000}\n"
        "mcp_servers: {other: {url: 'https://other.example.test/mcp'}}\n"
    )
    original = campaign.read_bytes()
    update = {
        "revision": sha256(original).hexdigest(), "provider": "litellm-proxy", "modelId": "proxy-model",
        "baseUrl": "https://proxy.example.test/v1", "setModelKey": True,
        "composioUrl": "https://backend.composio.dev/tool_router/trs_example/mcp",
    }
    reject_call(422, update_campaign_configuration, root, "seo", {
        **update, "composioUrl": "https://backend.composio.dev.unrelated.test/tool_router/trs_example/mcp",
    })
    assert campaign.read_bytes() == original
    configuration = update_campaign_configuration(root, "seo", update)
    assert records(root)["campaigns"][0]["configuration"] == configuration
    updated_text = campaign.read_text()
    assert "# Campaign notes" in updated_text
    saved = safe_load(updated_text)
    assert saved["model"] == {
        "default": "proxy-model", "context_length": 2000, "provider": "custom",
        "base_url": update["baseUrl"], "api_key": "${HERMES_MODEL_API_KEY}", "key_env": "HERMES_MODEL_API_KEY",
    }
    assert saved["mcp_servers"] == {
        "other": {"url": "https://other.example.test/mcp"},
        "composio": {"url": update["composioUrl"], "headers": {"x-api-key": "${COMPOSIO_API_KEY}"}},
    }
    reject_call(409, update_campaign_configuration, root, "seo", update)
    reject_call(422, update_campaign_configuration, root, "seo", {
        **update, "revision": configuration["revision"], "baseUrl": "https://next.example.test", "setModelKey": False,
    })
    keys = {"HERMES_MODEL_API_KEY": "fixture-model-key", "COMPOSIO_API_KEY": "fixture-composio-key"}
    with patch.dict(os.environ, {"UNRELATED_TOKEN": "fixture-unrelated"}), patch("workspace.ensure_bundled_campaign_routing"), patch("workspace.subprocess.Popen") as native:
        process = native.return_value
        process.__enter__.return_value.wait.return_value = 0
        received_keys = []
        def launch(*_, **kwargs):
            received_keys.append(json.load(kwargs["stdin"]))
            return process
        native.side_effect = launch
        reject_call(422, sync_campaign_configuration, root, "seo", {
            "revision": configuration["revision"], "env": {"UNRELATED_TOKEN": "fixture-unrelated"},
        })
        reject_call(409, sync_campaign_configuration, root, "seo", {"revision": update["revision"], "env": keys})
        native.assert_not_called()
        assert sync_campaign_configuration(root, "seo", {"revision": configuration["revision"], "env": keys}) == configuration
        args, kwargs = native.call_args
        assert args == ([sys.executable, "-m", "hermes_cli.oma_campaigns.sync", "seo", "--env-stdin"],)
        assert received_keys == [keys]
        assert keys.keys().isdisjoint(kwargs["env"])
        assert "UNRELATED_TOKEN" not in kwargs["env"]
        native.return_value.__enter__.return_value.wait.return_value = 1
        reject_call(502, sync_campaign_configuration, root, "seo", {"revision": configuration["revision"], "env": keys})
    assert all(value not in campaign.read_text() for value in keys.values())
    reject_call(422, update_campaign_configuration, root, "seo", {
        **update, "revision": configuration["revision"], "useEnvironmentKey": True,
    })
    # A credential already present in an older campaign profile remains usable by its YAML reference.
    legacy = safe_load(campaign.read_text())
    legacy["model"].update(api_key="${OMA_HERMES_API_KEY}", key_env="OMA_HERMES_API_KEY")
    campaign.write_text(json.dumps(legacy))
    legacy_revision = sha256(campaign.read_bytes()).hexdigest()
    with patch("workspace.ensure_bundled_campaign_routing"), patch("workspace.subprocess.Popen") as native:
        native.return_value.__enter__.return_value.wait.return_value = 0
        reject_call(422, sync_campaign_configuration, root, "seo", {
            "revision": legacy_revision, "env": {"OMA_HERMES_API_KEY": "retired-app-default"},
        })
        native.assert_not_called()
        assert sync_campaign_configuration(root, "seo", {"revision": legacy_revision, "env": {}})["hasModelKey"]
        assert "OMA_HERMES_API_KEY" not in native.call_args.kwargs["env"]
        assert safe_load(campaign.read_text())["model"]["api_key"] == "${OMA_HERMES_API_KEY}"
    cleared = update_campaign_configuration(root, "seo", {
        **update, "revision": legacy_revision, "provider": "", "modelId": "",
        "baseUrl": "", "setModelKey": False, "composioUrl": "",
    })
    assert cleared["modelId"] == "" and cleared["composioUrl"] == ""
    assert "model" not in safe_load(campaign.read_text())
    assert safe_load(campaign.read_text())["mcp_servers"] == {"other": {"url": "https://other.example.test/mcp"}}

print("Workspace record reads and edits passed")
