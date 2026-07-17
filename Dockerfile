# Production backend image — multi-stage, non-root, ONE node process per container.
#
# Differs from Dockerfile.dev (which bundled devDeps + ran nginx + PM2): this builds in a
# throwaway stage, prunes dev dependencies, and the runtime stage runs the compiled backend
# directly as an unprivileged user. Horizontal scaling is the orchestrator's job (run N
# replicas) — NOT PM2 inside the container.
#
# Build:  docker build -f Dockerfile -t postmill-backend .
# Run:    docker run -p 3000:3000 --env-file .env postmill-backend
#
# The frontend is built/served separately. This image is the NestJS API + Inngest handler.

# ---------- builder ----------
FROM node:22.20-bookworm-slim AS builder

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
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build:backend

# Drop devDependencies so only production deps ship in the runtime stage. Native modules
# stay compiled; pruning only removes extraneous (dev) packages.
RUN pnpm prune --prod

# ---------- runtime ----------
FROM node:22.20-bookworm-slim AS runtime

# Runtime shared libraries: chromium + ffmpeg (in-process video renderer when Podman is
# off), fonts, and the native libs canvas links against. No build toolchain here.
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Distro Chromium for puppeteer (no bundled download); matches Containerfile.render.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV TZ=UTC
ENV PORT=3000

# Unprivileged user — the process must not run as root.
RUN addgroup --system app \
 && adduser --system --ingroup app --home /app --shell /usr/sbin/nologin app

WORKDIR /app
# Copy the built workspace (dist + pruned prod node_modules + workspace package links).
COPY --from=builder --chown=app:app /app /app

USER app

EXPOSE 3000

# Liveness probe hits /health/live (G2) — cheap, always-200 while the process serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health/live || exit 1

# Single node process — no PM2, no shell supervisor.
CMD ["node", "--experimental-require-module", "/app/dist/apps/backend/src/main.js"]
