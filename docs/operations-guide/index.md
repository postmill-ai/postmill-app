# Operations Guide

This guide is for self-hosters and operators running a production Postmill instance. It covers
deployment, configuration, backup, and ongoing maintenance.

## What's involved in running Postmill

Postmill is a multi-service application that schedules and publishes social media and chat posts
across 36 channels. Running your own instance means operating:

- The **Postmill** application container (Node.js backend + Next.js frontend combined)
- A **PostgreSQL 17** database (application data)
- A **Redis 7** cache and message broker
- **Inngest** for durable background jobs (dev server locally, Cloud in production)
- Optional **object storage** for uploaded media (local disk, S3, R2, B2, or IDrive e2)

The operational surface is moderate: most state lives in Postgres, background work is durable
through Inngest, and media can live on local disk or cloud object storage.

## Stack at a glance

| Component          | Technology                          | Role                                |
|--------------------|-------------------------------------|-------------------------------------|
| Application        | Node.js >=22.12.0, Next.js 16, NestJS 11 | API + frontend server           |
| Primary database   | PostgreSQL 17                       | Users, orgs, posts, integrations, config |
| Cache / queue      | Redis 7                             | Session cache, throttle store, analytics cache |
| Background jobs    | Inngest                             | Analytics, comments, publish, token refresh |
| Media storage      | Local disk or S3/R2/B2/IDrive e2   | Uploaded images, video, audio       |
| Monitoring (opt)   | Sentry + Spotlight                  | Error tracking, debug proxy         |

## Guide pages

| Page | Description |
|------|-------------|
| [Requirements](./requirements.md) | Hardware, software, and network prerequisites |
| [Docker Deployment](./docker.md) | Running the full stack with Docker Compose |
| [Configuration](./configuration.md) | Every environment variable, organised by category |
| [Inngest & Cron](./inngest-and-cron.md) | Background job inventory and scheduling |
| [Video Rendering](./video-rendering.md) | Local media render queue and optional Podman workers |
| [Storage Setup](./storage.md) | Local and cloud storage providers, quotas, per-org routing |
| [Backup & Retention](./backup-and-retention.md) | What to back up, how to restore, automated data retention |
| [Scaling & Deployment](./scaling.md) | Production image, horizontal scaling, health probes, graceful shutdown, OpenTelemetry |
| [Upgrading](./upgrading.md) | Clean upgrade path and building from source |
| [Schema Rollback](./schema-rollback.md) | Prisma migrate rollback playbook — forward-only down migrations, half-applied recovery, expand/contract |
| [Security](./security.md) | Helmet, CSRF, SSRF, encryption, JWT, Sentry scrubbing, throttling |
| [OAuth / SSO](./oauth-sso.md) | Generic OIDC provider setup (Authentik, Keycloak, etc.) |
| [Subscriptions & Stripe](./subscriptions.md) | Stripe config, plans, metered caps, add-ons, and self-host defaults |

> Verified against v1.0.0
