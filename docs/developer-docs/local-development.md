# Local Development

This guide gets the Postmill stack running on a normal developer machine without swapping or crashing. The repo ships with opt-in subsystems and lightweight commands so you only pay for what you use.

> Verified against v1.0.0

---

## Prerequisites

| Tool | Required version | Notes |
|---|---|---|
| Node.js | `>=22.12.0 <23.0.0` | See `engines` in root `package.json` |
| pnpm | `10.34.4` | Specified in `packageManager`; other versions may silently break |
| Docker / Docker Compose | Recent stable | For Postgres + Redis + optional services |
| ffmpeg | Recent stable | Required for the video merge feature in `/media/replicate`. Install with `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` / `dnf install ffmpeg` (Linux). |

---

## 1. Install dependencies

```bash
pnpm install              # also runs prisma-generate via postinstall
```

> **Use pnpm only** — never npm or yarn.

`node_modules` is large (≈4 GB) because the monorepo includes many optional subsystems. Dependencies are split between the root manifest (shared tooling) and per-workspace manifests in `apps/*` and `libraries/*`. A future cleanup will remove genuinely unused packages.

---

## 2. Start required infrastructure

```bash
# Postgres + Redis only (recommended)
docker compose -f ./docker-compose.dev.yaml up -d

# Add the Inngest dev server for background jobs
docker compose -f ./docker-compose.dev.yaml --profile jobs up -d

# Add pgAdmin as a convenience database UI
docker compose -f ./docker-compose.dev.yaml --profile tools up -d

# Run everything at once
docker compose -f ./docker-compose.dev.yaml --profile jobs --profile tools up -d
```

Required services (`postgres`, `redis`) start by default. `inngest` and `pgadmin` are opt-in via Docker Compose profiles.

Copy `.env.example` to `.env` and adjust values if your local ports differ. The example file defaults Redis to the local container:

```bash
REDIS_URL=redis://localhost:6379
```

---

## 3. Apply the database schema

Postmill uses committed Prisma migrations. The canonical local apply path is:

```bash
pnpm run prisma-migrate-deploy-safe
```

This runs `prisma migrate deploy` and, if your database was created by the older `db push` workflow and lacks the `_prisma_migrations` table, automatically baselines the `0_init` migration before re-deploying.

When you edit `schema.prisma`, author a new migration with:

```bash
pnpm run prisma-migrate-dev
```

> `pnpm run prisma-db-push` and `pnpm run prisma-reset` are **local prototyping/reset only**. They produce no migration and must never be used against a shared or production database. See [Database](./database.md) for the full migration workflow and destructive-change guard.

---

## 4. Run the apps

### Minimal daily dev (recommended)

```bash
pnpm run dev:minimal      # backend + frontend only, no extension
```

### All apps (including extension)

```bash
pnpm run dev              # extension + backend + frontend
```

### Backend or frontend only

```bash
pnpm run dev:backend      # NestJS API on :3000
pnpm run dev:frontend     # Next.js on :4200
```

### Frontend dev variants

```bash
pnpm run dev:frontend     # Turbopack (default)
pnpm run dev:webpack      # webpack fallback if Turbopack exhausts memory
pnpm run analyze          # webpack bundle analyzer; reports in .next/analyze/
```

> The webpack dev build has a pre-existing failure on `/p/[id]` related to legacy CSS, so Turbopack remains the default.

---

## 5. Disable heavy subsystems you are not using

Set any of these environment variables before `pnpm run dev:minimal`. All flags default to **enabled**; set `=true` to skip that subsystem.

| Flag | What it disables |
|---|---|
| `DEV_DISABLE_AI` | AI adapter registration and AI surfaces |
| `DEV_DISABLE_MCP` | Mastra / MCP / A2A server startup |
| `DEV_DISABLE_MEDIA` | Media-generation adapter registration |
| `DEV_DISABLE_SHORTLINKS` | Short-link adapter registration |
| `DEV_DISABLE_EMAIL` | Email-provider adapter registration |
| `DEV_DISABLE_VIDEO` | Video-generation adapter registration |
| `DEV_DISABLE_AGENT` | Agent-graph services |
| `DEV_DISABLE_CRON` | `ScheduleModule.forRoot()` (used by session cleanup) |
| `DEV_DISABLE_SENTRY` | Sentry initialization |
| `DEV_DISABLE_OPENTELEMETRY` | OpenTelemetry exporter setup |

