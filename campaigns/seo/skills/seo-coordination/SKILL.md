---
name: seo-coordination
description: Autonomously improve SEO through measured changes.
version: 0.1.0
author: Open Marketing Agency (OMA)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [seo, content, editorial, coordination]
    related_skills: [playbook-orchestration]
---

# SEO Mission Coordination

Own a standing SEO-improvement mission: observe the site and market, form hypotheses, execute permitted changes, verify delivery, measure outcomes, and choose the next action without waiting for per-task user instructions. These are decision responsibilities, not a mandatory specialist pipeline. Optimize for useful, accurate content aligned with the client's audience and offering, not task count.

## When to Use

- Prioritize content opportunities or improvements from research, analytics, or a client brief.
- Decide whether to commission research, writing, editing, verification, or an authorized CMS operation.
- Evaluate a content handoff, publication outcome, or a due performance review.
- Do not use to promise rankings, fabricate demand, or bypass approval and rights checks.

## Prerequisites

- Use the supplied mission: client/site, audience, offering, geography, language, success criteria, brand constraints, and authorized actions. Ask only for materially missing information.
- Apply `playbook-orchestration` for board reconciliation, task contracts, dependencies, idempotency, wake-ups, and idle behavior.
- Resolve the deployed roster before assignment. The coordinator is `seo__orchestrator`; its specialist roster is `seo__researcher`, `seo__writer`, `seo__humanizer`, `seo__verifier`, and `seo__publisher`. Source directories, declared agent IDs, and Hermes profile names use these same canonical IDs. Do not add the playbook prefix again; names alone do not install profiles or integrations.
- Search, analytics, keyword tools, asset inspection, and CMS access are deployment-specific. Missing access must remain visible.

### Capability discovery and standing authority

Discover the actual connected tools and their schemas before planning. Establish which capabilities can read Search Console, inspect site pages, research trends/keywords, read analytics, and modify the site. The coordinator may use tools directly or assign work to an authorized specialist; do not assume that a specialist inherits the coordinator's integration access.

Record the exact target site, Search Console property, and integration-to-profile mapping. Use configured integrations rather than inventing tool names, assuming a provider is connected, or requesting extra access for its own sake. If Search Console is unavailable, report the gap and continue independent research or site improvements; do not fabricate performance data or keep retrying unchanged access failures.

Read the standing action policy once and attach its reference to covered tasks. Routine changes permitted by that policy proceed automatically after required checks, without fresh human approval each time. Stop only the affected action for a missing approval, not the whole mission. Tool availability and read access do not imply write authority.

## Procedure

### 1. Establish the decision and baseline

Read the client's objective and current board/results before commissioning work. Inspect supplied site/content inventory and authorized analytics when relevant. Identify the audience need, target intent, existing coverage, meaningful business outcome, and what evidence could change the decision.

Distinguish a measurable performance target from a guarantee. Record observation period, geography, channel, and source for baseline metrics. If unavailable, define the missing measurement rather than inventing it.

When Search Console is connected, inspect the authorized property's query and page performance: clicks, impressions, click-through rate, and average position, with relevant country, device, and search-type dimensions. Read the tool's actual filtering, pagination, aggregation, and data-freshness behavior. Do not treat an incomplete recent period as a confirmed traffic loss, sum incompatible aggregates, or interpret an absent query as zero demand. Compare like-for-like complete periods and note seasonality, brand/non-brand intent where supported, and changes in page/query mix.

Combine observed opportunities such as declining useful pages, relevant queries with impressions but weak click-through, and content gaps with fresh trend and keyword evidence. Confirm the page and intent before diagnosing a title, coverage, internal-linking, or technical problem. Search Console performance is one signal, not proof of a specific cause or guaranteed impact.

**Complete when:** the editorial decision, success criteria, and material constraints are explicit.

### 2. Select work from evidence

Use this roster as a capability map, not a stage order:

| Specialist ID | Appropriate assignment | Boundary |
| --- | --- | --- |
| `seo__researcher` | Markets, competitors, trends, keyword clusters, intent, and cited opportunity briefs. | No invented search metrics or automatic downstream assignments. |
| `seo__writer` | Editable source-backed draft or revision with metadata from an explicit brief. | No publication. |
| `seo__humanizer` | Improve voice and readability of an identified draft. | Preserve facts, citations, intent, and disclosures. |
| `seo__verifier` | Independently inspect specified claims, content revision, assets, rights evidence, and preview. | Verification is not publishing approval. |
| `seo__publisher` | Authorized CMS draft, update, schedule, or publish operation for an exact revision. | No strategy changes, self-approval, or implied live-publication permission. |

Choose only work justified now. Research may justify more research, updating an existing page, a draft, or no action. Humanization is optional; never add it merely to satisfy a sequence. Prefer updating relevant existing coverage over creating near-duplicates when evidence supports that choice.

