# OMA OSS workspace redesign research

This brief documents the OSS repository’s workflows, the market patterns that informed the redesign, and the decisions behind the campaign-first console. It focuses on one self-hosted installation and its single workspace account.

## Project and user journeys

OMA connects a Next.js console to an oma-agent workspace. SQLite stores the installation account, setup state, and integration records. The agent workspace supplies campaigns, brands, playbooks, and profiles. Campaigns bundle a plan, agent roles, model settings, and selected tools. The Approval preview uses sample drafts with browser-local edits and decisions. [Project README](../README.md) · [Application guide](README.md)

| Journey | First question | Success condition |
| --- | --- | --- |
| Install and set up | Which project source can I give the agent? | Add a website, a repository, or both, and see what to do if delivery fails. |
| Find and prepare a campaign | What work is saved, and what can I deploy? | Open the relevant campaign, understand its goals or current state, and inspect the saved plan. |
| Configure access | Which accounts are shared, and which tools can this campaign use? | Connect an account once, then assign the right tools from the campaign. |
| Review and chat | Which draft needs a decision, and where does the assistant act? | Find a sample draft in the preview, or open the default agent’s conversation and see when the gateway is unavailable. |

The baseline protects the workspace behind sign-in and keeps four destinations visible on mobile. It uses saved workspace records, with a separate legacy redirect for old playbook links. The desktop frame repeated navigational context above each title. Campaign setup, agent activity, and saved campaigns competed for focus, while the disconnected tool view still showed a search box with nothing to search. Keep the direct routes and simplify the hierarchy inside each view. [Baseline console](https://github.com/openmarketing-agency/openmarketing.agency/tree/8a94567/oma)

## Comparable products

| Reference | Observed pattern | OMA design decision |
| --- | --- | --- |
| AirOps | Organizes marketing workflows around action and shared context. Brand Kits keep reusable brand information near the work that depends on it. [Product documentation](https://docs.airops.com/) · [Brand Kits](https://docs.airops.com/context) | Bring the saved campaign plan forward and link its underlying brand, playbook, and agents as context. |
| Planable | Groups drafts by review state, filters the queue, and opens a selected item in a dedicated preview. [Approval queue](https://help.planable.io/hc/en-us/articles/28555055158044-Reviewing-content-in-My-approvals-section) · [Filters](https://help.planable.io/hc/en-us/articles/21715472675612-Filter-posts) | Retain readable status labels and the campaign/status filters. Make the browser-local sample scope visible before a user opens a draft. |
| Asana | Gives reviews distinct outcomes and makes each item’s status visible in lists and detail views. [Approvals](https://help.asana.com/s/article/approvals) | Put the review state beside the draft title and keep the related editing and decision controls within the draft. |
| Zapier Agents | Guides configuration of a specific agent and explains when a connected app is needed. [Agent setup](https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents) | Distinguish workspace account access from a campaign’s saved tool selection. Keep setup instructions where the provider is needed. |
| Relevance AI | Names the agent or workforce in the conversation and makes individual responsibilities visible. [Workforces](https://relevanceai.com/docs/get-started/core-concepts/workforces) · [Agent chat](https://relevanceai.com/docs/get-started/chat/using-agents) | Show which profile Chat uses and retain role labels in the campaign roster. |
| Vercel | Leads with deployments and their status, then puts detailed operations with an individual deployment. [Deployments](https://vercel.com/docs/deployments) | Keep campaign readiness visible in the index and review the saved plan, model, tools, and agents together before deploying. |

## Interface direction

- Keep Campaigns as the signed-in landing page. Give setup or recovery a clear action and make a saved campaign’s state easy to scan. Offer connected records and live agent activity alongside the campaign list.
- Use the same section names for campaign navigation at desktop and phone widths. Preserve bookmarks for older playbook and campaign views. Keep plan editing and deployment preview connected to the saved campaign.
- Use the existing IBM Plex typography with limestone surfaces, evergreen actions, and quiet rules. Reserve the dark field for high-priority setup context. Preserve the four persistent mobile destinations and allow content to scroll clear of the bottom bar.
- Distinguish genuinely empty lists, zero search matches, and unavailable providers. Keep focus visible and return it to the relevant filter when clearing a query. [Carbon empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

This is a qualitative comparison based on primary product documentation and an inspection of the OSS application. No usage analytics or participant testing informed this work. Local verification covers setup, saved campaign review, draft filtering, navigation, and responsive states using isolated data. Live provider behavior depends on the installation’s configuration.
