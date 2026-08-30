# Scaling & Deployment

This page covers running Postmill in production: the published all-in-one image,
horizontal scaling, health probes, graceful shutdown, fail-fast configuration, the
collaboration single-instance constraint, and OpenTelemetry tracing.

## Production image (all-in-one)

Use the multi-stage [`Dockerfile`](https://github.com/postmill-ai/postmill-app/blob/main/Dockerfile)
at the repo root for production — **not** `docker/Dockerfile.dev`. The differences matter:

| | `docker/Dockerfile.dev` | `Dockerfile` (production) |
|---|---|---|
| Dependencies | all (including devDependencies) | production only (`pnpm prune --prod`) |
| Process model | `nginx` + PM2 (multiple processes) | `nginx` + backend + frontend via a plain bash entrypoint (no PM2) |
| User | root | unprivileged `app` user |
| Build | in-image, every boot | separate builder stage, artifacts only |
| Healthcheck | none | `HEALTHCHECK` → `/health/live` through nginx |

```bash
docker build -f Dockerfile -t postmill-app .
docker run -p 4007:5000 --env-file .env postmill-app
```

**All-in-one process model.** The image runs three processes under
[`docker/entrypoint.sh`](https://github.com/postmill-ai/postmill-app/blob/main/docker/entrypoint.sh):
nginx on container port **5000** (the only published port), the NestJS backend on 127.0.0.1:**3000**,
and the Next.js frontend prod server on 127.0.0.1:**4200**. nginx routes `/api/*` to the backend
(stripping the `/api` prefix — the backend serves routes at root), serves `/uploads/*` from the
uploads volume, and proxies everything else to the frontend. There is no PM2: the entrypoint is a
plain bash script that starts the three children, traps signals, and exits if any child dies, so the
container restart policy restores a healthy stack.

**Install-agnostic frontend URL.** The frontend build bakes `NEXT_PUBLIC_BACKEND_URL` into the
client bundles and the CSP `connect-src`, so the image is built with a placeholder URL
(`https://backend-url-not-set.postmill.invalid/api`) which the entrypoint substitutes with the real
runtime `NEXT_PUBLIC_BACKEND_URL` across `.next/` on every container start.

**Scaling out** means running N replicas of this container behind a load balancer (Kubernetes
`replicas`, ECS desired count, Nomad `count`, etc.). The collaboration caveat below applies to the
backend inside each replica.

### Render worker image

The Podman video-render worker (`docker/Containerfile.render`) also runs as an unprivileged user
(`render`), not root. See [Video Rendering](./video-rendering.md).

## Horizontal scaling

The backend is largely stateless and safe to run as multiple replicas, with these
caveats:

- **Database & Redis** are shared across replicas (Postgres, Redis). Tune the Prisma pool
  with `DATABASE_CONNECTION_LIMIT` / `DATABASE_POOL_TIMEOUT` so N replicas plus the Inngest
  worker don't exhaust Postgres connections.
- **Background jobs** run on Inngest, which handles its own concurrency/idempotency — they
  are not duplicated per replica.
- **Collaboration websocket** is **not** multi-replica-safe by default — see below.

## Collaboration single-instance constraint

The real-time collaboration websocket (`/collaboration`) keeps a live Yjs document per room
**in process memory** with no shared backing store. If two replicas serve clients editing
the same document, their in-memory copies diverge and edits are silently lost.

Until a shared adapter ships (tracked follow-up below), pick one of:

1. **Pin collaboration to a single replica** with sticky sessions (route `/collaboration`
   to one dedicated backend instance), or
2. Run a single backend replica for deployments that don't need horizontal scale.

### `COLLAB_SINGLE_INSTANCE`

| Variable | Default | Meaning |
|---|---|---|
| `COLLAB_SINGLE_INSTANCE` | `true` | Asserts the collaboration websocket is pinned to one replica. The default is safe. |
| `COLLAB_REDIS_ADAPTER` | _(unset)_ | Reserved for the future Yjs-over-Redis adapter. Not yet implemented. |

If you set `COLLAB_SINGLE_INSTANCE=false` **without** `COLLAB_REDIS_ADAPTER`, the backend
logs a loud warning at boot — you are asserting multi-replica collaboration with no shared
state, which loses edits.

> **Tracked follow-up:** full Yjs-over-Redis (or `y-websocket` Redis adapter) sync so the
> collaboration websocket can run on multiple replicas without sticky sessions. Not
> implemented in this release; `COLLAB_REDIS_ADAPTER` is the reserved switch for it.

## Health probes (liveness vs readiness)

Three endpoints, all unauthenticated and throttle-exempt:

| Endpoint | Cost | Returns | Use for |
|---|---|---|---|
| `GET /health/live` | cheap, no dependencies | always `200` while the process serves | container `HEALTHCHECK`, orchestrator **liveness** probe |
| `GET /health/ready` | checks DB + Redis | `200` when both are reachable, `503` otherwise with per-dependency status | orchestrator **readiness** probe (gate traffic) |
| `GET /health` | checks Inngest wiring + last cron runs | `200` summary | operator dashboard / debugging |

`/health/ready` returns a per-dependency body so you can see which hard dependency is down:

```json
{
  "status": "unavailable",
  "timestamp": "...",
  "dependencies": {
    "database": { "ok": false, "error": "..." },
    "redis": { "ok": true }
  }
}
```

Wire liveness to `/health/live` and readiness to `/health/ready`. Don't use `/health/ready`
for liveness — a transient DB blip would restart an otherwise healthy process.

## Graceful shutdown

On `SIGTERM`/`SIGINT` the backend drains in order: it stops accepting new work, runs
NestJS shutdown hooks (`app.close()`), which disconnects Prisma and quits the Redis
connection, then exits once. Give the container a sensible termination grace period (for example,
Kubernetes `terminationGracePeriodSeconds: 30`) so in-flight requests finish.

## Fail-fast configuration validation

In production the backend refuses to start on a fatal misconfiguration instead of serving
broken traffic. Fatal (boot-blocking) issues:

- `JWT_SECRET` missing or shorter than 32 characters
- `DATABASE_URL` missing
- neither `FRONTEND_URL` nor `MAIN_URL` set
- Inngest keys (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) missing when `INNGEST_DEV` is
  not `1`

The exit fires when `NODE_ENV=production` (and `NOT_SECURED` is unset), or anywhere
`CONFIG_CHECK_STRICT` is set. In local development without `CONFIG_CHECK_STRICT`, these are
warnings and the backend still starts. All other configuration problems
(unrecognized env vars, missing `ENCRYPTION_KEY`, etc.) remain non-fatal warnings.

| Variable | Default | Meaning |
|---|---|---|
| `CONFIG_CHECK_STRICT` | _(unset)_ | When set, fatal config issues exit the process **everywhere** (including dev), not just in production. |

## OpenTelemetry tracing

The backend can export traces via OTLP/HTTP. It is **off by default** and no-ops unless an
endpoint is configured — there is no overhead when unset.

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset)_ | OTLP/HTTP traces endpoint, for example `http://otel-collector:4318/v1/traces`. Setting it enables tracing. |
| `OTEL_SERVICE_NAME` | `postmill-backend` | Service name attached to exported spans. |
| `DEV_DISABLE_OPENTELEMETRY` | _(unset)_ | When set, forces OpenTelemetry off even if an endpoint is configured (local-dev override). |

When enabled, Node auto-instrumentations (HTTP, Express/Nest, Postgres, Redis, undici, …)
are registered and traces are shut down cleanly on `SIGTERM`/`SIGINT` alongside the
graceful-shutdown path.

> Verified against v1.0.0
