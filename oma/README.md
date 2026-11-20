# OMA application

This directory contains the Next.js console and API, the SQLite database schema, and the tests for the self-hosted workspace.

## Develop

From the repository root, run `make dev` with Docker Compose 2.23 or later to build the development container and watch source changes. Open [http://localhost:3000](http://localhost:3000).

For native development, use Node.js 24 and npm. Run these commands from `oma/`.

```sh
npm ci
npm run dev
```

Optional settings go in `.env.local`, using [`.env.example`](.env.example) as a reference. Native development keeps `oma.sqlite` in `oma/data/` by default. The application creates the SQLite schema on first use and applies future schema updates when the database opens.

Run the check suite with:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

The database tests create isolated SQLite files in a temporary directory.

## Use the API and connections

The first registration creates the installation's sole account. Browser login stores access and refresh tokens in HTTP-only cookies. API clients send `username` and `password` as form fields to `/api/v1/auth/jwt/login`, then send the returned access token as `Authorization: Bearer <token>`. The bearer API and machine-readable OpenAPI document are available at `/docs` and `/openapi.json`.

Set `COMPOSIO_API_KEY` in the Docker environment to enable the Connections catalog and create MCP URLs from your selected tools. Authenticated custom MCP connections also require `OMA_INTEGRATION_ENCRYPTION_KEY`. Generate one with `openssl rand -base64 32 | tr '+/' '-_'` and back it up securely. Authenticated endpoints use HTTPS, with HTTP allowed for loopback endpoints.
