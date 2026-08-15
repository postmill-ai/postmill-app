#!/usr/bin/env bash
# Recreates the local container from the image docker-build.sh produces.
set -uo pipefail

cd "$(dirname "$0")/.."

docker kill postmill || true
docker rm postmill || true
docker create --name postmill -p 3000:3000 -p 4200:4200 localhost/postmill
