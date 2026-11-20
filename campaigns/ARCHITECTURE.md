# OMA Campaigns: Deployment and Orchestration Architecture

> **Status: design for campaign orchestration.** The [OMA setup guide](../README.md) covers hosting, model access, and coordinator chat. The mission control and integration bindings in this document describe the intended design.

**Profile installation:** The VM runtime installs the bundled profiles and leaves new scheduled jobs paused.

## 1. Overview

An OMA campaign is a deployable, goal-oriented team of agents with platform integrations and operating policies. It is **not a fixed, predefined pipeline**.

In the proposed deployment flow, a user selects a campaign in the OMA dashboard. The Next.js control plane provisions the account's instance on first use and gives Hermes a quota-controlled inference key. The configured provider runs the VM, and the image installs the bundled coordinators and specialists.

Within the VM, the coordinator interprets the mission, creates and assigns tasks through Hermes Kanban, evaluates results, and decides what work is justified next. The gateway stays available continuously, but the coordinator does not need to run the model continuously.

The central design principle is:

> OMA manages deployment, billing boundaries, policy, and lifecycle. The coordinator decides what work is needed. Hermes provides agent execution, durable task coordination, scheduling, and supported wake-up mechanisms.

## 2. Names and Responsibilities

| Name or concept | Meaning |
| --- | --- |
| `oma-agent/` | The local Hermes-based runtime source checkout. |
| `skills/` | Shared skill sources, separate from campaigns and referenced by skill ID. |
| `campaigns/` | Goal-oriented campaigns containing their own agent configurations and personas. |
| `seo/`, `social-media/` | Current campaign directories; each owns its agents independently. Directory names are distinct from coordinator IDs. |
| Coordinator definition | Required `agents/<campaign id>__orchestrator/config.yaml` and adjacent `SOUL.md`, with the same canonical `id` and declared orchestration skills. |
| `seo__researcher`, `seo__writer`, `seo__humanizer`, `seo__verifier`, `seo__publisher` | The current SEO specialist IDs, directory names, and Hermes profile names. |
| `social-media__researcher`, `social-media__creator`, `social-media__publisher`, `social-media__interactor` | The social-media specialist IDs; its coordinator is `social-media__orchestrator`. |
| Orchestrator | The coordinator role, identified as `seo__orchestrator` or `social-media__orchestrator` in the owning campaign. |
| `default` | Hermes's native root profile ID, separate from every campaign's named profiles. |
| Specialist profile | A named Hermes profile created from a resolved specialist definition. |
| Deployment | One user's provisioned instance of a campaign, with its own VM, budget allocation, profiles, and board. |
| Mission | The standing objective, success criteria, scope, and operating boundaries. |
| Task | A unit of work dynamically created on the deployment's Hermes Kanban board. |
| Task attempt | One execution attempt tracked by Hermes for a task. |
| Integration binding | A deployment-specific external connection with explicitly assigned capabilities. |

Canonical agent IDs use `[campaign id]__[role id]`, such as `seo__researcher`. Agent directory names, the config's declared `id`, manifest roster entries, routing references, and Hermes profile names all use that same canonical ID. Deployment validates and uses the declared ID directly; it must not prefix it again or add an installation-ID segment. Skill IDs, such as `humanizer` or `research-market`, are independent and unchanged.

## 3. Definition Layout

The current definition layout is:

```text
openmarketing.agency/
  skills/
    research/
      research-market/
        SKILL.md
      research-trends/
        SKILL.md
    orchestration/
      playbook-orchestration/
        SKILL.md
  campaigns/
    ARCHITECTURE.md
    seo/
      config.yaml
      skills/
        seo-coordination/
          SKILL.md
      agents/
        seo__orchestrator/
          config.yaml
          SOUL.md
        seo__researcher/
          config.yaml
          SOUL.md
        seo__writer/
          config.yaml
          SOUL.md
        seo__humanizer/
          config.yaml
          SOUL.md
        seo__verifier/
          config.yaml
          SOUL.md
        seo__publisher/
          config.yaml
          SOUL.md
    social-media/
      config.yaml
      agents/
        social-media__orchestrator/
          config.yaml
          SOUL.md
        social-media__researcher/
          config.yaml
          SOUL.md
        social-media__creator/
          config.yaml
          SOUL.md
        social-media__publisher/
          config.yaml
          SOUL.md
        social-media__interactor/
          config.yaml
          SOUL.md
```

