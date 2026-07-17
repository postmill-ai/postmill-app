#!/usr/bin/env bash

docker kill postmill || true 
docker rm postmill || true 
docker create --name postmill -p 3000:3000 -p 4200:4200 localhost/postmill
