# Developer Documentation

Technical documentation for developers working on the Postmill codebase. This directory covers architecture, conventions, and infrastructure — everything you need to contribute effectively.

**Target audience:** Developers contributing to the Postmill monorepo (NestJS backend + Inngest job handler, Next.js frontend, shared libraries, Prisma).

---

## API surfaces at a glance

| Surface | Base path | Description |
|---|---|---|
| Public API v1 | `/public/v1` | REST API for integrations, posts, media, analytics — used by n8n, Zapier, and the SDK. |
| Analytics v2 | `/analytics/v2` | Multi-channel analytics dashboard API with snapshot-based data. |
| MCP Server | MCP protocol | AI agent tools exposed via Model Context Protocol. |

---

## Stability commitments

- **Legacy analytics route** (`GET /analytics/:integration`) — response shape is frozen for n8n/Zapier compatibility. A parallel v2 route provides the new shape.
- **Schema** — `prisma migrate deploy` is the migration method. Additive changes (nullable columns, defaulted columns) are safe. Renames and drops require an expand-contract plan.
- **AI provider resolution** — no env-var fallback. Per-tenant configuration through `AIOrgProviderConfig`.
- **Provider framework** — the kernel is the sole resolution path; legacy registries and kill switches have been removed.

---

## Page index

| Page | Description |
|---|---|
| [Local Development](./local-development.md) | Get the stack running locally with minimal resources: Docker profiles, feature flags, memory guidance. |
| [Architecture](./architecture.md) | High-level monorepo architecture, app/library layout, data flow. |
| [AI Architecture](./ai-architecture.md) | Pluggable multi-provider AI layer: `AIModelProvider`, categories, surfaces, adapters, governance services. |
| [Database](./database.md) | Prisma schema management, migrate-deploy workflow, repository-only access, encryption at rest. |
| [Data Model](./data-model.md) | Prisma models grouped by domain with keys and relationships. |
| [Backend Conventions](./backend-conventions.md) | NestJS layering (Controller → Service → Repository), DTO validation, CSRF, security invariants. |
| [Frontend Conventions](./frontend-conventions.md) | Next.js App Router structure, SWR data fetching, Tailwind 3 styling, capability-aware UI. |
| [Provider Framework](./provider-framework.md) | Kernel, identity triple, versions, catalog/health APIs. |
| [Provider Versions](./provider-versions.md) | Live provider catalog grouped by domain. |
| [Integrations](./integrations.md) | The channel-integration model: `IntegrationManager`, credential resolution, capability matrix, per-channel VPN egress. |
| [Public API v1](./public-api.md) | Public REST API endpoints for third-party integrations and automation. |
| [Analytics API v2](./analytics-api.md) | Multi-channel analytics dashboard API with snapshot-based data. |
| [MCP](./mcp.md) | Model Context Protocol server entrypoints, auth, rate limiting. |
| [OAuth Apps](./oauth-apps.md) | OAuth application registration and management. |
| [Plugs](./plugs.md) | Automation hooks (auto plugs and post plugs) for social channel providers. |
| [SDK](./sdk.md) | Official `@postmill-ai/postmill-sdk` Node.js SDK for the Public API. |
| [Webhooks](./webhooks.md) | Webhook configuration, dispatch, and SSRF-safe delivery. |
| [Adding a Provider](./adding-a-provider.md) | Step-by-step guide for adding a new social channel provider. |
| [Adding an AI Adapter](./adding-an-ai-adapter.md) | Guide for implementing a new AI provider adapter. |
| [Adding a Media Studio](./adding-a-media-studio.md) | Descriptor + adapter + route recipe for the studio-kit. |
| [Testing](./testing.md) | Vitest per-package configuration, co-located specs, CI workflow. |
| [Setup Gate](./setup-gate.md) | The `/setup` onboarding wizard and gate semantics. |
| [Contributing](./contributing.md) | Ground rules, invariants, PR workflow, review checklist. |
| [Glossary](./glossary.md) | Terminology used across the codebase. |

---

## Related docs

| Page | Location | Description |
|---|---|---|
| AI Tools (user guide) | [../user-guide/ai-tools.md](../user-guide/ai-tools.md) | End-user view of AI features. |
| Supported Channels | [../user-guide/supported-channels.md](../user-guide/supported-channels.md) | User-facing capability matrix for social channels. |
| Operations Guide | [../operations-guide/](../operations-guide/) | Self-hosting, deployment, monitoring. |

---

## Repository layout (quick reference)

```
apps/
  backend/         NestJS REST API — thin controllers + module wiring + Inngest handler
  frontend/        Next.js (App Router) + React — port 4200
  extension/       Browser extension
  commands/        CLI commands
  sdk/             Published SDK

libraries/
  nestjs-libraries/    Core backend logic, Prisma schema, repositories
  helpers/             Shared utilities, useFetch hook
  react-shared-libraries/  Shared React components
  providers/           Provider kernel + per-provider packages
```

> Verified against v1.0.0