Each campaign owns its agent configurations, SOUL files, and campaign-specific skills under its own `skills/` directory. Reusable skills remain in the repository's top-level `skills/` directory. There is no separate reusable-agent library or cross-campaign agent-override layer. For compatibility with existing installations, the VM image still stores the bundled sources at `/opt/oma/playbooks`.

Each campaign's root `config.yaml` declares OMA metadata: `id`, `name`, `version`, `description`, the canonical `orchestrator` agent ID, and an `agents` list of canonical IDs. Resolve each listed ID to `agents/<id>/config.yaml` and the adjacent `SOUL.md`, validating that the directory and declared ID match and have the owning campaign's prefix. The orchestrator must appear in that roster. These manifests describe the team, not a fixed execution order or native Hermes runtime configuration; the files alone do not install agents, schedule jobs, or activate a mission. Agent-level tools, skills, and jobs remain in each agent's config.

Every campaign must contain a coordinator definition at `agents/<campaign id>__orchestrator/`, with that canonical `id`, `config.yaml`, `SOUL.md`, and resolvable orchestration skill declarations. For example, SEO uses `agents/seo__orchestrator/` and `id: seo__orchestrator`. The coordinator lives alongside the specialists, not at the campaign root. Reject a campaign missing this definition before provisioning; do not silently synthesize a coordinator or use a personal default profile.

The SEO coordinator definition and its local/shared skills are present as source scaffolds. Deployment must explicitly provision referenced skills from the campaign's `skills/` tree or the shared `skills/` tree; source files do not install themselves into Hermes profiles or start a coordinator session.

The social-media campaign contains five complete config/SOUL source definitions. Its orchestrator dynamically coordinates research, content creation, publication, and community interaction through native Kanban, without a fixed pipeline. It reuses the shared `playbook-orchestration` skill; its researcher declares `research-market` and `research-trends`. No new skills or social integrations are installed by these definitions. `orchestrator_profile` and `dispatch_profiles` already contain canonical Hermes profile names; bootstrap validates and provisions them unchanged. Account bindings, media-generation capabilities, credentials, enforced action policy, and mission activation remain deployment responsibilities.

The SEO coordinator's `SOUL.md` states the standing goal to autonomously research trends and keywords, inspect Search Console/site performance, implement permitted improvements, measure outcomes, and repeat. Its auto-loaded skills define the operating procedure. It does not wait for per-task user instructions or terminate after a completed article. Bootstrap supplies deployment-specific objectives, target site, permissions, and budget to the canonical coordinator session; no separate mission file or custom context-file loader is required.

Deployment grants standing authority for covered routine changes so these do not require repeated human approval. Required verification remains, and actions outside that authority must escalate. Resolve each connected integration into explicit owning-profile tool allowlists and scoped credentials; the base coordinator config does not itself provide Search Console or CMS access. Provision durable recurring mission reviews as well as task-event wake-ups so new data and opportunities are considered even on an empty board. Track change hypotheses, observations, and due reviews; wait for useful evidence rather than running an endless model loop. These activation and enforcement requirements remain unimplemented in the source scaffold.

## 4. Control Plane and Execution Environment

```text
User / Website
      |
      | Deploy campaign
      v
FastAPI control plane
  - Authentication and entitlement
  - Deployment records and progress
  - Budget and credential administration
  - Provisioning and lifecycle requests
      |
      | Durable provisioning job
      v
Provisioning worker
  - Resolve and validate definitions
  - Provision VM and configure access
  - Create scoped LiteLLM virtual key
  - Bootstrap Hermes profiles and board
  - Verify readiness
      |
      v
Dedicated deployment VM
  Hermes gateway
    seo__orchestrator profile        -> SEO coordinator
    seo__researcher profile          -> SEO research specialist
    other campaign-prefixed profiles -> Selected agents
  Hermes Kanban board               -> Durable task coordination
  Coordinator session and heartbeat -> Ongoing oversight
      |
      | Deployment-scoped inference credential
      v
LiteLLM proxy -> Authorized model providers
```

Provisioning order may be adjusted to the provider's requirements. Prefer creating the inference key close to the point when bootstrap needs it, and record every external resource as soon as it is created.

The runtime package and provisioning-worker technology are implementation choices; no additional package name is prescribed by this document.

## 5. Website-to-VM Deployment

