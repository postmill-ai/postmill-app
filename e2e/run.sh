#!/usr/bin/env bash
# Run Playwright tests in the official container against postiz.reaatech.com
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PW_VERSION="1.58.2"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-jammy"

echo "==> Pulling Playwright image ${IMAGE}..."
docker pull "${IMAGE}"

echo "==> Running tests..."
docker run --rm \
  --network=host \
  -v "${SCRIPT_DIR}:/e2e" \
  -w /e2e \
  -e CI=1 \
  "${IMAGE}" \
  bash -c "npm install --prefer-offline 2>/dev/null; npx playwright test $*"