Example for a machine with limited RAM:

```bash
DEV_DISABLE_AI=true \
DEV_DISABLE_MCP=true \
DEV_DISABLE_MEDIA=true \
DEV_DISABLE_SHORTLINKS=true \
DEV_DISABLE_EMAIL=true \
pnpm run dev:minimal
```

When a subsystem is disabled, the related API routes may return `503` or skip capabilities; core posting and scheduling still work.

---

## 6. Memory and performance guidance

### Expected footprint

| Mode | Approximate backend | Approximate frontend |
|---|---|---|
| Full (`pnpm run dev`) | ~3 GB+ RSS | 5–6.5 GB native |
| Minimal with flags above | **~1–1.5 GB RSS** | **~2–3 GB** (Turbopack capped) |

The backend dev script caps the V8 heap at 2 GB via `--max-old-space-size=2048`. If you still hit the cap, disable more flags or lower it further.

### Frontend profiling and Sentry

- Sentry source-map upload is **disabled in dev** unless both `SENTRY_AUTH_TOKEN` and `NEXT_PUBLIC_SENTRY_DSN` are set.
- Browser profiling (`Document-Policy: js-profiling`) is **disabled in dev** unless `FRONTEND_PROFILING=1` is set.

### Pruning `node_modules`

If you need to reclaim disk space:

```bash
rm -rf node_modules apps/*/node_modules libraries/*/node_modules
pnpm store prune          # removes unreferenced packages from pnpm store
pnpm install
```

---

## 7. Tests

```bash
pnpm run test             # all packages in dependency order
pnpm run test:int         # real-Postgres integration tests
vitest run --root apps/backend            # one package
```

Tests run with Vitest. The root `jest.config.ts` is vestigial — do not add Jest-style configuration.

---

## 8. Lint

Lint runs from the repo root only:

```bash
pnpm exec eslint .
```

There is no per-package `lint` script.

---

## 9. Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend crashes with OOM | Heap cap or AI/media modules loaded | Add feature flags; lower heap further |
| Frontend dev is slow / fans spin | Turbopack memory pressure or Sentry plugin | Use `pnpm run dev:webpack` or set `DEV_DISABLE_SENTRY=true` |
| `/p/[id]` fails under webpack | Legacy CSS import | Use Turbopack (`pnpm run dev:frontend`) |
| Redis connection error | No Redis running | Start `docker compose -f ./docker-compose.dev.yaml up -d` |
| Inngest functions not running | Inngest dev server not started | Start with `--profile jobs` and set `USE_INNGEST=true` / `INNGEST_DEV=1` |
| Replicate async jobs never complete locally | Inngest poll sweep not running or unreachable webhook | Async Replicate jobs complete via the Inngest poll sweep (`media-jobs-poll` function). Start jobs with `--profile jobs`, set `USE_INNGEST=true` and `INNGEST_DEV=1`. Webhook completion requires a public `NEXT_PUBLIC_BACKEND_URL` (tunnel such as ngrok/cloudflared) reachable from Replicate's servers. |
| Replicate image-to-image/video/upscale fails with URL errors | Input file is not publicly reachable | Categories that feed a Files asset into the model (image-to-image, image-to-video, video-to-video, caption, inpaint, voice-clone, music-to-music, upscale) require a **public `https` input URL**. Local/private storage (`http://localhost…`, private IPs) will fail Replicate-side in local dev / private-storage self-hosts. |
| `prisma migrate deploy` fails with P3005 | Database was created by `db push` and has no migration history | Run `pnpm run prisma-migrate-deploy-safe` once to auto-baseline `0_init` |

---

## 10. Related docs

- [Database](./database.md) — Prisma migrate workflow and repository-only access
- [Backend Conventions](./backend-conventions.md) — NestJS layering
- [Frontend Conventions](./frontend-conventions.md) — Next.js App Router, SWR, Tailwind
- [Testing](./testing.md) — Vitest setup and CI
- [Contributing](./contributing.md) — PR workflow and invariants
- [Operations Guide: Requirements](../operations-guide/requirements.md) — Production sizing