### Accept the Request

The FastAPI endpoint should:

1. Authenticate the user and verify campaign access and resource entitlement.
2. Validate an idempotency key for the deployment request.
3. Create a deployment record tied to that user and campaign revision.
4. Enqueue a durable provisioning job.
5. Return `202 Accepted` with a deployment ID and a status location.

The frontend can poll status or subscribe to progress events. A repeated request must not create duplicate VMs or budget allocations.

Do not perform long-running provisioning inside the HTTP request or rely solely on an in-process FastAPI background task that disappears on restart.

### Resolve Before Spending

Before provisioning infrastructure, validate and freeze:

- The selected campaign revision and referenced skill revisions.
- Coordinator configuration, persona, skills, and mission.
- The declared specialist roster and campaign-local agent definitions.
- Required integrations and credential references.
- Allowed models, tool policies, and resource limits.

Persist an immutable resolved deployment specification. Later changes to source definitions must not silently modify a running deployment.

### Provision and Verify

The provisioning worker should:

1. Provision the VM with appropriate compute, storage, network, and administration boundaries.
2. Install a pinned Hermes release or source revision.
3. Provision the deployment-scoped LiteLLM credential through a protected bootstrap path.
4. Materialize the coordinator and specialist profiles.
5. Configure the deployment's board, runtime routes, integration bindings, and wake-up mechanisms.
6. Start the gateway under a service supervisor.
7. Establish the coordinator session and admit its initial mission turn.
8. Verify the runtime and inference path before reporting the deployment ready.

Read back external resources after creation or update. A successful provisioning request is not equivalent to a healthy agent deployment.

## 6. Orchestrator Agent and Hermes Profile Mapping

Every campaign agent, including its orchestrator, uses a canonical source ID and named Hermes profile with exactly two components separated by a double underscore:

```text
[campaign id]__[role id]
```

The source already stores the full canonical ID: `id: seo__researcher` lives in `agents/seo__researcher/`. At deployment time, automatically take the Hermes profile name from that declared ID after validating the owning campaign prefix. Do not concatenate the campaign ID onto it again. There is no separate runtime-name field or manually maintained mapping, and no installation-ID segment.

| Campaign ID | Role suffix | Canonical agent ID, directory name, and Hermes profile |
| --- | --- | --- |
| `seo` | `orchestrator` | `seo__orchestrator` |
| `seo` | `researcher` | `seo__researcher` |
| `social-media` | `orchestrator` | `social-media__orchestrator` |
| `social-media` | `researcher` | `social-media__researcher` |
| `social-media` | `publisher` | `social-media__publisher` |
| `social-media` | `interactor` | `social-media__interactor` |
| `social-media` | `creator` | `social-media__creator` |

Apply the same rule to all remaining specialists. Install each agent's config, SOUL, and skills in the named profile matching its declared ID, and use that exact ID in Kanban assignees, dispatcher rosters, delegation routes, and cron ownership. `kanban.orchestrator_profile` and `dispatch_profiles` already use canonical IDs; bootstrap validates their roster membership without adding prefixes or substituting a root-profile mapping.

Hermes's native root profile retains the internal ID `default`. It is not a campaign's orchestrator and must not be overwritten when installing a campaign. Profile names alone do not grant capabilities or make specialists inherit settings; bootstrap must explicitly configure missions, tools, routing, and wake-ups.

This convention distinguishes agents across campaigns, but intentionally does not distinguish two installations of the same campaign within one Hermes profile namespace. Reconcile an existing installation without overwriting its state, or use a separate isolated Hermes environment when independent duplicate installations are required. Provisioning should reject resolved-name collisions rather than adding a suffix or adopting unmanaged live profiles.

Local development must use an isolated test environment rather than modifying an existing personal profile.

## 7. Agent and Skill Resolution

A campaign explicitly declares its agent roster. Local directories alone do not silently activate agents.

For each selected agent:

1. Validate its declared ID.
2. Read its complete configuration and SOUL from the campaign's `agents/` directory.
3. Resolve declared skill IDs against the selected campaign's `skills/` tree and the shared `skills/` tree. Reject ambiguous duplicate IDs rather than silently overriding a source; do not load another campaign's private skills.
4. Validate the definition and its skill dependencies against supported Hermes settings and deployment policies.
5. Produce a deployment definition and an explicit ID-to-profile mapping.

