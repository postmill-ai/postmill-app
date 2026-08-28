# Production all-in-one image — multi-stage, non-root.
#
# One container runs the whole app: nginx fronts it on :5000, routing /api/* to
# the NestJS backend (127.0.0.1:3000, /api prefix stripped), /uploads/* to the
# uploads volume, and everything else to the Next.js frontend prod server
# (127.0.0.1:4200). The three processes are spawned by docker/entrypoint.sh
# (plain bash `&` + `wait -n` + signal trap — deliberately no PM2; if any
# process dies the entrypoint exits and the orchestrator restarts the
# container). This matches the contract of the root docker-compose.yaml, which
# publishes 4007:5000 and points the browser at NEXT_PUBLIC_BACKEND_URL
# http://localhost:4007/api.
#
# Differs from docker/Dockerfile.dev (which bundled devDeps + ran nginx + PM2 as
# root): this builds in a throwaway stage, prunes dev dependencies, and the
# runtime stage runs as an unprivileged user.
#
# Build:  docker build -f Dockerfile -t postmill-app .
# Run:    docker run -p 4007:5000 --env-file .env postmill-app
# (docker/Containerfile.render remains the separate Podman video-render worker.)

# ---------- builder ----------
FROM node:24.19.0-bookworm-slim AS builder

# Toolchain for native modules (canvas, sharp, bcrypt) compiled during install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3-pip \
    bash \
    ca-certificates \
&& rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm --no-update-notifier --no-fund --global install pnpm@10.34.4

WORKDIR /app
COPY . /app

RUN pnpm install --frozen-lockfile

# The frontend bakes NEXT_PUBLIC_BACKEND_URL at build time (client chunks AND
# the CSP connect-src in .next/routes-manifest.json; the CSP guard in
# apps/frontend/next.config.ts fails the build without it). For an
# install-agnostic image we build with a placeholder absolute URL that survives
# minification byte-identical; docker/entrypoint.sh seds the real runtime value
# across .next/ on container start.
ENV NEXT_PUBLIC_BACKEND_URL=https://backend-url-not-set.postmill.invalid/api
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build \
    # The Turbopack/Webpack build cache (~700 MB) is useless at runtime and still
    # contains the placeholder URL; drop it so it never ships in the image.
 && rm -rf apps/frontend/.next/cache

# Drop devDependencies so only production deps ship in the runtime stage. Native modules
# stay compiled; pruning only removes extraneous (dev) packages. CI=true: without a TTY
# pnpm aborts the modules-dir purge (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
# The frontend's prod server is `next start`; `next` is a production dependency of
# apps/frontend, so it survives this prune (at the root /app/node_modules — the prune
# empties per-workspace node_modules, so the entrypoint calls /app/node_modules/.bin/next).
RUN CI=true pnpm prune --prod

# ---------- runtime ----------
FROM node:24.19.0-bookworm-slim AS runtime

# build-containers.yml passes --build-arg NEXT_PUBLIC_VERSION=<git tag>. Without this
# ARG/ENV pair Docker accepted the flag and discarded it, so the released image carried
# no version at all. Consumed by the Swagger document (served at /docs).
ARG NEXT_PUBLIC_VERSION
ENV NEXT_PUBLIC_VERSION=$NEXT_PUBLIC_VERSION

# Runtime shared libraries: nginx (front proxy), chromium + ffmpeg (in-process video
# renderer when Podman is off), fonts, and the native libs canvas links against.
# No build toolchain here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-dejavu-core \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    ca-certificates \
    curl \
&& rm -rf /var/lib/apt/lists/*

# Distro Chromium for puppeteer (no bundled download); matches docker/Containerfile.render.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV TZ=UTC
# Backend listen port (internal — only nginx's :5000 is published).
ENV PORT=3000

# Unprivileged user — the processes must not run as root.
RUN addgroup --system app \
 && adduser --system --ingroup app --home /app --shell /usr/sbin/nologin app

WORKDIR /app
# Copy the built workspace (dist + .next + pruned prod node_modules + workspace links,
# plus docker/entrypoint.sh and docker/nginx.prod.conf, which the build context carries).
COPY --from=builder --chown=app:app /app /app

USER app

EXPOSE 5000

# Liveness probe goes through nginx to the backend's /health/live (G2) — it fails
# if either nginx or the backend is down. The frontend is covered indirectly:
# its death kills the entrypoint (wait -n) and restarts the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/api/health/live || exit 1

# Path note: `pnpm run build:backend` runs `nest build` inside apps/backend, whose
# tsconfig.build.json sets outDir "./dist" — so the compiled entrypoint lands at
# apps/backend/dist/apps/backend/src/main.js, NOT at a repo-root dist/. (The root
# dist/ is excluded from the build context by .dockerignore and holds only out-tsc.)
# This is the same path .github/workflows/boot-guard.yml executes.
ENTRYPOINT ["bash", "/app/docker/entrypoint.sh"]