For keyword opportunities, distinguish measured volume, normalized trend interest, impressions, and qualitative hypotheses. Require sources, dates, locale, intent, client relevance, and uncertainty. Do not rank opportunities using invented numeric scores or promise traffic gains.

**Complete when:** each selected task explains the evidence gap or desired outcome it resolves.

### 3. Write the brief and review the handoff

Include audience, purpose, intent/keyword cluster when relevant, scope, content angle, source references, brand voice, required format/metadata, assets and rights evidence, and acceptance criteria. Identify the input revision and expected editable output location.

Read the actual output and supporting sources using `read_file` and available retrieval tools. Check whether the work answers the brief, preserves evidence, and avoids unsupported claims, duplicate coverage, keyword stuffing, and misleading titles. Assign corrections to the responsible specialist; do not silently certify a changed artifact as the reviewed revision.

**Complete when:** the artifact is accepted for its stated purpose or a specific defect/blocker is recorded.

### 4. Gate consequential CMS work

Before assigning publication, scheduling, or a consequential live update, require:

1. Exact destination site/account, content revision, asset set, metadata, and requested state.
2. The verifier's report for that revision with required checks completed and no unresolved blocking findings or rights gaps, unless an authorized policy exception is explicitly recorded.
3. Recorded permission for the action under deployment policy, including human approval when required. A completed verification task or coordinator preference is not authorization.
4. An existing-object mapping or stable operation identity to prevent duplicate writes after a retry.
5. For schedules, an explicit date, time, timezone, and intended behavior; scheduling failure must not fall back to immediate publication.

If facts, meaning, assets, or disclosures change after verification, obtain the affected checks again and renew approval where policy binds it to a revision. Do not queue a live mutation behind a still-undecided approval; wait or create a clearly blocked approval request instead.

Standing authorization can cover routine publishing and updates; reference it rather than requesting a new human approval for each covered revision. Required verification still applies. Keep risky actions such as URL changes, redirects, deletion, indexing directives, and sitewide templates outside routine authority unless explicitly granted. Do not assign unsupported technical changes to a content specialist merely because the current roster has no technical executor.

Before a change, preserve a recoverable prior revision or supported CMS history reference and record the hypothesis, target URL, intended modification, baseline, policy reference, success/guardrail measures, and expected observation window in durable task artifacts. Verify delivery immediately through exact-target read-back, then assess SEO impact later. If a change causes an observed functional defect, revert within authorized rollback policy or escalate promptly; do not wait for search metrics to reveal it.

Require the publisher to read back the exact CMS object after writes and inspect the public URL when publication is requested and accessible. An accepted API call, saved draft, scheduled post, and live public post are different outcomes.

**Complete when:** only authorized, revision-bound work is dispatched and its observed external state is recorded—or the gate remains explicitly blocked.

### 5. Evaluate results without manufacturing work

Maintain a durable change-and-observation journal keyed to tasks and exact URLs/revisions. Include applied time, baseline and comparison periods, verification receipts, review-due time, observed metrics, limitations, and the next decision. Avoid repeatedly editing the same page before the previous change has an interpretable observation window unless a defect or new material evidence justifies it. Separate trend/keyword monitoring cadence from slower change-impact evaluation; do not bake one universal SEO waiting period into every hypothesis.

At a due review, retrieve fresh authorized data, compare equivalent periods against the recorded baseline and relevant guardrails, and decide whether to retain, improve, revert within policy, investigate, or wait longer. Distinguish indexing, impressions, clicks, position, conversions, and business outcomes; do not attribute causality from a single change or short window. Treat inconclusive evidence as inconclusive, not success or failure.

Use the deployment's centrally owned recurring reviews and relevant task/integration events to revisit the mission. Through an authorized scheduling interface, request a missing review or follow-up and verify its registration; do not create competing local subscriptions. Record the next useful review and continue other independent justified work while waiting. Completing a batch is not completion of the standing goal: keep choosing the next useful action until paused, stopped, or superseded, subject to budget and policy.

**Complete when:** the current turn ends with an evidence-driven next action, a persisted review with an actual wake-up owner, or a named blocker; the standing mission remains active unless explicitly ended.

## Pitfalls

- Do not confuse popular queries with relevant customer demand or treat missing metrics as zero.
- Source access, fact checking, asset rendering, rights clearance, approval, and CMS delivery are separate gates.
- Publicly visible images are not automatically licensed; generated visuals are not evidence of real events.
- A later revision cannot inherit an obsolete verification or approval by filename alone.
- Do not claim ongoing monitoring or an eventual scheduled publication without an actual configured owner and observed result.

## Verification

Confirm that task priorities follow the mission rather than a fixed chain, metrics are sourced or marked unknown, specialist handoffs identify exact revisions, required verification and approval precede consequential CMS work, and publisher evidence distinguishes saved, scheduled, and public states. Report missing analytics, source access, rights, approval, or integration capabilities plainly.
