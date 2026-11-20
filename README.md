# Open Marketing Agency

OMA is a self-hosted Next.js workspace for marketing playbooks and tool connections. Each Docker installation has one account and stores its data in a local SQLite file.

## Run with Docker

Install Docker Engine or Docker Desktop with the Compose plugin. From the repository root, run:

```sh
mkdir -p -m 700 .oma-data
docker compose up --build -d --wait
```

Open [http://localhost:3000/register](http://localhost:3000/register) and create your account. Registration closes once the account exists. Use [sign in](http://localhost:3000/login) for subsequent visits. The console opens on Playbooks. Set a Composio API key to connect tools and create MCP sessions for your AI client.

The app starts on localhost. For remote access, create the account locally first, then put the app behind an HTTPS reverse proxy. Set `OMA_APP_URL` to your public origin and `OMA_COOKIE_SECURE=true` when using HTTPS. Copy [`.env.example`](.env.example) to `.env` to override Docker settings, then run the startup command again.

## Storage and operations

The project’s `.oma-data/` folder holds `oma.sqlite` and the generated signing key. To back up the installation, stop the app and copy the entire folder. Keep a secure copy of `OMA_INTEGRATION_ENCRYPTION_KEY` if you configure one.

```sh
docker compose logs -f app
docker compose stop
```

Run `docker compose up -d --wait` to restart it. The folder persists across container replacements and `docker compose down`.

- [API documentation](http://localhost:3000/docs)
- [Database readiness](http://localhost:3000/health/ready)
- [Development guide](oma/README.md)

OMA is distributed under the [Apache License 2.0](LICENSE). Individual skills may include their own license notices.
