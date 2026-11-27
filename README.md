# Open Marketing Agency

OMA is a self-hosted workspace for marketing campaigns and tool connections. The full stack includes the Next.js console, OMA Agent (Hermes), and `omactl` with its app catalog and Traefik. The VM no longer preinstalls repository campaign templates or skills. Existing workspace records and profiles are kept, and OMA Agent still supplies its own starter profiles and skills.

New to the codebase? See the [architecture and workflow diagrams](docs/architecture.md).

## Run the full stack locally

Use Docker Engine with Compose 2.24.4+ on a Linux host or VM that supports privileged containers and nested Docker. Source builds follow the Docker engine's native architecture (`linux/amd64` or `linux/arm64`); leave `DOCKER_DEFAULT_PLATFORM` unset to use that default. No model API key is needed to start. To supply OpenRouter credentials at startup, set `OPENROUTER_API_KEY` in a private `.env` using [`.env.example`](.env.example) as a reference. If you already have a private environment file elsewhere, set `COMPOSE_ENV_FILES` to its path, then start the stack from this checkout.

```sh
make dev         # Console hot reload, the full runtime, and Camofox
make production  # Production console build and the full runtime without Camofox
```

When the VM restarts, the workspace service retries campaign pauses already in progress. Compose keeps each project's VM hostname stable so Hermes can recognize and release stale worker claims from that VM.