Reject duplicate IDs, unresolved references, and incomplete definitions before provisioning.

Require exactly one coordinator with `id: <campaign id>__orchestrator` at `agents/<campaign id>__orchestrator/`, and require the root manifest's `orchestrator` to reference that exact ID. For the SEO campaign, resolve `playbook-orchestration` to `skills/orchestration/playbook-orchestration/SKILL.md` and `seo-coordination` to `campaigns/seo/skills/seo-coordination/SKILL.md`. `oma_skills` lists OMA source dependencies to install from either source tree; native `skills.disabled` excludes only named, non-essential skills. Profiles load provisioned skills on demand. Omit the `skills.enabled` allowlist so newly created skills remain discoverable. None of these fields substitutes for provisioning or mission admission.

Agent definitions are campaign-local, subject to native Hermes defaults and enforced deployment policies. Do not infer persona or capability inheritance from another campaign or profile.

Skill IDs do not need to change when their source directory moves. For example, `research-market` resolves to `skills/research/research-market/SKILL.md`. Pin the skill source revision and install selected skills into the owning Hermes profile during deployment.

## 8. Configuration, Persona, and Skills

Keep ownership of configuration explicit:

- **Native Hermes settings:** model, toolsets, delegation, and supported runtime options.
- **OMA metadata:** IDs, descriptions, versions, and source references.
- **Campaign policies:** mission, roster, integrations, approvals, resource limits, and oversight cadence.

One proposed format keeps native Hermes settings at the root and places OMA-specific fields under `oma:`. This is a recommendation, not an implemented schema. The deployer must consume OMA fields and write native runtime configuration through supported interfaces.

There is no required predefined pipeline or static job graph. Scheduled obligations can exist without prescribing all tasks the coordinator will create.

Agent source configs declare an optional `jobs` list for scheduled Hermes cron prompts. See [Scheduled jobs](JOBS.md) for the configuration contract and examples. The SEO and social-media orchestrators each declare a standing-goal run every 10 minutes; the social-media interactor declares an integration-check-and-reply run every 5 minutes. Their native `cron.max_parallel_jobs: 1` limits cron concurrency per owning profile. Other agents retain `jobs: []`. The files alone do not register or run jobs. Provisioning must handle `jobs` as OMA metadata rather than copy it into native runtime config, and activation remains explicit.

### Mission and Operating Policy

Specify the desired outcome or standing service objective, evidence of progress, scope, allowed actions, approval requirements, and conditions for waiting, escalation, or stopping.

- `SOUL.md` defines identity, tone, and judgment.
- Skills teach domain work and orchestration strategy.
- Runtime policy enforces critical permissions and resource boundaries.

Prompts alone are not sufficient enforcement for publishing permission, spending limits, or infrastructure administration.

Separate skill provisioning from runtime availability. Shared source lives in the repository's top-level `skills/`; campaign-specific source lives in that campaign's `skills/` directory. `oma_skills` selects which OMA source skills to install into each agent: an empty list installs none, and omitted OMA source skills are not installed by the campaign. Do not add those omitted skills to `skills.disabled`; provisioning already determines their inclusion. Freeze the resolved source path and revision for each declared dependency before provisioning.

Agent configs list only `computer-use`, `hermes-agent`, and `oma-playbooks` under `skills.disabled`, without a `skills.enabled` allowlist. Hermes leaves its essential `hermes-agent` skill available. Agents do not use `skills.auto_load`; their `SOUL.md` tells them when to load each provisioned skill. Skill availability does not grant extra tools or permissions.

## 9. Dynamic Kanban Orchestration

Use **Hermes's built-in Kanban**, not a separate task database or dispatcher. Use one board per campaign deployment, rather than one board per periodic review.

The coordinator dynamically:

1. Reads its mission, current board, relevant integration signals, and prior results.
2. Checks for existing or equivalent work before creating tasks.
3. Creates well-scoped tasks with an assigned specialist and acceptance criteria.
4. Adds dependencies when the current work requires them.
5. Reviews handoffs and decides whether to request changes, create new work, escalate, or wait.

There is no hardcoded research-to-writing-to-publishing sequence. Research may justify writing, more research, a different action, or no action.

### Coordinator-Owned Planning

The coordinator has the Kanban toolset and uses its own configured persona and skills for planning.

Recommended native settings include `kanban.auto_decompose: false` and enabled creator-session wake-ups where supported. Disabling the built-in decomposer does not disable the coordinator's task-creation tools or event wake-ups.

