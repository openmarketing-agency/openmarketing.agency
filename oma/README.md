# OMA application

This directory contains the Next.js console and API, the SQLite database schema, and the tests for the self-hosted workspace.

## Develop

From the repository root, run `make dev` for the full local stack or `make dev-console` to work on the console alone. Both commands watch console source changes. Open [http://localhost:3000](http://localhost:3000).

For native development, use Node.js 24 and npm. Run these commands from `oma/`.

```sh
npm ci
npm run dev
```

Optional settings go in `.env.local`, using [`.env.example`](.env.example) as a reference. Native development keeps `oma.sqlite` in `oma/data/` by default. The application creates the SQLite schema on first use. This schema requires a fresh database. Keep a copy of an earlier database before starting with an empty data directory.

Run the check suite with:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

The database tests create isolated SQLite files in a temporary directory. Project setup at `/onboarding` accepts a website, a GitHub repository, or both. It saves the supplied links and forwards the questions and answers through the configured oma-agent gateway. Failed deliveries can be retried with the saved links. In development, loading `/onboarding-backup` directly or refreshing it resets the backed-up agent conversation so it can be tested again.

## Use the API and connections

The first registration creates the installation's sole account. The nullable `users.onboarding_state` field stores the project setup and any saved agent onboarding transcript. Browser login stores access and refresh tokens in HTTP-only cookies. API clients send `username` and `password` as form fields to `/api/v1/auth/jwt/login`, then send the returned access token as `Authorization: Bearer <token>`. The bearer API and machine-readable OpenAPI document are available at `/docs` and `/openapi.json`.

Set `COMPOSIO_API_KEY` in the Docker environment to enable the Connections catalog and create MCP URLs from your selected tools. Authenticated custom MCP connections also require `OMA_INTEGRATION_ENCRYPTION_KEY`. Generate one with `openssl rand -base64 32 | tr '+/' '-_'` and back it up securely. Authenticated endpoints use HTTPS, with HTTP allowed for loopback endpoints.
