# Open Marketing Agency

OMA is a self-hosted workspace for marketing campaigns and tool connections. The full stack includes the Next.js console, OMA Agent (Hermes), and `omactl` with its app catalog and Traefik. The VM no longer preinstalls repository campaign templates or skills. Existing workspace records and profiles are kept, and OMA Agent still supplies its own starter profiles and skills.

New to the codebase? See the [architecture and workflow diagrams](docs/architecture.md).

## Run the full stack locally

Use Docker Engine with Compose 2.24.4+ on a Linux host or VM that supports privileged containers and nested Docker. Source builds follow the Docker engine's native architecture (`linux/amd64` or `linux/arm64`); leave `DOCKER_DEFAULT_PLATFORM` unset to use that default. No model API key is needed to start. To supply OpenRouter credentials at startup, set `OPENROUTER_API_KEY` in a private `.env` using [`.env.example`](.env.example) as a reference. If you already have a private environment file elsewhere, set `COMPOSE_ENV_FILES` to its path, then start the stack from this checkout.

```sh
make dev         # Console hot reload, the full runtime, and Camofox
make production  # Production console build and the full runtime without Camofox
```

The default OpenRouter model is [GPT-4.1 Mini](https://openrouter.ai/openai/gpt-4.1-mini). Set `OMA_HERMES_MODEL` in the environment file to choose a different initial model. Enter your provider key in the console after signing in. For direct Hermes use, credentials are also managed in [Hermes Dashboard → Keys](http://localhost:9119/env). OpenRouter inference still requires a valid key and network access. Set `OMA_INIT_CATALOG=0` to start Hermes without initializing the optional app catalog.

Create the installation's single account at [http://localhost:3000/register](http://localhost:3000/register). On the first sign-in after setup is enabled, enter the provider, model, HTTPS base URL, and API key, and choose a shared reasoning effort. After both agents sync, enter your project website, GitHub repository, or both. The console saves the links in SQLite and sends the questions and answers to oma-agent. If the agent connection is unavailable, retry from project setup. You can skip setup and go straight to Campaigns. Existing accounts can open project setup from Campaigns. The signed-in [agent onboarding backup](http://localhost:3000/onboarding-backup) retains the previous conversation flow. Sign in again at [http://localhost:3000/login](http://localhost:3000/login). The Hermes dashboard is on port `9119`, its authenticated gateway is on `8642`, and optional catalog apps route through Traefik on `18080`. Compose initializes the catalog. Use these commands to verify it and start a local chat:

```sh
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm omactl doctor
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm hermes chat
```

On [Campaigns](http://localhost:3000/dashboard), **Agent activity** shows live public messages from the signed-in account’s project setup run. It shows output or reasoning token totals when the gateway reports them. If project setup fails, Agent activity shows the reported cause when it recognizes one. Choose **Retry setup** after a failure or cancellation to start a fresh attempt with the saved links.

Open [Chat](http://localhost:3000/chat) to talk with oma-agent’s default profile. The full stack supplies its gateway address and default-profile key automatically. The Hermes dashboard and CLI also remain available. Use **Chat history** to reopen a saved conversation and **New chat** to start another. The workspace Chat page and each campaign have separate histories in oma-agent. The console loads transcripts from the Hermes Sessions API.

Open **Settings → Default and maintenance agents** to change the model or provider base URL, rotate the API key, or set the shared reasoning effort. The console writes `agent.reasoning_effort` to both saved records and syncs it to their Hermes profiles. **Provider default** leaves effort selection to Hermes and the model, while **None** asks Hermes to disable reasoning. The console forwards a submitted API key to both profiles over the private workspace socket. Hermes stores it in each profile’s credential file. The YAML uses a `model.api_key` reference such as `${OPENROUTER_API_KEY}`. The console needs no key in its `.env`. Start a new chat after changing the model or reasoning effort.

Set `OMA_HERMES_CLARIFY_TIMEOUT=0` in `.env` to let the default profile wait indefinitely for an answer in the agent onboarding backup. A positive value sets the wait in seconds. Leaving the variable unset keeps the profile's saved setting, which defaults to 90 seconds on a fresh installation. Recreate the VM container after changing the value.

Use [Campaigns](http://localhost:3000/dashboard) in the console to configure campaign tool selections and MCP connections. The campaign list and detail page show the saved lifecycle state and Kanban task counts. The console reads counts on page load from the board identified by `kanban_board` in `campaigns/<id>/config.yaml`. Older configs with only `kanban_board_name` can use a unique board name. The VM queries the authenticated Kanban dashboard API on loopback and sends the console only the task counts. Composio is optional and requires an API key for its hosted tool catalog.
A campaign’s **Tools** tab shows the `integrations` list from its saved `campaigns/<id>/config.yaml`. Choose **Composio catalog** to search for toolkits from the same tab. The catalog opens directly when the campaign has no configured integrations. Its **Connect** button authorizes a shared workspace account and returns to the campaign catalog. The campaign uses the integrations in its saved list. Use unique canonical oma-agent IDs as strings, for example `integrations: [discord, facebook]`. The agent maps those IDs to Composio toolkits, such as `x` to `twitter` and `google-analytics` to `google_analytics`. Write `integrations: []` or omit the field when the campaign needs no integrations. Connect each configured account before syncing. The workspace-wide **Tools** page remains available for managing shared accounts.

A campaign uses the default agent’s model when its model fields are blank. Deploying or syncing the campaign applies the default profile’s saved model and credential to agents that inherit it. Open a campaign’s **Settings** to enter an override or select **Use default agent model** to clear it. Use a provider supported by oma-agent, or `custom` for an OpenAI-compatible endpoint. Enter the campaign’s API key with the HTTPS base URL when the override needs its own credential. Composio generation uses `COMPOSIO_API_KEY`.

**Save and sync** creates a Composio connection from the campaign’s configured integrations. It then writes the model and generated MCP URL to `campaigns/<id>/config.yaml` in the mounted workspace and uses the private `POST /workspace/campaigns/<id>/sync` endpoint to update installed campaign profiles. For bundled campaigns created by earlier Docker images, the first sync creates the campaign board and adds missing routing to the existing profiles. Saving a campaign with no configured integrations clears its generated Composio connection. YAML stores only key references. The model and MCP settings support per-agent overrides. Rebuild and recreate the console and VM after updating the stack.

The campaign chat stays open on the right as you move between campaign sections. Use it to discuss the plan or request changes. Every message is sent to oma-agent’s default profile with the saved campaign ID.

With a compatible agent image, trusted local processes can edit `/opt/data/oma/agents/{default,maintenance}/config.yaml` and then call `POST /workspace/agents/<id>/sync` over the private workspace Unix socket with JSON `{}` or `{"revision":"<sha256 of saved YAML>"}`. To apply an API key with a staged provider selection, include `"env": {"HERMES_MODEL_API_KEY": "<provider API key>"}` alongside the exact saved revision. The endpoint applies the saved model and reasoning settings. Trusted socket callers can also supply named profile credentials explicitly in `env` for agent or campaign sync. Values are passed to the native sync process over standard input. `409` means the saved file changed before it could be applied.

Use **Deploy and start** to sync the campaign’s MCP connection and optional model override, deploy the campaign, then request `PUT /workspace/campaigns/<id>/lifecycle` with `{"state":"resumed"}`. A draft’s sync validates settings before deploy creates its board and agent profiles and applies those settings. Installed campaigns reuse their board and profiles. The lifecycle endpoint also accepts `{"state":"paused"}`. If oma-agent cannot verify a required integration, the campaign stays paused and the console shows which integration needs attention.

Trusted local callers can also pause or resume with `PUT /workspace/campaigns/<id>/lifecycle`. A `202` response with `state: pausing` means work is still stopping. A response with `missingIntegrations` lists required accounts that must be connected before resume. Send the current `revision` to guard a lifecycle change against concurrent edits.

In **Approvals**, review the exact publication revision, account, content, attachments, and reply target. The console reads `GET /workspace/campaigns/<id>/publications` with optional `before` and `limit` query parameters. The private `POST /workspace/campaigns/<id>/publications/<publication-id>/approve` endpoint receives the reviewed revision and the signed-in operator's ID, then queues the publisher. A stale revision returns `409`.

The full stack shows brands, playbooks, campaigns, and agent records from the default oma-agent profile's `/opt/data/oma/` directory. Current agent versions save the shared brand and playbook in `brand/config.yaml` and `playbook/config.yaml` under that directory. Brand pages render file-backed knowledge, research and documentation, channels, palette, and supported logo previews from the workspace. Campaign overviews show the shared brand and playbook, goals, plans, and saved agents. Open a campaign’s **Agents** tab to see the team, assigned models and tools, and scheduled work. Select an agent to open its profile. Brand details and playbook strategy edits update their YAML. Brand knowledge edits update the referenced Markdown file when the brand declares one. The dashboard lists campaigns once oma-agent has saved them.

The console serves [API documentation](http://localhost:3000/docs) and a [database readiness endpoint](http://localhost:3000/health/ready).

The console and bundled agent both run under Docker. Quitting Docker Engine stops both. Run `make dev` or `make production` to start them together again. Press Ctrl+C in the `make dev` terminal, or run `docker compose -f compose.yaml -f compose.vm.yaml down`, to stop the full stack. Use the same environment file for Compose commands. The console stores SQLite and its signing key in `.oma-data/`. The VM volume holds Hermes profiles, gateway keys, the nested Docker engine, and catalog app data. Stop the stack before taking filesystem backups. Keep a secure copy of any configured signing or integration encryption keys.

### Camofox browser sidecar

Camofox runs on the private Compose network and has no published port. `make dev` uses `openssl` to generate `.env.camofox` on first run and reuses it on later runs. Keep this file private. A `CAMOFOX_API_KEY` set in the shell or your regular Compose environment file takes precedence over the generated key.

To run Camofox with the production console build, use the overlay explicitly. If `.env.camofox` doesn't exist yet, generate it first. Add `--env-file .env` after `--env-file .env.camofox` if you also use a root `.env` file:

```sh
mkdir -p -m 700 .oma-data
if [ ! -f .env.camofox ]; then
  (set -Ce; umask 077; key=$(openssl rand -hex 32); printf 'CAMOFOX_API_KEY=%s\n' "$key" > .env.camofox)
fi
docker compose --env-file .env.camofox -f compose.yaml -f compose.vm.yaml -f compose.camofox.yaml up --build -d --wait
```

Before starting Hermes, the VM writes `CAMOFOX_URL=http://camofox:9377` and `CAMOFOX_API_KEY` to the mounted Hermes home: `/opt/data/.env` for `default` and `/opt/data/profiles/maintenance/.env` for `maintenance`. It preserves unrelated entries. The key is required for Camofox API requests other than health checks and is not sent to Next.js. This runs the upstream browser image separately; it does not bundle the browser into the Apache-2.0 OMA image.

### Console only

```sh
mkdir -p -m 700 .oma-data
docker compose up --build -d --wait
```

Use `make dev-console` for hot reload with just the console. See the [application development guide](oma/README.md) for native Node.js development. For development on your LAN, set `OMA_BIND_ADDRESS` to the Mac or server’s specific LAN IP and set `OMA_APP_URL` to the address you open in your browser. Restart the console after changing these settings.

To use Chat with an existing Hermes gateway, set `OMA_AGENT_URL` to an address reachable from the console and set `OMA_AGENT_API_KEY` to the gateway’s `API_SERVER_KEY`. On Docker Desktop, for example, use `http://host.docker.internal:8642` for a gateway on your host. For native development on the same machine, use `http://127.0.0.1:8642` in `oma/.env.local`. Keep the gateway private and recreate the console after changing its environment. The gateway needs the [Hermes Runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#post-v1runs).

## Self-host on a bare-metal server

On an x86-64 Linux host, download `oma-vm-<tag>-linux-amd64.tar.gz` and `SHA256SUMS` from the same [OMA release](https://github.com/openmarketing-agency/openmarketing.agency/releases). Replace `vX.Y.Z` below with that release tag:

```sh
sha256sum -c SHA256SUMS
tar -xzf oma-vm-vX.Y.Z-linux-amd64.tar.gz
cd oma-vm-vX.Y.Z-linux-amd64
install -m 600 .env.example .env
# Optional: set OPENROUTER_API_KEY in .env, or configure it in Hermes after startup.
sudo bash install.sh
```

The installer adds Docker and Compose on a fresh Ubuntu 24.04 server and starts the prebuilt console and VM. On other x86-64 Linux systems, install Docker Engine and Compose 2.24.4+ before running it. The installer uses the `oma` Compose project and named volumes. To upgrade, verify and extract the new package, bring over the private `.env`, and run its installer. Use the existing Docker context so the installation retains its volumes.

The services bind to loopback by default. Use an SSH tunnel to port `3000` to create the account. For public HTTPS access to the console, set `OMA_APP_URL` to your HTTPS origin, set `OMA_COOKIE_SECURE=true` in the package's `.env`, and rerun the installer behind your reverse proxy. Keep the Hermes gateway and dashboard private.

Run `sudo docker exec --user hermes oma-vm-1 omactl doctor` to check the installed VM.

## Run the VM image on a VM provider

The [release](https://github.com/openmarketing-agency/openmarketing.agency/releases) includes a pinned digest for the standalone `linux/amd64` agent image. Import that digest into a disposable Agent37 VM template, mount persistent storage at `/opt/data`, keep the image entrypoint, and set the default port to `8642`. Set `OPENROUTER_API_KEY` for OpenRouter, or supply `OMA_LITELLM_URL` and `OMA_LITELLM_KEY` for an existing OpenAI-compatible endpoint that serves the `oma-hermes` alias. Set `OMA_HERMES_MODEL` to override the selected model. Set a unique `OMA_HERMES_GATEWAY_SEED` when deriving bearer keys outside the VM. A profile's key is the hex HMAC-SHA-256 of its ID, or `default`, using that seed. Verify a chat turn and restart the VM before updating a live template. [Agent37 custom images](https://www.agent37.com/docs/agents-api/custom-image)

To build and smoke-test the standalone image from this checkout:

```sh
docker build -f vm/Dockerfile -t oma-vm:local .
bash vm/tests/smoke.sh oma-vm:local
```

On AMD64, the VM build verifies and installs the pinned [omactl](https://github.com/openmarketing-agency/omactl) release package. On ARM64, it compiles the same pinned version and bundles its catalog. The prebuilt bare-metal release remains AMD64-only.

## Release

Push a `vX.Y.Z` tag in this repository to build and test both images, publish them to GHCR, and attach the installer and checksum to the GitHub release. Set the two GHCR packages to public after the first publish so the installer can pull them anonymously.

OMA is distributed under the [Apache License 2.0](LICENSE). Individual skills may include their own license notices.