The built-in automatic decomposer is a separate auxiliary-model path. Setting `kanban.orchestrator_profile` does not make that decomposition call use the coordinator's SOUL or specialist orchestration skills.

### Task Contracts and Results

Each task should carry a clear objective, assignee, required inputs, acceptance criteria, permission boundaries, and relevant execution limits.

Use Hermes's structured completion summaries, metadata, and durable artifacts for handoffs. Reference the particular task and result needed; do not rely on another profile's memory or an ambiguous latest-output file.

Dependencies belong to task IDs, not merely agent IDs. Create known dependencies before a child can be dispatched, and reject cycles. Dynamic planning does not remove the need for deterministic dependency enforcement.

A successful agent turn is not proof that an external action succeeded. Validate results and verify external writes. Retried mutations need idempotency or deduplication to avoid duplicate publications, messages, or charges.

## 10. Availability and Wake-Ups

**Always available does not mean always calling a model.** Keep the gateway running continuously and allow the coordinator to idle between meaningful events.

```text
User instruction -----------+
Task result or blocker -----+--> Coordinator turn
Integration event ----------+      Inspect -> Decide -> Act -> Wait
Periodic review ------------+
```

### Task Events First

Hermes supports creator-session wake-ups for tasks created through `kanban_create` in a persistent gateway/TUI session. With `kanban.auto_subscribe_on_create` enabled, task outcomes can resume the originating agent for evaluation and follow-up.

Explicitly configure and verify the owning session, subscription, and routing. Do not assume every task created through an external CLI automatically wakes the desired coordinator.

Treat notifications as signals, not the source of truth. Reconcile against the board after outages or missed delivery, and serialize coordinator admissions through the supported owner so events do not create competing decision loops.

### Heartbeat for Periodic Reconciliation

A session heartbeat periodically prompts the coordinator in its existing conversation. It is appropriate for reviewing unresolved blockers, due obligations, missed events, and meaningful changes to the mission's environment.

Heartbeats are idle-only and coalesce missed ticks. Gateway-owned heartbeats can recover after restart, but they still require the gateway to be running. They are session-scoped; resets or conversation switches can clear them. Bootstrap and lifecycle reconciliation must deliberately manage the coordinator session and its heartbeat.

The heartbeat instruction should require the coordinator to inspect existing work, avoid duplication and invented busywork, and remain silent when no action is justified. Its interval is a deployment policy, not a universal hardcoded value.

### Cron for Calendar Obligations

Use Hermes cron for explicit scheduled obligations such as a weekly review or daily report. Ordinary cron runs in a fresh isolated session; it does not implicitly continue the coordinator's conversation. Use an explicit supported delivery route when scheduled output should wake the coordinator.

Use script-only cron for deterministic checks or notifications that do not require reasoning. Do not build another scheduler merely to keep the coordinator available.

Persistent `/goal` continuation is useful for bounded active work. It is not the daemon lifecycle mechanism and should not become an unlimited busy loop for a standing mission.

## 11. Roster and Short-Lived Delegation

Generate the coordinator's roster from resolved definitions. Include each agent's ID, profile mapping, description, appropriate use, capability boundaries, and invocation mechanism.

Do not inject every specialist's full SOUL and configuration into the coordinator. Keep its roster stable within an active conversation and apply changes through the supported session lifecycle.

Kanban is the primary route for durable assigned work. For short reasoning subtasks, `delegate_task` may be useful. Selecting a specialist profile requires an explicit ID-to-profile route; the official `advanced-delegation` plugin documents `profile_routes` for this purpose.

Ordinary delegation does not automatically load an OMA definition by ID, and delegated execution remains process-local to its owner. Verify plugin availability before relying on profile-routed delegation. Only expose profiles whose capabilities the coordinator is authorized to use.

## 12. LiteLLM Budgets and Credential Boundaries

Start with one inference-only LiteLLM virtual key per deployment, shared by its coordinator and specialists. This provides a single deployment-level model-spend allowance.

Set explicit model access, budget and reset policy, request/token rate limits, concurrency limits, inference-route permissions, and ownership metadata. Do not accidentally confer key-management privileges through an administrator owner.

All intended model traffic, including auxiliary-model paths, must use the authorized LiteLLM endpoint. Do not leave an unmetered provider fallback on the VM.