The default OpenRouter model is [GPT-4.1 Mini](https://openrouter.ai/openai/gpt-4.1-mini). Set `OMA_HERMES_MODEL` in the environment file to choose a different initial model. Enter your provider key in the console after signing in. For direct Hermes use, credentials are also managed in [Hermes Dashboard → Keys](http://localhost:9119/env). OpenRouter inference still requires a valid key and network access. Set `OMA_INIT_CATALOG=0` to start Hermes without initializing the optional app catalog.

Create the installation's single account at [http://localhost:3000/register](http://localhost:3000/register). On the first sign-in after setup is enabled, enter the provider, model, HTTPS base URL, and API key, and choose a shared reasoning effort. After both agents sync, enter your project website, GitHub repository, or both. The console saves the links in SQLite and sends the questions and answers to oma-agent. If the agent connection is unavailable, retry from project setup. You can skip setup and go straight to Campaigns. Existing accounts can open project setup from Campaigns. The signed-in [agent onboarding backup](http://localhost:3000/onboarding-backup) retains the previous conversation flow. Sign in again at [http://localhost:3000/login](http://localhost:3000/login). The Hermes dashboard is on port `9119`, its authenticated gateway is on `8642`, and optional catalog apps route through Traefik on `18080`. Compose initializes the catalog. Use these commands to verify it and start a local chat:

```sh
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm omactl doctor
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm hermes chat
```

Chat stays open on the right on desktop. On narrower screens, use **Open chat** to switch to the conversation. **Agent activity** in the panel shows project setup status, public agent messages, and reported token counts or errors. Answer setup prompts in the panel or choose **Retry setup** after a failure or cancellation to start a fresh attempt with the saved links.

The panel uses oma-agent’s default profile. The full stack supplies its gateway address and default-profile key automatically. Use **Chat history** to reopen a saved conversation and **New chat** to start another. The workspace and each campaign have separate histories in oma-agent, which the console reads through the Hermes Sessions API. Existing links to the former chat page open the panel on Campaigns. While oma-agent is working, use **Send guidance** to steer the current turn at its next tool boundary. If the turn cannot accept the message or finishes before using it, the composer keeps the guidance available as a follow-up.

Open **Settings → Default and maintenance agents** to change the model or provider base URL, rotate the API key, or set the shared reasoning effort. The console writes `agent.reasoning_effort` to both saved records and syncs it to their Hermes profiles. **Provider default** leaves effort selection to Hermes and the model, while **None** asks Hermes to disable reasoning. The console forwards a submitted API key to both profiles over the private workspace socket. Hermes stores it in each profile’s credential file. The YAML uses a `model.api_key` reference such as `${OPENROUTER_API_KEY}`. The console needs no key in its `.env`. Start a new chat after changing the model or reasoning effort.

Set `OMA_HERMES_CLARIFY_TIMEOUT=0` in `.env` to let the default profile wait indefinitely for an answer in the agent onboarding backup. A positive value sets the wait in seconds. Leaving the variable unset keeps the profile's saved setting, which defaults to 90 seconds on a fresh installation. Recreate the VM container after changing the value.

Use [Campaigns](http://localhost:3000/dashboard) to open a campaign. Its **Progress** tab shows Kanban tasks by status, with assignees, blockers, run attempts, and results. It also shows scheduled jobs with their latest and next runs, plus recent publication statuses. Expand a task to see recorded events. Progress refreshes about every 12 seconds while the tab is visible. The campaign list shows the saved lifecycle and Kanban counts on page load.

**Progress → Agent activity** lists campaign chat, Kanban worker sessions, scheduled jobs, and delegated sessions. Filter by activity type or agent, open a session to read its transcript and tool calls, or select **Runtime logs** for log records tagged with that session ID. Worker logs, scheduled-job output, and the campaign agents’ log files can also be opened directly from the activity list. The first page and open details refresh while visible.

Activity comes from the runtime’s retained history. Shared Hermes logs appear only when they can be attributed to a campaign session. Old sessions or output removed by Hermes retention, and historical work without campaign or session links, cannot be recovered here. The console omits hidden prompts and private model reasoning and redacts credentials before returning activity. Rebuild both the console and VM to enable this view on an existing installation.

The console uses the board identified by `kanban_board` in `campaigns/<id>/config.yaml`. Older configs with only `kanban_board_name` can use a unique board name. The VM reads the authenticated Kanban dashboard API on loopback. The console keeps progress in oma-agent and needs the updated VM service to display it.

Agent setup requires a Composio MCP server. During setup, or later in **Settings**, paste the MCP URL and API key from your Composio dashboard, such as `https://connect.composio.dev/mcp`. Connect your apps in Composio itself. The console saves the server to the default agent’s record as `mcp_servers.composio` with a `${COMPOSIO_API_KEY}` header reference. The key prefix picks the header: a project key (`ak_`) uses `x-api-key`, and a consumer key (`ck_`) uses `x-consumer-api-key`. The key travels only in the default agent’s private sync request and is stored in that profile’s credentials. The maintenance agent doesn’t receive it. In **Settings**, leave the key blank to keep the saved one. A campaign’s `integrations` list is informational and no longer gates starting it.

The managed analytics collector reads GA4 and Search Console through enabled read-only MCP connections and matches their properties to the verified brand website. In a running `control` campaign, analytics collection runs on the hourly schedule and manual refresh is disabled. After upgrading from oma-agent v0.1.29 or earlier, use **Sync saved agent changes** in a campaign’s Agents section to refresh its agent guidance and remove retired direct Google settings.

A campaign uses the default agent’s model when its model fields are blank. Deploying or syncing the campaign applies the default profile’s saved model and credential to agents that inherit it. Open a campaign’s **Run settings** to enter an override or select **Use default agent model** to clear it. Use a provider supported by oma-agent, or `custom` for an OpenAI-compatible endpoint. Enter the campaign’s API key with the HTTPS base URL when the override needs its own credential.

Starting a campaign or saving its run settings writes the model to `campaigns/<id>/config.yaml` in the mounted workspace and uses the private `POST /workspace/campaigns/<id>/sync` endpoint to update installed campaign profiles. For bundled campaigns created by earlier Docker images, the first sync creates the campaign board and adds missing routing to the existing profiles. The sync also removes a Composio session generated by earlier console versions, without removing custom MCP servers. YAML stores only key references. The model and MCP settings support per-agent overrides. Rebuild and recreate the console and VM after updating the stack.

The campaign conversation stays available as you move between campaign sections. Use it to discuss the plan or request changes. Every message is sent to oma-agent’s default profile with the saved campaign ID.

With a compatible agent image, trusted local processes can edit `/opt/data/oma/agents/{default,maintenance}/config.yaml` and then call `POST /workspace/agents/<id>/sync` over the private workspace Unix socket with JSON `{}` or `{"revision":"<sha256 of saved YAML>"}`. To apply an API key with a staged provider selection, include `"env": {"HERMES_MODEL_API_KEY": "<provider API key>"}` alongside the exact saved revision. For the default agent, `"COMPOSIO_API_KEY"` is accepted once its record has the Composio MCP server. The endpoint applies the saved model and reasoning settings. Trusted socket callers can also supply named profile credentials explicitly in `env` for agent or campaign sync. Values are passed to the native sync process over standard input. `409` means the saved file changed before it could be applied.

Use **Start campaign** to begin. The first start creates the campaign’s board and agent profiles, syncs its settings, and resumes work. The same control becomes **Pause campaign** while running and **Resume campaign** when paused. Resume reuses the installed board and profiles.

Save plan, model, and publishing changes from their campaign sections. A draft keeps edits for its first start. For an installed campaign, the console pauses running work, syncs the saved revision, and resumes after sync succeeds. A failed sync leaves the campaign paused for review. Campaign chat also checks for changes to saved campaign and agent files when the turn completes in the open chat. Use **Sync saved agent changes** in Agents to retry or apply agent files edited elsewhere.

Trusted local callers can also pause or resume with `PUT /workspace/campaigns/<id>/lifecycle`. A `202` response with `state: pausing` means work is still stopping. Resuming requires a configured model. Neither agent sync nor lifecycle checks integration catalog membership, brand evidence, or provider connections. Send the current `revision` to guard a lifecycle change against concurrent edits.

In **Approvals**, review the exact publication revision, account, content, attachments, and reply target. The console reads `GET /workspace/campaigns/<id>/publications` with optional `before` and `limit` query parameters. The private `POST /workspace/campaigns/<id>/publications/<publication-id>/approve` endpoint receives the reviewed revision and the signed-in operator's ID, then queues the publisher. A stale revision returns `409`.

The full stack reads and writes brands, playbooks, campaigns, and agent records under `$HERMES_HOME/oma/`. Compose mounts the VM data volume at `HERMES_HOME`, which defaults to `/opt/data`. Set `HERMES_HOME` in the Compose `.env` to use a different absolute path inside the VM container. Current agent versions save the shared brand and playbook in `brand/config.yaml` and `playbook/config.yaml` under the workspace directory. Brand pages show saved knowledge, channels and launches, research reports, documentation, and public integration evidence. **Assets** shows the palette and previews declared screenshots, logos, illustrations, icons, backgrounds, images, and supported fonts. Open an image at full size, follow a screenshot’s source page, or download a declared file up to 10 MiB. Campaign overviews show the shared brand and playbook, goals, plans, and saved agents. Open a campaign’s **Agents** tab to see the team, assigned models and tools, and scheduled work. Select an agent to open its profile. Brand details and playbook strategy edits update their YAML. Brand knowledge edits update the referenced Markdown file when the brand declares one. The dashboard lists campaigns once oma-agent has saved them.

The console serves [API documentation](http://localhost:3000/docs) and a [database readiness endpoint](http://localhost:3000/health/ready).

The console and bundled agent both run under Docker. Quitting Docker Engine stops both. Run `make dev` or `make production` to start them together again. Press Ctrl+C in the `make dev` terminal, or run `docker compose -f compose.yaml -f compose.vm.yaml down`, to stop the full stack. Use the same environment file for Compose commands. The console stores SQLite and its signing key in `.oma-data/`. The VM volume holds Hermes profiles, gateway keys, the nested Docker engine, and catalog app data. Stop the stack before taking filesystem backups. Keep a secure copy of any configured signing or integration encryption keys.

Set `OMA_VM_PLATFORM` in your Compose environment if you are reusing a VM volume with Hermes dependencies built for another architecture. For example, use `OMA_VM_PLATFORM=linux/amd64` to keep an existing x86-64 VM volume working on an ARM64 Docker host.

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

Before starting Hermes, the VM writes `CAMOFOX_URL=http://camofox:9377` and `CAMOFOX_API_KEY` to the mounted Hermes home: `/opt/data/.env` for `default` and `/opt/data/profiles/maintenance/.env` for `maintenance`. It preserves unrelated entries. The key is required for Camofox API requests other than health checks and is not sent to Next.js. This runs the upstream browser image separately; it does not bundle the browser into the Apache-2.0 OMA image. The [Debian installer](#install-natively-on-debian) runs the same pinned image as the `oma-camofox` container on `127.0.0.1:9377`.

### Console only

```sh
mkdir -p -m 700 .oma-data
docker compose up --build -d --wait
```

Use `make dev-console` for hot reload with just the console. See the [application development guide](oma/README.md) for native Node.js development. For development on your LAN, set `OMA_BIND_ADDRESS` to the Mac or server’s specific LAN IP and set `OMA_APP_URL` to the address you open in your browser. Restart the console after changing these settings.

To use Chat with an existing Hermes gateway, set `OMA_AGENT_URL` to an address reachable from the console and set `OMA_AGENT_API_KEY` to the gateway’s `API_SERVER_KEY`. On Docker Desktop, for example, use `http://host.docker.internal:8642` for a gateway on your host. For native development on the same machine, use `http://127.0.0.1:8642` in `oma/.env.local`. Keep the gateway private and recreate the console after changing its environment. The gateway needs the [Hermes Runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#post-v1runs).

## Install on Debian or Ubuntu

On x86-64 Debian or Ubuntu, download `oma-cli-v<cli-version>-linux-amd64.tar.gz` and `SHA256SUMS` from the same [`oma-cli-v*` release](https://github.com/openmarketing-agency/openmarketing.agency/releases). Run `sha256sum -c SHA256SUMS`, then extract the verified archive and run `sudo install -m 0755 oma /usr/local/bin/oma` from the extracted directory. The CLI requires neither Docker nor Node.js nor Bun. Use:

```sh
sudo oma install
sudo oma setup
sudo oma start
sudo oma doctor
```

Open **http://localhost:3000** on the install host. Configure your model and provider in the console; no model key is needed to bring the services up. There is no separate Next.js command to run.

`oma --version` and `oma cli status` report the CLI version. `oma cli versions`, `oma cli updates`, and `sudo oma cli upgrade [version]` manage the separately released binary. Stack installs and upgrades do not replace it.

The installer resolves the OMA Agent release tag to a commit and runs that commit’s installer as root. It verifies the `omactl` archive against its published checksum. The layout is:

| Path | Contents |
| --- | --- |
| `/opt/oma/oma-agent` | Native OMA Agent source checkout |
| `/opt/oma/oma-agent-data` | Agent settings, credentials, profiles, and tools |
| `/usr/local/bin/oma` | Standalone CLI, installed separately |
| `/opt/oma/bin` | `oma-agent` and `omactl` commands |
| `/opt/oma/stack/versions.yaml` | Installed stack release manifest |
| `/opt/oma/omactl/<tag>` | Versioned `omactl` binary, catalog, and license |
| `/opt/oma/omactl-data` | Default location for omactl instance data when initialized |
| `/opt/oma/oma-console-data` | Console SQLite database and signing key; mounted at `/app/data` |
| `/opt/oma/keys.txt` | Root-only (`0600`) backup of the Hermes API key and console integration encryption key |

Install, setup, and start are safe to rerun. `oma install` is a no-op when the requested release is already installed; to switch releases, use `oma upgrade`. `oma setup` reuses existing keys and containers for the configured release. `oma start` starts only missing services and waits for readiness. OMA services do not start automatically on boot: run `sudo oma start` again after a cold boot. The native agent runs as root; its HTTP API binds to the private Docker bridge address and is not published to the LAN.

| Command | What it does |
| --- | --- |
| `oma install [version]` | Verify the release, install Docker if missing, install OMA Agent and `omactl`, and pull the two pinned images. May start Docker to pull images; does not start OMA services. |
| `oma setup` | Generate or reuse service keys, configure the private gateway and workspace connection, and create stopped containers. Does not configure model providers. |
| `oma status [--output text\|json]` | Show the lifecycle phase, service state, and readiness. |
| `oma doctor [--output text\|json]` | Report the next command(s), for example `sudo oma setup` then `sudo oma start` after a fresh install. Exits nonzero until the services are ready; JSON includes `recommendedCommands`. Does not run inference. |
| `oma start`, `oma stop`, `oma restart` | Control all services, or pass `agent`, `console`, or `camofox`. The `agent` target includes the Hermes gateway, its HTTP API, and the private workspace service. `omactl` is not a service. |
| `oma logs <agent\|console\|camofox> [--follow]` | Read the latest logs or follow them. |
| `oma versions [--output text\|json]` | List published, installable stable OMA releases from newest to oldest. No root access required. |
| `oma updates [--output text\|json]` | Check for a newer OMA release and show its component pins. |
| `oma upgrade [version]` | Download and verify a newer release, then install its pinned components. Stop services before upgrading, then run `oma setup` and `oma start` again. |

Use bare OMA release versions, for example `sudo oma install 0.1.0` or `sudo oma upgrade 0.1.1`. Text is the default output; choose `--output json` for scripts. Progress goes to stderr.

The console and Camofox bind to `127.0.0.1` on ports 3000 and 9377 by default. The console runs as a non-root user and accesses the workspace socket through a dedicated read-only mount, not the Docker socket or the agent data directory. After an upgrade, setup replaces the stopped containers and keeps the data under `/opt/oma`.

`oma setup` generates or reuses `API_SERVER_KEY` and `OMA_INTEGRATION_ENCRYPTION_KEY`, storing them in `/opt/oma/keys.txt` (`0600`). It also configures the Camofox key for the native default and maintenance profiles. These are service keys, not model-provider credentials. Back up `keys.txt` privately with the console database: without the original encryption key, saved integration credentials cannot be decrypted. Deployment overrides such as `OMA_FRONTEND_PORT` or `OMA_APP_URL` may be set in the root environment before the containers are first created; setup does not read a project `.env`.

## Release

The standalone CLI lives in [`oma-cli/`](oma-cli/) and has its own version in `oma-cli/package.json`. A matching `oma-cli-vX.Y.Z` tag publishes only the CLI archive and checksums; it does not publish the stack or the console image. A stack tag does not publish the CLI.

Keep one stack manifest per release in [`versions/`](versions/), for example [`versions/0.1.0.yaml`](versions/0.1.0.yaml). Write component versions as bare `X.Y.Z`; keep Camofox as an exact image reference. A `vX.Y.Z` tag selects `versions/X.Y.Z.yaml`. Its `version` must match, and preflight checks that the release does not already exist and the pinned dependencies are available. The workflow pushes the console image, then publishes the stack archive, `SHA256SUMS`, and `versions.yaml`. The archive contains the installer, workspace service, and manifest, not the CLI. If the manifest points to a different console version, that image must already be pullable. Tag pushes do not publish the VM image.

After the GitHub release succeeds, the stack workflow publishes the exact manifest to `s3://<R2_BUCKET>/versions/X.Y.Z.yaml` and adds that version to `versions/index.json`. The CLI workflow uses its own catalog at `oma-cli/versions/index.json`. The CLI reads both catalogs and stack pins from OMA R2 over HTTPS; GitHub Releases serves the download assets. Configure Actions secrets `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` (bucket-scoped read/write credentials), plus secret or variable `R2_ACCOUNT_ID`. Set the Actions variable `R2_PUBLIC_URL` in this repository to the public HTTPS base serving both catalogs. If a catalog update fails after the GitHub Release succeeds, rerun only the failed catalog job.

OMA is distributed under the [Apache License 2.0](LICENSE). Individual skills may include their own license notices.
