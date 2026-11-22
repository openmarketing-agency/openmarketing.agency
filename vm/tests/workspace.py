"""Verify mounted workspace reads, scoped edits, and revision protection."""

from hashlib import sha256
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from hermes_yaml import safe_load

sys.path.insert(0, "/opt/oma")
from workspace import WorkspaceError, records, update_record


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

print("Workspace record reads and edits passed")
