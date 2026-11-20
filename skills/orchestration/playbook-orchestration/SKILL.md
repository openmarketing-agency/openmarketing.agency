---
name: playbook-orchestration
description: Coordinate dynamic playbook work through durable tasks.
version: 0.1.0
author: Open Marketing Agency (OMA)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [orchestration, playbooks, kanban, coordination]
    related_skills: []
---

# Dynamic Playbook Orchestration

Operate a standing mission through native Hermes Kanban. Decide what work is justified from current evidence; do not compile or follow a predefined pipeline. This procedure governs planning, not deployment provisioning or a replacement scheduler.

## When to Use

- Admit a mission, a task result, a blocker, an integration event, or a due review into the owning coordinator session.
- Plan specialist work, inspect handoffs, reconcile after an interruption, or decide to wait.
- Do not use to grant permissions, provision infrastructure, or start an unlimited continuation loop.

## Prerequisites

- An authorized mission with scope, success criteria, autonomy limits, and pause/stop state.
- A deployment-bound Kanban board, installed specialist profiles, and a resolved roster with canonical agent IDs and permissions. Source agent directories and declared IDs already use `[playbook id]__[role id]`, such as `seo__researcher` or `social-media__interactor`; the Hermes profile name is that same ID, not another prefixed copy. Skill IDs remain independent and unchanged.
- Available `kanban` and `file` tools; use `read_file` for mission and artifact inspection. Discover the current `kanban_*` tool schemas before invoking them.
- Bootstrap owns the canonical session, task-event subscriptions, and policy-selected session heartbeat. A config or skill does not establish these runtime objects.

## Procedure

### 1. Reconcile before planning

Read the current mission and pause state. Use `kanban_list` and `kanban_show` on the bound board to inspect relevant active work, dependencies, blocked work, prior results, and durable artifacts. Match each event to its task and revision; a notification is a signal, not truth or a new request.

Deduplicate by mission, objective, input revision, and trigger occurrence. Check existing work before creating a card, including after retries, delayed events, and recovery. Never reopen delivered work solely because an old completion arrived.

**Complete when:** the current state and any meaningful change are known, or a missing prerequisite is explicitly reported.

### 2. Choose the smallest justified action

Compare evidence with mission success criteria. Decide to create bounded work, inspect an existing result, resolve a blocker, request authorization, wait, or stop. Parallelize only independent work with explicit inputs and nonconflicting artifacts. Do not generate busywork to fill an empty board.

For a standing improvement mission, own repeated planning without waiting for a new user assignment. Finishing a task or reaching one performance target does not terminate the mission unless its stop conditions say so. Apply recorded standing authorization without repeatedly asking permission for covered actions; escalate only actual policy gaps. If one capability is unavailable, continue independent useful work within the remaining authorized capabilities.

Use only the resolved profile roster. Missing capabilities or an unavailable specialist are blockers, not permission to delegate to an anonymous substitute or expand privileges. Keep durable work in Kanban; short profile-routed delegation is optional only when explicitly provisioned and authorized.

**Complete when:** every proposed task has a mission-relevant purpose and an authorized executor.

### 3. Create an executable task contract

Use `kanban_create` with the exact canonical profile ID from the roster in `assignee` (for example, `seo__researcher`, never bare `researcher` or `seo__seo__researcher`), a clear `title`, and a `body` containing:

- Objective, scope, and why this work is needed now.
- Exact input revisions, task/result references, and accessible artifact locations.
- Required output artifacts, checkable acceptance criteria, and evidence to return.
- Allowed actions, approval evidence or missing approval, and explicit prohibitions.
- Runtime or retry limits required by deployment policy.

Use a stable `idempotency_key` for retries of the same logical task, not a new random key. Supply known prerequisite task IDs in `parents` at creation so dependency gating exists before dispatch. Parent dependencies are upstream work that must finish first; do not make a specialist depend on a coordinator card waiting for that specialist. Never introduce a cycle.

Workers use separate workspaces by default. Supply supported explicit workspace settings when a shared directory is needed, or use durable attachments/artifacts that the assigned profile can actually read. Never pass coordinator-local relative paths as if they were shared memory. Read back the created card and dependency gate; inspect the returned subscription status and escalate absent wake-up routing rather than assuming it exists.

**Complete when:** the card is recorded on the correct board, assigned correctly, dependency-safe, and its inputs are accessible.

### 4. Inspect the result before choosing follow-up

Use `kanban_show` and `read_file` to inspect the exact result and artifacts against acceptance criteria. Agent exit success is not acceptance. Distinguish defects, missing evidence, genuine external blockers, and optional suggestions.

Record the decision and evidence through `kanban_comment`. Create a bounded corrective task when needed, or use supported block/unblock operations only after establishing their actual preconditions. Do not blindly retry an uncertain external mutation: first inspect its exact target for an already-applied effect. Task deduplication alone does not guarantee publication or message idempotency.

**Complete when:** the result is accepted within an explicit scope, returned for a specific correction, or blocked with an actionable reason and owner.

### 5. End the turn deliberately

Report meaningful decisions, task IDs, observed outcomes, and required user decisions briefly. Stop after justified work; remain silent on idle reconciliation when no action or alert is warranted. Honor intentional pause/stop state and do not reset it after recovery.

Use task outcomes as primary wake-ups and the existing session heartbeat for reconciliation. In hosted deployments, the control plane owns customer schedules/subscriptions; do not duplicate them in Hermes cron. Do not create recurring schedules or change heartbeat cadence without authority. A fresh cron session is not automatically the canonical coordinator conversation.

When the next decision depends on future data, persist its reason, earliest useful review time, expected evidence, and owning wake-up. Use a provisioned review schedule or an authorized scheduling interface and verify its registration; a timestamp in a note is not a working timer. If no wake-up can be arranged, report the activation gap instead of claiming the mission will resume automatically. Keep the mission active while waiting and recover outstanding reviews after outages without duplicating tasks or reviving an intentionally stopped mission.

**Complete when:** there is a bounded next event or explicit blocker, not an unbounded polling/model loop.

## Pitfalls

- Profile selection, skill availability, and source files do not prove installed routing or successful runtime execution.
- Do not force the auxiliary decomposer into coordinator-owned planning or maintain a second task-status database.
- Never place credentials in task bodies, comments, artifacts, or logs.
- A prose approval rule is not an enforced permission boundary; runtime policy must enforce critical permissions and budgets.
- Mission completion requires verified outcomes; an empty board or completed worker turns are insufficient.

## Verification

Before ending an active turn, confirm every new card has an authorized assignee, accessible inputs, acceptance evidence requirements, and safe dependencies; retries do not duplicate work; decisions cite inspected results; external effects have read-back evidence; and missing prerequisites, pause state, and idle behavior are respected. Do not claim event delivery, restart recovery, or mission success unless actually observed.
