# Scheduled jobs in agent configs

Declaring `jobs` defines a schedule in the source. The [OMA VM installer](../README.md#self-host-on-a-bare-metal-server) registers bundled jobs in Hermes and leaves them paused.

An agent definition can declare `jobs`, an optional list of scheduled **Hermes cron agent jobs**. The source definitions include the three requested recurring jobs below; other agents use `jobs: []`. These are declarations only, not active schedules. Missing `jobs` means none; the intended contract rejects `jobs: null`.

## Declared recurring jobs

| Owning deployed profile | Job ID | Schedule | Purpose |
| --- | --- | --- | --- |
| `seo__orchestrator` | `maintain-seo` | `every 10m` | Pursue the standing SEO goal, reconcile the board and evidence, and dynamically advance useful work. |
| `social-media__orchestrator` | `maintain-social-media` | `every 10m` | Pursue the social mission and coordinate justified work without duplicating the scheduled interactor. |
| `social-media__interactor` | `reply-to-social-interactions` | `every 5m` | Check connected integrations for new comments, replies, mentions, and conversations; send warranted authorized replies and verify them. |

Each run is bounded, respects pause/stop state, checks prior work, and remains silent when nothing needs action. The interactor's prompt requires durable progress, duplicate-reply prevention, retry reconciliation, and exact-target read-back. It permits routine replies within existing standing authority, not unrestricted outreach or account actions.

Job declarations omit `skills` and agent configs omit `skills.auto_load`. The owning agent loads relevant skills on demand using its `SOUL.md` guidance.

All three owning configs set native `cron.max_parallel_jobs: 1`, serializing their cron work per profile. This does not serialize different profiles, unrelated interactive sessions, or Kanban workers; deployment still needs to coordinate those execution paths. The cron job itself starts the owning agent's scheduled turn; the prompt does not spawn another orchestrator process or create another timer.

`jobs` is OMA source metadata, not a native Hermes `config.yaml` setting. Provisioning must register jobs in the owning profile through supported Hermes interfaces and keep OMA metadata (`jobs`, `id`, `description`, `version`, and `oma_skills`) out of native runtime settings.

## Example

For another agent or schedule, a job declaration can look like:

```yaml
jobs:
  - id: daily-review
    name: Daily social review
    schedule: "0 9 * * *"
    timezone: Asia/Kathmandu
    prompt: >-
      Review the authorized social mission, current board, recent account
      evidence, and due obligations. Choose justified next work, avoid
      duplicates, honor pause state, and remain silent if no action is due.
    repeat: null
```

The daily cadence above is illustrative; the declared recurring jobs use the requested 10-minute and 5-minute intervals. Every agent may declare its own jobs; the owning config determines the execution profile. Agent directories and declared IDs already use `[campaign id]__[role id]`, such as `social-media__orchestrator`. Use that canonical ID as the Hermes profile name; do not add the campaign prefix again or append an installation-ID segment. No separate runtime-name mapping, `agent`, or `assignee` field is needed on a job.

## Job fields

Validate these source-contract rules before installing or updating jobs.

| Field | Meaning |
| --- | --- |
| `id` | Required stable ID, unique within the owning agent; 1–64 letters/digits/hyphens/underscores, beginning with a letter or digit. Keep it unchanged across updates. |
| `schedule` | Required native Hermes schedule string: cron expression, recurring interval such as `every 2h`, supported natural schedule, or one-shot time/delay. Validate against the target Hermes runtime during provisioning. |
| `prompt` | Required nonempty instruction executed by the owning agent. Do not embed secrets. |
| `name` | Optional display label; defaults to `id`. |
| `timezone` | Optional IANA zone; omitted/null inherits the deployed profile's timezone. It affects wall-clock schedules, not elapsed intervals. |
| `skills` | Optional list of installed, available skill IDs to preload for the job. They must not be excluded by the owning profile's `skills.disabled` or applicable platform policy. Defaults to `[]`; does not install skills or restrict access to other available skills. |
| `repeat` | Optional positive execution count; omitted/null uses Hermes defaults: one execution for one-shots and unlimited for recurring schedules. |

The initial contract covers prompt-based jobs, not script jobs, model overrides, cross-job chains, or delivery routing. Reject unknown fields, use local output, and leave newly registered jobs paused until authorized activation. Models, credentials, tools, and permissions belong to the owning deployed profile; declarations do not grant capabilities.

## Skill discovery

Agent configs list only `computer-use`, `hermes-agent`, and `oma-playbooks` under `skills.disabled`, with no `skills.enabled` allowlist. Hermes treats `hermes-agent` as essential and leaves it available. Optional skills and newly created skills are not blocked by this list, but they must still be installed or discoverable and satisfy runtime restrictions.

`oma_skills` controls which OMA source skills the campaign provisions into each agent. An empty list installs none; a nonempty list installs only its declared skill IDs. For example, `seo__humanizer` provisions `humanizer`, and its `SOUL.md` tells it when to load the skill. Do not list unselected OMA source skills under `skills.disabled`; they are not provisioned for that agent.

## Provisioning and activation requirements

- Use native Hermes parsing, scheduling, overlap handling, and execution history rather than creating a second scheduler.
- Use the owning config's canonical agent ID directly as the Hermes profile name before registering jobs. Keep job IDs scoped to that profile; for example, research jobs belong to `seo__researcher` or `social-media__researcher`, not a shared `researcher` profile. Do not prefix an already-prefixed agent ID again.
- Reconcile by stable ID without duplicating jobs, overwriting unrelated jobs, resetting execution history, or undoing intentional pauses. Handle removed declarations explicitly.
- Anchor relative one-shot delays at provisioning, or prefer explicit timestamps with offsets. Validate timezones and schedules against the target runtime.
- Verify registration and state through read-back, and verify an actual run separately before reporting activation. A running gateway scheduler, valid inference route, and required integrations are execution prerequisites.
- Ordinary cron jobs use fresh sessions; they do not implicitly resume the canonical orchestrator conversation. Provision a supported serialized wake-up route when the mission requires that session, rather than launching competing planners.
- Give each obligation one scheduling owner. Do not register the same obligation in both Hermes cron and a hosted control-plane scheduler. Platform-native scheduled publication is distinct from recurring agent review.
- Keep planning dynamic: scheduled prompts may request a review, but must not impose a fixed specialist pipeline.

Reference: [Hermes cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron).
