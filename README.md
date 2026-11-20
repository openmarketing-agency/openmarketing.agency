# Open Marketing Agency

OMA is a self-hosted workspace for marketing playbooks and tool connections. The full stack includes the Next.js console, Hermes with the bundled playbooks and skills, and `omactl` with its app catalog and Traefik. Hermes uses OpenRouter for inference.

## Run the full stack locally

Use Docker Engine with Compose 2.24.4+ on an x86-64 Linux host or VM that supports privileged containers and nested Docker. Set `OPENROUTER_API_KEY` in a private `.env` using [`.env.example`](.env.example) as a reference. If you already have a private environment file elsewhere, set `COMPOSE_ENV_FILES` to its path, then start the stack from this checkout.

```sh
make dev         # Console hot reload and the full runtime
make production  # Production console build and the same full runtime
```

The default OpenRouter model is [GPT-4.1 Mini](https://openrouter.ai/openai/gpt-4.1-mini). Set `OMA_HERMES_MODEL` in the environment file to choose a different OpenRouter model. Inference requires network access to OpenRouter.

Create the installation's single account at [http://localhost:3000/register](http://localhost:3000/register). Sign in again at [http://localhost:3000/login](http://localhost:3000/login). The Hermes dashboard is on port `9119`, its authenticated gateway is on `8642`, and optional catalog apps route through Traefik on `18080`. Compose initializes the catalog. Use these commands to verify it and start a local chat:

```sh
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm omactl doctor
docker compose -f compose.yaml -f compose.vm.yaml exec --user hermes vm hermes chat
```

Use the Hermes dashboard, gateway, or CLI to run agents. The console manages playbook tool selections and MCP connections. Composio is optional and requires an API key for its hosted tool catalog.

### Onboard and start an SEO campaign

Open **Brand & Campaign** in the console. Talk to Hermes about your brand, audience, voice, assets, and goals. Enter the exact Google Search Console property and save. OMA stores the brand brief, knowledge notes, and the tailored SEO plan in SQLite.

Set `COMPOSIO_API_KEY` and connect one Google Search Console account that can read the selected property. The campaign starts automatically and repeats every 24 hours after a successful run. OMA reads Search Console analytics for the chosen property through Composio, then hands the evidence and saved context to the Hermes researcher, writer, and verifier. The latest draft and review appear under **Brand & Campaign**. Pause or resume the campaign from that page.

This first version supports one SEO campaign per installation, text and links for assets, and read-only evidence collection with drafts for review. Keep the console running so it can schedule work and retry failed cycles.

The console serves [API documentation](http://localhost:3000/docs) and a [database readiness endpoint](http://localhost:3000/health/ready).

Stop the full stack with `docker compose -f compose.yaml -f compose.vm.yaml down`. Use the same environment file for Compose commands. The console stores SQLite and its signing key in `.oma-data/`. The VM volume holds Hermes profiles, gateway keys, the nested Docker engine, and catalog app data. Stop the stack before taking filesystem backups. Keep a secure copy of any configured signing or integration encryption keys.

### Console only

```sh
mkdir -p -m 700 .oma-data
docker compose up --build -d --wait
```

Use `make dev-console` for hot reload with just the console. See the [application development guide](oma/README.md) for native Node.js development.

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
