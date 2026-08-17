#!/bin/bash
# Builds the all-in-one local image (nginx + PM2 serving backend and frontend) from
# docker/Dockerfile.dev. Pair with docker-create.sh to run it.
#
# The build context is the repo root, so this cd's there regardless of where it is
# invoked from — `pnpm run docker-build` and a bare ./docker/docker-build.sh both work.
#
# Note: this is NOT the image CI publishes. That is the root Dockerfile (backend only,
# multi-stage, non-root), built by .github/workflows/build-containers.yml.
set -euo pipefail
set -o xtrace

cd "$(dirname "$0")/.."

docker rmi localhost/postmill || true
docker build -t localhost/postmill -f docker/Dockerfile.dev .
