# Open Marketing Agency

OMA is a self-hosted Next.js console for marketing campaigns and tool connections. The console and OMA Agent (Hermes) are installed and run separately. See the [architecture and workflow diagrams](docs/architecture.md) for their integration contracts.

## Run the console

With Docker and Compose installed, run one of these commands from the repository root:

```sh
make dev         # Console with hot reload; make dev-console is an alias
make production  # Production console build
```

Open [http://localhost:3000/register](http://localhost:3000/register) to create the installation's single account or [sign in](http://localhost:3000/login). The console also serves [API documentation](http://localhost:3000/docs) and a [database readiness endpoint](http://localhost:3000/health/ready). Stop development with Ctrl+C or stop the production container with `docker compose down`. SQLite and the signing key live in `.oma-data/`.

See the [application development guide](oma/README.md) to run the console directly with Node.js. Use [`.env.example`](.env.example) for Compose settings. For development on your LAN, set `OMA_BIND_ADDRESS` to the server's LAN IP and `OMA_APP_URL` to the address used in your browser.

### Connect an existing OMA Agent

For Chat, configure `OMA_AGENT_URL` with a private address reachable from the console and `OMA_AGENT_API_KEY` with the gateway's `API_SERVER_KEY`. For Docker Desktop, that address may be `http://host.docker.internal:8642`. For native development on the same host, for example, use `http://127.0.0.1:8642` in `oma/.env.local`. The gateway must support the [Hermes Runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#post-v1runs). Configure model credentials separately in OMA Agent.

Campaign records, progress, profile sync, and publication approvals also require a compatible external workspace service providing the console's private Unix socket API. Where such a service is available, set `OMA_WORKSPACE_SOCKET` in the console process to the socket path it can access. Neither the console's Compose setup nor the native Debian installer starts that service. A gateway connection alone does not enable those features.

## Install OMA Agent natively on Debian

On x86-64 Debian, run the [installer](setup/install.sh) from this checkout as the user who will run OMA Agent:

```sh
sudo apt-get update
sudo apt-get install ca-certificates curl git libatomic1
bash setup/install.sh
```

For a packaged release, download `oma-setup-<tag>-debian-amd64.tar.gz` and `SHA256SUMS` from the same [OMA release](https://github.com/openmarketing-agency/openmarketing.agency/releases). Verify with `sha256sum -c SHA256SUMS`, extract the archive, and run `bash install.sh` from the extracted directory. Do not use `sudo` for the installer itself.

The installer puts `oma-agent` and `omactl` in `~/.local/bin`, with OMA Agent data in `~/.local/share/oma-agent` and the versioned `omactl` catalog in `~/.local/share/omactl`. Run `oma-agent setup` to configure your model provider. The installer does not install Docker, start any services, or install the web console. `omactl` can report its version without Docker, but its app-management commands still require Docker and Compose.

## Release

Pushing a `vX.Y.Z` tag publishes the native Debian installer and checksum on GitHub. A separate job builds the AMD64 Next.js server image and publishes it as `ghcr.io/openmarketing-agency/oma-server:<tag>`. Installer publishing does not use Docker or wait for the image.

OMA is distributed under the [Apache License 2.0](LICENSE). Individual skills may include their own license notices.
