# Open Marketing Agency

OMA is a self-hosted workspace for marketing campaigns and tool connections. The full stack includes the Next.js console, Hermes with the bundled [campaigns](campaigns/) and skills, and `omactl` with its app catalog and Traefik. Hermes uses OpenRouter for inference.

## Run the full stack locally

Use Docker Engine with Compose 2.24.4+ on an x86-64 Linux host or VM that supports privileged containers and nested Docker. Set `OPENROUTER_API_KEY` in a private `.env` using [`.env.example`](.env.example) as a reference. If you already have a private environment file elsewhere, set `COMPOSE_ENV_FILES` to its path, then start the stack from this checkout.

```sh
make dev         # Console hot reload and the full runtime
make production  # Production console build and the same full runtime
```

The default OpenRouter model is [GPT-4.1 Mini](https://openrouter.ai/openai/gpt-4.1-mini). Set `OMA_HERMES_MODEL` in the environment file to choose a different OpenRouter model. Inference requires network access to OpenRouter. Set `OMA_INIT_CATALOG=0` to start Hermes without initializing the optional app catalog.

Create the installation's single account at [http://localhost:3000/register](http://localhost:3000/register). After registration, enter your project website, GitHub repository, or both. The console saves the links in SQLite and sends the questions and answers to oma-agent. If the agent connection is unavailable, retry from project setup. You can skip setup and go straight to Campaigns. Existing accounts can open project setup from Campaigns. The signed-in [agent onboarding backup](http://localhost:3000/onboarding-backup) retains the previous conversation flow. Sign in again at [http://localhost:3000/login](http://localhost:3000/login). The Hermes dashboard is on port `9119`, its authenticated gateway is on `8642`, and optional catalog apps route through Traefik on `18080`. Compose initializes the catalog. Use these commands to verify it and start a local chat:

```sh
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm omactl doctor
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm hermes chat
```

Open [Chat](http://localhost:3000/chat) in the console to talk with the bundled Hermes agent. The full stack supplies its gateway address and default-profile key automatically. The Hermes dashboard and CLI also remain available.

Set `OMA_HERMES_CLARIFY_TIMEOUT=0` in `.env` to let the default profile wait indefinitely for an answer in the agent onboarding backup. A positive value sets the wait in seconds. Leaving the variable unset keeps the profile's saved setting, which defaults to 90 seconds on a fresh installation. Recreate the VM container after changing the value.

Use [Campaigns](http://localhost:3000/dashboard) in the console to configure campaign tool selections and MCP connections. Composio is optional and requires an API key for its hosted tool catalog.
Open a campaign’s **Tools** tab to add tools to its shared list. Suggestions appear when a verified channel or launch link from the linked brand matches a supported tool provider. Browse **All tools** to add other integrations. The campaign’s MCP connection uses its saved tool list, including existing specialist selections.

Open a campaign’s **Settings** to configure its model. Set `OMA_HERMES_PROVIDER`, `OMA_HERMES_MODEL`, and `OMA_HERMES_BASE_URL` in `.env` to prefill the form. Use a provider supported by oma-agent, or `custom` for an OpenAI-compatible endpoint. The console can use `OMA_HERMES_API_KEY` for the configured provider and HTTPS base URL. A key entered in Settings overrides it for that campaign. Composio generation uses `COMPOSIO_API_KEY`.

**Save and sync** creates a Composio connection from the campaign’s selected tools. It then writes the model and generated MCP URL to `campaigns/<id>/config.yaml` in the mounted workspace and uses the private `POST /workspace/campaigns/<id>/sync` endpoint to update installed campaign profiles. For bundled campaigns created by earlier Docker images, the first sync creates the campaign board and adds missing routing to the existing profiles. Saving a campaign with no tools clears its generated Composio connection. YAML stores only key references. The model and MCP settings support per-agent overrides. Rebuild and recreate the console and VM after updating the stack, and recreate the console after changing its `.env` defaults.

The full stack shows brands, playbooks, campaigns, and agent records from the default oma-agent profile's `/opt/data/oma/` directory. Current agent versions save the shared brand and playbook in `brand/config.yaml` and `playbook/config.yaml` under that directory. Brand pages render file-backed knowledge, research and documentation, channels, palette, and supported logo previews from the workspace. Campaign overviews show the shared brand and playbook, goals, plans, and saved agents. Open a saved agent to view its profile and scheduled work. Brand details and playbook strategy edits update their YAML. Brand knowledge edits update the referenced Markdown file when the brand declares one. The dashboard lists campaigns once oma-agent has saved them.

The console serves [API documentation](http://localhost:3000/docs) and a [database readiness endpoint](http://localhost:3000/health/ready).

The console and bundled agent both run under Docker. Quitting Docker Engine stops both. Run `make dev` or `make production` to start them together again. Press Ctrl+C in the `make dev` terminal, or run `docker compose -f compose.yaml -f compose.vm.yaml down`, to stop the full stack. Use the same environment file for Compose commands. The console stores SQLite and its signing key in `.oma-data/`. The VM volume holds Hermes profiles, gateway keys, the nested Docker engine, and catalog app data. Stop the stack before taking filesystem backups. Keep a secure copy of any configured signing or integration encryption keys.

### Console only

```sh
mkdir -p -m 700 .oma-data
docker compose up --build -d --wait
```

Use `make dev-console` for hot reload with just the console. See the [application development guide](oma/README.md) for native Node.js development.

To use Chat with an existing Hermes gateway, set `OMA_AGENT_URL` to an address reachable from the console and set `OMA_AGENT_API_KEY` to the gateway’s `API_SERVER_KEY`. On Docker Desktop, for example, use `http://host.docker.internal:8642` for a gateway on your host. For native development on the same machine, use `http://127.0.0.1:8642` in `oma/.env.local`. Keep the gateway private and recreate the console after changing its environment. The gateway needs the [Hermes Runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#post-v1runs).

## Self-host on a bare-metal server

On an x86-64 Linux host, download `oma-vm-<tag>-linux-amd64.tar.gz` and `SHA256SUMS` from the same [OMA release](https://github.com/openmarketing-agency/openmarketing.agency/releases). Replace `vX.Y.Z` below with that release tag:

```sh
sha256sum -c SHA256SUMS
tar -xzf oma-vm-vX.Y.Z-linux-amd64.tar.gz
cd oma-vm-vX.Y.Z-linux-amd64
install -m 600 .env.example .env
# Set OPENROUTER_API_KEY in .env before running the installer.
sudo bash install.sh
```

The installer adds Docker and Compose on a fresh Ubuntu 24.04 server and starts the prebuilt console and VM. On other x86-64 Linux systems, install Docker Engine and Compose 2.24.4+ before running it. The installer uses the `oma` Compose project and named volumes. To upgrade, verify and extract the new package, bring over the private `.env`, and run its installer. Use the existing Docker context so the installation retains its volumes.

The services bind to loopback by default. Use an SSH tunnel to port `3000` to create the account. For public HTTPS access to the console, set `OMA_APP_URL` to your HTTPS origin, set `OMA_COOKIE_SECURE=true` in the package's `.env`, and rerun the installer behind your reverse proxy. Keep the Hermes gateway and dashboard private.

Run `sudo docker exec --user hermes oma-vm-1 omactl doctor` to check the installed VM.

## Run the VM image on a VM provider

The [release](https://github.com/openmarketing-agency/openmarketing.agency/releases) includes a pinned digest for the standalone `linux/amd64` agent image. Import that digest into a disposable Agent37 VM template, mount persistent storage at `/opt/data`, keep the image entrypoint, and set the default port to `8642`. Set `OPENROUTER_API_KEY` for OpenRouter, or supply `OMA_LITELLM_URL` and `OMA_LITELLM_KEY` for an existing OpenAI-compatible endpoint that serves the `oma-hermes` alias. Set `OMA_HERMES_MODEL` to override the selected model. Set a unique `OMA_HERMES_GATEWAY_SEED` when deriving bearer keys outside the VM. A profile's key is the hex HMAC-SHA-256 of its ID, or `default`, using that seed. Verify a chat turn and restart the VM before updating a live template. [Agent37 custom images](https://www.agent37.com/docs/agents-api/custom-image)

To build and smoke-test the standalone image from this checkout:

```sh
docker build --platform linux/amd64 -f vm/Dockerfile -t oma-vm:local .
bash vm/tests/smoke.sh oma-vm:local
```

The source for [omactl](https://github.com/openmarketing-agency/omactl) stays in its own repository. The VM build verifies and installs its pinned binary and catalog release.

## Release

Push a `vX.Y.Z` tag in this repository to build and test both images, publish them to GHCR, and attach the installer and checksum to the GitHub release. Set the two GHCR packages to public after the first publish so the installer can pull them anonymously.

OMA is distributed under the [Apache License 2.0](LICENSE). Individual skills may include their own license notices.
