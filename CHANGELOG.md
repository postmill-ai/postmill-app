# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Container images could not start.** Both `Dockerfile` and `Containerfile.render` ran an
  entrypoint under `/app/dist/...`, but `pnpm run build:backend` emits to `apps/backend/dist/...`
  and `.dockerignore` excludes `dist` from the build context, so the path never existed in the
  image. CI published green because it only ran `docker buildx imagetools inspect`, which reads
  registry metadata and never starts the container; a smoke step that asserts the entrypoint file
  exists now runs after every push.
- **`NEXT_PUBLIC_VERSION` was discarded.** CI passed it as a `--build-arg`, but the production
  `Dockerfile` declared no matching `ARG`, so released images carried no version.
- **`pnpm run docker-build` was broken** (since before the fork): it passed `--target dist` and
  `--target devcontainer` to a single-stage Dockerfile. Also fixed the dev container, which pinned
  an image only that broken build produced.
- **Password-reset confirmation could be skipped.** `ForgotReturnPasswordDto` compared
  `repeatPassword` against a random per-process sentinel; a request that happened to submit the
  live sentinel bypassed the match check. Replaced with a real cross-field validator — same
  behaviour and error message otherwise.

### Changed

- **Docker files consolidated into `docker/`.** `docker-compose.yaml`, `Dockerfile`, and
  `.dockerignore` stay at the repository root; the dev compose files, `Dockerfile.dev`,
  `Dockerfile.dev-live`, `Containerfile.render`, and the former `var/docker/` contents moved.
  **Production upgrades are unaffected** — no volume, env var, or image reference changes. Building
  from source or running the dev stack uses new paths; see
  [Upgrading](./docs/operations-guide/upgrading.md). The dev compose files now pin
  `name: postmill-app` so the move does not re-prefix dev volumes.
- **Repo-owned tooling moved to `tools/`** (`tools/db`, `tools/codegen`); root `scripts/` is now
  maintainer-local and untracked. Operator-facing: `scripts/postmill-migrate.sh` is now
  `tools/db/postmill-migrate.sh`.
- **`openapi.yml` is now generated** from the controllers instead of hand-maintained, with a CI
  drift gate. It covers 465 paths with inferred request/response schemas (previously 234 paths and
  none) and reports the real release version (previously a stale `3.4.0`). Regenerate with
  `pnpm run openapi:generate`; do not hand-edit.
- **Inherited CI/deploy scaffolding brought up to date** so it works if adopted: the Jenkins
  pipelines (Node 20 → 22, pnpm 8 → 10.34.4, current sonar-scanner, native build deps) and
  `railway.toml` (pinned `nodejs_22`).
- **Default image models:** OpenAI's default image model moved from `dall-e-3` to
  `gpt-image-1` (dall-e-3 is gone for new API keys) and Replicate's from
  `black-forest-labs/flux-schnell` (retired upstream) to `black-forest-labs/flux-1.1-pro`.
  Orgs that pinned a model are unaffected — explicit model selections still win.

### Security

- **F1 — role privilege escalation:** assigning roles now requires the target role's permissions
  to be a subset of the actor's effective permissions (`manage` expanded to its implied actions).
  All three role-resolution paths (role change, create-user, invite) are org-scoped, and an
  org can never be left without an owner (demotion *and* removal of the last owner are rejected).
- **F11 — OAuth `state` entropy:** every social adapter now issues 128-bit CSPRNG states via
  `makeOauthState()` (previously as low as 24 bits), and consumed `organization:` capability keys
  are deleted after use (single-use, closing replay for `customFields` providers).
- **F9 — proxy-aware rate limiting:** the HTTP throttler (and the MCP rate limits) resolve the
  client IP from `X-Forwarded-For` via `TRUST_PROXY_HOPS` (Nth-from-right). **Operator action
  required:** set `TRUST_PROXY_HOPS` to the exact number of XFF-appending proxies; unset keeps the
  previous socket-peer behavior.
- **F8 — `/uploads` path containment:** the serve route now enforces env-guard → resolve+prefix →
  stat → is-file → symlink (`realpath`) containment before streaming (404 on any escape).
- **M1/M2:** `NOT_SECURED` now relaxes helmet and cookie flags only in development; the CSRF
  body-field exemption (`jwt`/`params`) was removed (exemption keys on auth source only).

### Billing & quotas

- **F2 — BYO storage is paywalled:** creating/mounting (or repointing a mounted) non-LOCAL storage
  config now requires a plan with `byo_storage` (TEAM/AGENCY); the storage meter waive applies only
  to entitled orgs, in both the policy layer and `assertWithinQuota`. Existing STARTER/PRO mounts
  are re-metered on deploy (see rollout note in the PR).
- **F5 — dunning grace enforced:** `gracePeriodEnd` is cleared on genuine recovery
  (`active`/`trialing` only, with live-status verification before entering grace), and lapsed grace
  now collapses entitlement to baseline.
- **F4 — video-export quota:** in-flight renders count toward the per-cycle cap (TOCTOU closed,
  self-healing on failure).

### Reliability

- **F3 — token refresh chains:** unique Inngest idempotency ids for start *and* reschedule events
  (constant ids were dedup-black-holed); `integration/refresh-token/cancel` is now actually emitted
  (channel delete + reconnect); chains terminate on `refreshNeeded` or 5 consecutive failed cycles
  instead of hot-looping or silently dying.
- **F6 — webhooks:** linking a foreign org's integration to a webhook is rejected (400).
- **M4 — upload orphan bytes:** a failed post-write step (quota, folder ownership, DB error) now
  best-effort deletes the already-stored object.
- **M3:** removed the never-wired `AiThrottlerGuard` (dead code with a singleton-mutation race).

### UX & docs

- **F10 — login page:** social-login buttons are advertised only when the provider is actually
  configured (DB config or complete platform env credentials) — no more phantom Google/GitHub
  buttons; `POSTMILL_GENERIC_OAUTH` now compares `=== 'true'`; register uses the same fetched
  provider list as login.
- **F7 — docs:** pnpm version corrected (10.34.4), 26 operator env vars documented,
  `TRUST_PROXY_HOPS` broadened to the HTTP tier with the correct default, and login-provider
  administration clarified (separate administration app; no `/admin` UI in this repo).

## [1.0.0] — 2026-07-12

- First public release of Postmill.
- Upgrading from a pre-v1.0.0 build? See [docs/operations-guide/upgrading.md](docs/operations-guide/upgrading.md).
