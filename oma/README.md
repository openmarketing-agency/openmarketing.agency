# OMA application

This directory contains the Next.js console and API, the SQLite database schema, and the tests for the self-hosted workspace.

## Develop

From the repository root, run `make dev` for the full local stack or `make dev-console` to work on the console alone. Both commands watch console source changes. Open [http://localhost:3000](http://localhost:3000).

For native development, use Node.js 24 and npm. Run these commands from `oma/`.

```sh
npm ci
npm run dev
```

Optional settings go in `.env.local`, using [`.env.example`](.env.example) as a reference. Native development keeps `oma.sqlite` in `oma/data/` by default. The application creates the SQLite schema on first use. Existing schema version 3 installations can keep their database as they upgrade.

Run the check suite with:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

The database tests create isolated SQLite files in a temporary directory. First sign-in on the full stack opens agent setup, where the user provides a provider API key, an HTTPS base URL, and a shared reasoning effort for the built-in agents. The console forwards the key in both private agent sync requests. Hermes stores it with the profiles. Project setup at `/onboarding` accepts a website, a GitHub repository, or both. It saves the supplied links and forwards the questions and answers through the configured oma-agent gateway. Failed deliveries can be retried with the saved links. In development, loading `/onboarding-backup` directly or refreshing it resets the backed-up agent conversation so it can be tested again.

The right-side chat panel appears across the signed-in workspace. It shows live project setup progress and the gateway’s public updates, reported usage, and errors. The panel accepts responses to setup prompts and can retry failed or cancelled runs using the saved links. Chat history is loaded from Hermes and scoped to the workspace or current campaign.

## Console design system

Use the Radix-based shadcn/ui components in [`components/ui/`](components/ui/)
for console controls and surfaces. [`components.json`](components.json) configures
the registry aliases, and [`app/globals.css`](app/globals.css) maps the OMA palette
to Tailwind's component tokens. The registry components retain their
[upstream MIT license](components/ui/LICENSE). OpenUI campaign dashboards share
these colors through their existing dashboard theme.

On narrow screens, use **Open chat** to switch between the active workspace page
and its conversation. The conversation remains mounted so drafts and active
turns can continue while you review the page.

Brand knowledge and playbook strategy display saved Markdown as document sections. Use **On this page** to jump between sections when the document has multiple headings.

## Campaign publishing and approvals

Choose a publishing mode in the campaign’s **Settings**. **Approve** is the default and sends public posts and replies for review. **Control** pauses scheduled work and runs explicitly approved publications. **Yolo** runs automation and auto-approves new publication drafts. **Approvals** shows saved campaign publications with their account, content, media, and reply target. Approving a revision queues the campaign’s publisher agent on its Kanban board. The agent records the result against the reviewed revision. Publication reviews use the native workflow in oma-agent v0.1.20 through the private workspace socket.

Mode changes save to the campaign’s `config.yaml` and sync with the saved revision. Model and MCP changes include their API keys in the private sync request when applicable. The console waits for running campaigns to stop before sync and restarts them after success. Campaigns already stopped stay stopped when syncing settings.

## Generate analytics

Open a campaign’s **Analytics** tab and select **Generate dashboard**. oma-agent’s default profile receives the campaign ID and a sample from the last 28 UTC days, including the complete `value` JSON for every sampled record. Generation reads up to 100 recent records within a prompt size limit. It needs at least one saved observation in that window; without one, the console refuses to generate or regenerate and keeps any saved dashboard. The console offers live bindings for scalar measurements found in those records, including fields nested inside objects and arrays. The model uses them to build charts, KPIs, or tables. The console validates the program and saves it with its generation details in SQLite.

Select **Regenerate dashboard** to rebuild a saved layout from current observations, including after new sources or fields appear. The saved dashboard stays available if regeneration fails. Update both the console and VM service to use observation samples in generation.

OpenUI queries saved observations on load, when the 7- or 28-day UTC filter changes, and once per minute. **Refresh data** queues the campaign’s analyst and reloads the observations when the run settles. The collector also runs hourly for active campaigns. It upserts measurements in the campaign’s `data.sqlite3`. Filtered reads work while a campaign is paused. A partial collection can add observations while the last successful refresh time stays fixed.

This workflow requires oma-agent v0.1.24. Sync installed campaigns after upgrading to provision their analyst. Publication observations are collected automatically. Google Analytics 4 and Search Console also require source bindings and credentials in the analyst profile.

Open **Generation details** to inspect the saved prompts and OpenUI source. Existing OpenUI activity layouts keep their source and appear alongside the collected observations.

The session-authenticated console routes are `GET /api/campaigns/<id>/analytics`, `POST /api/campaigns/<id>/analytics/refresh`, and `GET /api/campaigns/<id>/analytics/status`. Reads accept source, account, metric, date bounds, and cursor filters. Send refresh requests without a body or query parameters and poll the status route after a `202`.

After editing the analytics component library, run `node --import tsx scripts/generate-analytics-spec.mjs` from `oma/` to update the server’s OpenUI schema.

## Use the API and connections

The first registration creates the installation's sole account. The nullable `users.onboarding_state` field stores the project setup and any saved agent onboarding transcript. Browser login stores one long-lived access token in an HTTP-only cookie. It lasts 30 days by default; set `OMA_ACCESS_TOKEN_LIFETIME_SECONDS` to change that. Signing out ends every session for the account. API clients send `username` and `password` as form fields to `/api/v1/auth/jwt/login`, then send the returned access token as `Authorization: Bearer <token>`. The bearer API and machine-readable OpenAPI document are available at `/docs` and `/openapi.json`.

Set `COMPOSIO_API_KEY` in the Docker environment to enable the Connections catalog and campaign MCP sync. A campaign’s visible integrations and MCP session both come from the saved YAML `integrations` list. List unique canonical IDs such as `discord` and `facebook`. Connect the suggested integrations from the campaign’s **Tools** tab, then select **Sync tools** to apply them. Use campaign chat to request changes to the list. Composio remains the source for account authorization and connection status. Workspace-level tool enablement is stored in the agent workspace’s `tool-selections.json`.

When upgrading from schema version 3, rebuild the console and VM together. The first tool view or action imports saved campaign, legacy specialist, and workspace selections. SQLite drops the old `tool_assignments` table after the agent workspace confirms the import. If the agent workspace is unavailable, the SQLite rows stay in place and the next tool request retries the import. The `/api/v1/tool-assignments` endpoints have been retired.

Authenticated custom MCP connections also require `OMA_INTEGRATION_ENCRYPTION_KEY`. Generate one with `openssl rand -base64 32 | tr '+/' '-_'` and back it up securely. Authenticated endpoints use HTTPS, with HTTP allowed for loopback endpoints.
