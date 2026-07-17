# Requirements

## Hardware sizing

Postmill is a Node.js monorepo application backed by PostgreSQL and Redis. Background jobs run on
Inngest, so self-hosted deployments do not need a local workflow engine.

| Tier      | Users  | CPU       | RAM    | Disk    | Notes |
|-----------|--------|-----------|--------|---------|-------|
| Minimum   | 1–5    | 2 vCPU    | 4 GB   | 20 GB   | Suitable for single-tenant or small teams |
| Small     | 5–50   | 4 vCPU    | 8 GB   | 50 GB   | Comfortable for most self-hosters |
| Medium    | 50–200 | 8 vCPU    | 16 GB  | 100 GB  | Add RAM for analytics cache / large orgs |
| Large     | 200+   | 16 vCPU+  | 32 GB+ | 200 GB+ | Scale Postgres and Redis independently |

The heavy pieces:

- **PostgreSQL 17** — the application database is typically modest (< 5 GB for small instances),
  but grows with analytics snapshots, media metadata, and campaign data.
- **Redis 7** — negligible memory (< 100 MB) unless analytics cache loads many orgs.
- **Inngest Cloud** — background jobs run outside the cluster; no local Temporal/Elasticsearch
  services are required.

## Software prerequisites

### Build toolchain

| Tool      | Required version      | Notes |
|-----------|-----------------------|-------|
| Node.js   | `>=22.12.0 <23.0.0`   | See `engines` in `package.json` |
| pnpm      | `10.34.4`             | Specified in `packageManager`; other versions may silently break |
| Docker    | Recent stable         | Only needed for Docker Compose deployment |
| git       | Any                   | For cloning the repository |

### Runtime dependencies

| Software                  | Version | Role |
|---------------------------|---------|------|
| PostgreSQL                | 17      | Application data |
| Redis                     | 7.2     | Session cache, throttle store, analytics cache |
| Inngest Cloud             | —       | Durable background jobs (analytics, comments, publish, token refresh) |
| Email provider (optional) | —       | 6-provider adapter system (Resend, SendGrid, Mailgun, Postmark, Amazon SES, SMTP). Configure with `EMAIL_PROVIDER` + standardized env vars. See [Configuration](./configuration.md#email). |

### Object storage

All media is stored locally by default (`UPLOAD_DIRECTORY`). Cloud providers (S3, R2, B2, IDrive e2)
are configured per-organization via Settings → Storage. Avatars and app-internal writes always use
local storage.

| Provider            | Notes |
|---------------------|-------|
| Local disk          | Default; quota configurable per org. Simple but not redundant. |
| Cloudflare R2       | S3-compatible, no egress fees (per-tenant, Settings → Storage) |
| AWS S3              | S3-native API (per-tenant, Settings → Storage) |
| Backblaze B2        | S3-compatible, low storage cost (per-tenant, Settings → Storage) |
| IDrive e2           | S3-compatible (per-tenant, Settings → Storage) |

Storage providers are configured **per-organization** via the Settings UI, not environment
variables. See [Storage Setup](./storage.md) and [Configuration](./configuration.md).

## Network and URL requirements

- The application must be reachable at the URL you set in `FRONTEND_URL`. OAuth redirects from
  social providers resolve against this URL.
- `BACKEND_INTERNAL_URL` must be reachable from within the container for internal API calls. In
  Docker Compose this is `http://localhost:3000`; behind a reverse proxy, set it to the internal
  backend address.
- **Outbound HTTPS** is required — all provider API calls and webhook dispatches go through
  `safeFetch`, which enforces HTTPS and blocks private/internal IPs (unless explicitly allowlisted
  via `SSRF_ALLOWED_PRIVATE_CIDRS` for self-hosted provider instances).
- Ensure your public IP is in the allow-list for any API tokens you create via the Public API
  settings.

## CLI commands

The `apps/commands` package provides NestJS CLI commands for operator tasks:

```bash
# Build the CLI
pnpm run commands:build:development

# Check configuration for issues
npx nestjs-command config:check

# Refresh all OAuth tokens
npx nestjs-command refresh

# Run the AI agent
npx nestjs-command run:agent
```

Run these inside the application container or with the same environment variables as the backend.

## Native dependency notes

### macOS-only duplicate-class warning

On macOS, test or dev-server logs may show a warning similar to:

```
Class GNotificationCenterDelegate is implemented in both
.../sharp-darwin-arm64.../sharp-darwin-arm64.node
.../canvas.../canvas.node
One of the two will be used. Which one is undefined.
```

This is a benign, macOS-only conflict between the native modules `sharp` and `canvas`. Both
packages register the same macOS notification-delegate class independently; the warning does not
affect Linux production images or runtime correctness. No operator action is required.

> Verified against v1.0.0