Never provision the LiteLLM master key, upstream provider credentials, or cloud provisioning credentials to the agent VM. Keep secret values out of reusable definitions, images, progress responses, and logs; use protected secret storage and bootstrap delivery.

LiteLLM budget enforcement requires a database. Verify pricing and accounting for the selected models, including custom routes. Account for in-flight usage when designing strict customer credit limits rather than assuming a spend threshold is an exact prepaid reservation.

Per-agent keys can be introduced for attribution or limits, but they must remain under a shared deployment-level allowance rather than multiplying available credit.

LiteLLM limits model usage, not VM charges, storage, paid browser services, or external platform costs. Those need separate control-plane accounting and policies.

## 13. Lifecycle, State, and Recovery

An illustrative deployment state machine is:

```text
requested -> validating -> provisioning -> bootstrapping -> verifying -> ready
                                |
                                +-> failed -> cleanup_pending -> cleaned_up
```

The implementation also needs explicit suspension, resumption, upgrade, and deletion behavior. Each operation must record its progress and owned external resource IDs so retries can resume safely.

| State | Authority |
| --- | --- |
| Reusable definitions and campaign source | Versioned OMA files. |
| User entitlement, deployment ownership, and lifecycle | FastAPI control-plane database. |
| Frozen resolved specification and resource mappings | Deployment manifest/control-plane records. |
| Task dependencies, attempts, results, and current status | Hermes Kanban. |
| Cron registration and execution state | Hermes cron. |
| Model-key restrictions and model spend | LiteLLM, reconciled with OMA billing records. |
| Coordinator conversation and heartbeat state | Hermes session storage. |

Do not maintain an independent OMA task-lifecycle database that competes with Kanban. Additional records should hold deployment mappings, policy decisions, or application-level deduplication.

Required lifecycle behavior includes:

- **Provisioning failure:** revoke unused inference access and clean up owned infrastructure; report any incomplete cleanup.
- **Budget exhaustion:** reject further inference according to policy and surface status through the control plane. The coordinator may be unable to explain the problem because inference is unavailable.
- **Suspension:** prevent new work and explicitly handle running tasks; do not confuse suspending orchestration with stopping VM billing.
- **Deletion:** revoke credentials, terminate owned resources, and follow the declared retention policy for state and artifacts.
- **Restart:** recover the supervised gateway, coordinator session, heartbeat where applicable, and board reconciliation without blindly replaying external effects.
- **Upgrade:** preserve runtime state and credentials, validate the new definition/runtime revision, and activate through supported lifecycle boundaries.

Profiles isolate Hermes state, not the host operating system. The per-deployment VM supplies the main deployment boundary; specialist profiles inside it still require least-privilege filesystem, integration, and tool policies. Network access and administration endpoints must be explicitly secured.

## 14. Implementation Boundary and First Milestone

OMA should implement a definition resolver, deployment reconciler, lifecycle API/worker, credential and budget administration, and coordinator-session bootstrap. Use supported Hermes interfaces through a narrow adapter or plugin boundary; do not directly mutate private Kanban tables or build a replacement scheduler.

The first working milestone should demonstrate:

1. One deployment request producing one isolated VM and one scoped LiteLLM key.
2. The SEO coordinator running as Hermes `seo__orchestrator` and its researcher as `seo__researcher`.
3. A coordinator-created Kanban task executed by the specialist with a durable handoff.
4. A result waking the coordinator, which makes a new decision rather than following a predefined pipeline.
5. Idle behavior and a heartbeat reconciliation without duplicate or invented tasks.
6. Verified budget denial, restart recovery, retry-safe provisioning, and resource cleanup.

A powered-on VM or an accepted inference request alone is not sufficient proof of this milestone.

## 15. References and Verification Scope

- [Hermes profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)
- [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
- [Session heartbeats](https://hermes-agent.nousresearch.com/docs/user-guide/features/heartbeat)
- [Cron jobs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)
- [Persistent goals](https://hermes-agent.nousresearch.com/docs/user-guide/features/goals)
- [Delegation and profile routes](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
- [LiteLLM virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)
- [LiteLLM budgets](https://docs.litellm.ai/docs/proxy/users)

This document records the agreed architecture and the current definition names. It does not implement provisioning, alter live profiles or credentials, install plugins, or verify a deployed system. Runtime compatibility and each readiness criterion must be exercised during implementation.
