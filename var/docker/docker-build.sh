#!/bin/bash

set -o xtrace

docker rmi localhost/postmill || true
docker build --target dist -t localhost/postmill -f Dockerfile.dev .
docker build --target devcontainer -t localhost/postmill-devcontainer -f Dockerfile.dev .
