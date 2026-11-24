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

## Campaign publishing and approvals

Choose a publishing mode in the campaign’s **Settings**. **Approve** is the default and sends public posts and replies for review. **Control** pauses scheduled work and runs explicitly approved publications. **Yolo** runs automation and auto-approves new publication drafts. **Approvals** shows saved campaign publications with their account, content, media, and reply target. Approving a revision queues the campaign’s publisher agent on its Kanban board. The agent records the result against the reviewed revision. Publication reviews use the native workflow in oma-agent v0.1.20 through the private workspace socket.

Mode changes save to the campaign’s `config.yaml` and sync with the saved revision. Model and MCP changes include their API keys in the private sync request when applicable. The console waits for running campaigns to stop before sync and restarts them after success. Campaigns already stopped stay stopped when syncing settings.

## Generate analytics

Open **Analytics** on a campaign and select **Generate dashboard**. oma-agent’s default profile writes an OpenUI Lang program using aggregated task, scheduled job, and publication data. Its prompt includes the campaign ID.

The console validates the program and stores it in SQLite. OpenUI renders the charts and tables. The program’s read-only query loads current workspace metrics every minute and on **Refresh data**. The date filter changes the completed-task window between 7 and 28 days in UTC. Regenerating replaces the saved OpenUI program after validation. Dashboards created before the OpenUI change can be regenerated from the Analytics tab.

The live query reads each campaign’s configured Kanban board and latest result per scheduled job through `/workspace/campaigns/<id>/progress`. Publication counts cover the latest six records from `/workspace/campaigns/<id>/publications?limit=6`.

After editing the analytics component library, run `node --import tsx scripts/generate-analytics-spec.mjs` from `oma/` to update the server’s OpenUI schema.

## Use the API and connections

The first registration creates the installation's sole account. The nullable `users.onboarding_state` field stores the project setup and any saved agent onboarding transcript. Browser login stores access and refresh tokens in HTTP-only cookies. API clients send `username` and `password` as form fields to `/api/v1/auth/jwt/login`, then send the returned access token as `Authorization: Bearer <token>`. The bearer API and machine-readable OpenAPI document are available at `/docs` and `/openapi.json`.

Set `COMPOSIO_API_KEY` in the Docker environment to enable the Connections catalog and campaign MCP sync. A campaign’s visible integrations and MCP session both come from the saved YAML `integrations` list. List unique canonical IDs such as `discord` and `facebook`. A missing or empty list opens the Composio catalog directly in the campaign’s Tools tab. Use **Connect** from the catalog to authorize a shared account. Composio remains the source for account authorization and connection status. Workspace-level tool enablement is stored in the agent workspace’s `tool-selections.json`.

When upgrading from schema version 3, rebuild the console and VM together. The first tool view or action imports saved campaign, legacy specialist, and workspace selections. SQLite drops the old `tool_assignments` table after the agent workspace confirms the import. If the agent workspace is unavailable, the SQLite rows stay in place and the next tool request retries the import. The `/api/v1/tool-assignments` endpoints have been retired.

Authenticated custom MCP connections also require `OMA_INTEGRATION_ENCRYPTION_KEY`. Generate one with `openssl rand -base64 32 | tr '+/' '-_'` and back it up securely. Authenticated endpoints use HTTPS, with HTTP allowed for loopback endpoints.
