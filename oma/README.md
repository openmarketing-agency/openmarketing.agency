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

The database tests create isolated SQLite files in a temporary directory. In development, clicking **Open workspace** at the end of onboarding clears the console's setup state so you can run it again from Campaigns. Loading or refreshing the onboarding page directly clears that state and starts a new run. Opening onboarding from Campaigns resumes the saved run.

## Use the API and connections

The first registration creates the installation's sole account. The nullable `users.onboarding_state` field stores that account's setup progress and saved answers. Browser login stores access and refresh tokens in HTTP-only cookies. API clients send `username` and `password` as form fields to `/api/v1/auth/jwt/login`, then send the returned access token as `Authorization: Bearer <token>`. The bearer API and machine-readable OpenAPI document are available at `/docs` and `/openapi.json`.

Set `COMPOSIO_API_KEY` in the Docker environment to enable the Connections catalog and create MCP URLs from your selected tools. Authenticated custom MCP connections also require `OMA_INTEGRATION_ENCRYPTION_KEY`. Generate one with `openssl rand -base64 32 | tr '+/' '-_'` and back it up securely. Authenticated endpoints use HTTPS, with HTTP allowed for loopback endpoints.
