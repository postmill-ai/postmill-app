# Fork image builds and manual VPS updates

Repository: AREN-876/postmill-app. PR #3: fix/openai-gpt6-compat.
No automatic deployment, SSH credentials, personal tokens or VPS build jobs exist
in this workflow. It does not create posts or call OpenAI.

## First upgrade: STOP pending database review

Review baseline: source `a5bff720`, Postmill v1.4.0, official image:

```
ghcr.io/postmill-ai/postmill-app@sha256:9cdd31b251c8941a2eaa86f99ef1a48cc1b1dd1a282ad31b425de949d957b948
```

Compared with PR #3 implementation `8f26f9cf` (and the subsequent CI/helper-only
commit in the same branch):

- Two new migrations:
  `20261102160000_add_user_preferred_language_and_email_campaigns` adds nullable
  UserProfile.preferredLanguage and EmailLog.campaignId, a unique campaign/address
  index and a campaign/status index. Existing campaign IDs start NULL; PostgreSQL
  permits multiple NULLs in this unique index. Index creation can still lock or
  burden a large EmailLog table.
  `20261108001500_add_org_portability_jobs` adds OrgPortabilityJob, indexes and
  foreign keys to Organization/User with cascade behavior for the **new** table.
- No existing migrations were deleted/rewritten. Schema diff adds 29 lines.
  These are additive changes, but new code expects the added fields/table.
  Starting it on the old schema is not an approved update plan.
- Dockerfile, entrypoint, nginx production config and root Compose are unchanged
  between the two source versions. Node remains 24.19.0. Dependencies/lockfile
  changed upstream; v1.4.0 alone does not establish binary/schema equivalence.
- `.env.example` adds optional platform S3 settings and organization archive/spool
  limits. Local storage remains the default. `STORAGE_PROVIDER=s3` now requires
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION and S3_PUBLIC_URL;
  incomplete/non-local storage configuration can fail startup. No storage move
  is part of this upgrade. Private archive spool paths must be writable and
  outside public uploads if that feature is later enabled.
- Epure DSNs are optional, not required. Inngest key/base-URL guidance was clarified;
  this does not authorize replacing the existing engine or its configuration.
  gpt2giga base URL, mounted CA, NODE_EXTRA_CA_CERTS, JWT_SECRET, encryption key and
  all existing environment values must remain unchanged.
- `docker/entrypoint.sh` and PrismaService do **not** run DDL migrations on boot;
  PrismaService connects only. Some agent documentation says otherwise; code was
  inspected directly. Normal application seeders/backfills can write data after
  startup, so even an image-only rollback is not a data restore.

**Current decision: no VPS deployment or migration.** Back up PostgreSQL and
persistent uploads, test the exact target schema on a restored isolated copy,
review downtime/index locks and confirm the migration plan separately. The helper
refuses this first transition by default because migration/schema fingerprints
change. It never runs migration commands, resets a database or edits its ledger.
No working VPS files, actual DB schema or certificate were read in this task;
compatibility of those private overrides is checked by the script on the host.

Reproduce source review for future releases (from a separate workstation checkout):

```bash
git diff --name-status a5bff720 TARGET_SHA -- libraries/nestjs-libraries/src/database/prisma/migrations
git diff a5bff720 TARGET_SHA -- libraries/nestjs-libraries/src/database/prisma/schema.prisma .env.example
git diff a5bff720 TARGET_SHA -- Dockerfile docker/entrypoint.sh docker/nginx.prod.conf docker-compose.yaml
```

## GitHub setup and build contract

The separate workflow is **Fork image** (`.github/workflows/fork-image.yml`).
It runs only in this fork, on pushes to `fix/openai-gpt6-compat` and `main`, plus
manual dispatch on those refs. The inherited upstream release job is guarded to
run only in postmill-ai/postmill-app, so fork tags cannot publish upstream latest.

**Before PR merge:** pushing this branch runs the workflow defined on this branch.
GitHub only enables workflow_dispatch for a workflow present on the default
branch; `gh workflow run --ref ...` is not a bootstrap workaround. If Actions are
not yet enabled for this fork, enable them in GitHub Actions first, then rerun a
failed/eligible run or push a new branch commit. No main merge is required for
the push trigger. Do not enable write secrets for untrusted pull requests.

**After merge:** protect main with reviewed PRs and the relevant existing required
checks (including the image job). Avoid direct main pushes. Repository approval
policy is a GitHub setting and has not been changed by this code. After the
workflow exists on main, manual builds use:

```bash
gh workflow run fork-image.yml --repo AREN-876/postmill-app --ref main
# or --ref fix/openai-gpt6-compat while that branch is retained
```

Builds use GitHub-hosted linux/amd64 Buildx, the existing Dockerfile, frozen pnpm
lockfile and GHA cache. Token permissions are contents:read and packages:write.
Only `ghcr.io/aren-876/postmill-app:FULL_40_CHARACTER_SHA` is pushed; no latest,
version or postmill-ai tag is written. Existing SHA tags are refused by a paginated
GHCR package-versions check. Same-SHA runs are serialized. A rerun after successful
publication deliberately fails the no-overwrite check; use that image or make a
new commit. GHCR tags are not intrinsically immutable against other authorized
writers: the VPS helper resolves the tag once and persists its immutable digest.

Before publishing, the built image is loaded and checked for amd64, non-root user,
entrypoint syntax/path, compiled backend, built frontend and Prisma CLI. It is
booted with synthetic values in an internal Docker network, with disposable
PostgreSQL/Redis. Only the throwaway tmpfs DB is initialized with `db push`; this
is not a deployment migration and cannot access the production DB. AI and optional
integrations are disabled and the internal network prevents real OpenAI calls.
The test requires Docker HEALTHCHECK healthy, backend readiness and frontend HTTP
through nginx. A failed smoke test prevents publication. CI-only containers and
network are removed; no global prune or volume deletion is used.

The job summary records both SHA tag and registry digest. Keep that summary.
For anonymous VPS pulls, make the fork's GHCR package public in package settings.
If keeping it private, an operator must configure Docker pull authentication
(read:packages) separately on the VPS; no pull credential is embedded in scripts
or committed here. GITHUB_TOKEN is only for the CI job, not a permanent VPS login.

## Install helpers on the VPS (does not update the application)

Prerequisites: Python 3, Docker Compose >=2.20, local Docker socket permission,
and a root-controlled /opt/postmill directory. Retain the three existing Compose
files and .env exactly as configured. The helper always uses local Docker,
project `postmill`, service `postmill`, container `postmill-postmill-1`.

Download files from a **reviewed full commit SHA**, not a moving branch. These
commands can be run manually on the VPS after replacing the first value with the
CI/helpers commit printed in the review report. They install scripts only:

```bash
set -euo pipefail
CI_COMMIT='REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT_SHA'
case "$CI_COMMIT" in (*[!0-9a-f]*|'') echo 'Use a full commit SHA'; exit 1;; esac
[ "${#CI_COMMIT}" -eq 40 ] || exit 1
stage=$(mktemp -d)
base="https://raw.githubusercontent.com/AREN-876/postmill-app/$CI_COMMIT/tools/deploy"
curl --fail --location "$base/postmill-update" -o "$stage/postmill-update"
curl --fail --location "$base/postmill-rollback" -o "$stage/postmill-rollback"
curl --fail --location "$base/compose.image.yaml.example" -o "$stage/compose.image.yaml"
python3 "$stage/postmill-update" --help
bash -n "$stage/postmill-rollback"
sudo install -o root -g root -m 0755 "$stage/postmill-update" /usr/local/sbin/postmill-update
sudo install -o root -g root -m 0755 "$stage/postmill-rollback" /usr/local/sbin/postmill-rollback
sudo install -d -o root -g root -m 0700 /opt/postmill/.postmill-update
# Do not overwrite any pre-existing fourth override.
if sudo test -e /opt/postmill/compose.image.yaml; then
  echo 'Fourth override already exists: leave it unchanged and review it.'
else
  sudo install -o root -g root -m 0600 "$stage/compose.image.yaml" /opt/postmill/compose.image.yaml
fi
rm -r "$stage"
# Validate without exposing expanded environment/secrets.
cd /opt/postmill
sudo docker compose --project-name postmill --project-directory /opt/postmill \
  -f compose.yaml -f compose.override.yaml -f compose.giga.yaml -f compose.image.yaml config --quiet
```

The initial fourth file pins the exact **currently reported** official image. It
contains only services.postmill.image. Installing it does not recreate containers.
If the server has moved to another image, stop and review the initial reference.
Private repositories may require an authenticated download outside this recipe;
never paste tokens into URLs or commit them. Inspect downloaded scripts before
installing with sudo. Commands above were prepared, not executed on the VPS.

## Manual operation after separate release approval

For a release with **identical** schema/migration fingerprints:

```bash
sudo /usr/local/sbin/postmill-update FULL_40_CHARACTER_IMAGE_SHA
sudo /usr/local/sbin/postmill-rollback
```

Do **not** execute the first command for the initial PR #3 upgrade until the DB
review described above is complete. When fingerprints differ, the refusal prints
a target-specific `--reviewed-schema HASH`. That option is only an acknowledgement
of separately approved and prepared DB compatibility (for both update and
rollback); it neither verifies applied migration status nor performs migrations.
Do not copy it mechanically to bypass a refusal. There is deliberately no generic
"force" or automatic migration option.

The helper pulls the SHA tag, verifies image source/revision/architecture, pins its
registry digest, compares schemas without running the application, validates the
four-file merge and checks live environment/mount/network drift. Unmanaged docker
network connections or changed live env/mounts cause a refusal: first reconcile
those declarations in existing Compose files, rather than silently dropping them.
It modifies only compose.image.yaml and its private state directory; it never
edits .env, certificates, keys or the first three files.

Deployment runs exactly a single-service `compose up -d --no-deps --no-build
--pull never --wait --wait-timeout 300 postmill`. POSTMILL_WAIT_TIMEOUT can be
set to 1..1800 seconds; POSTMILL_DIR defaults to /opt/postmill. Root invocations
must preserve a chosen override explicitly, e.g. `sudo env POSTMILL_WAIT_TIMEOUT=600 ...`.
It requires healthy plus backend readiness and frontend HTTP, verifies the final
image ID and checks other project services did not restart/change. It never
recreates PostgreSQL, Redis, Inngest or gpt2giga. There is a short application
interruption; this is not a zero-downtime deployment.

Previous reference/image ID is recorded durably. Failed/interrupted updates keep
pending.json and block another forward update. After inspecting the failure,
postmill-rollback restores the previous pinned image and waits for health, including
when the failed container stopped. It does not automatically downgrade a changed
DB, restore data or authorize cross-schema rollback. No destructive cleanup is
performed. Keep disk space for at least current + candidate + rollback images;
4 GB RAM/2 CPU VPS performs pulls/startup only, with no compilation. Avoid running
unrelated resource-heavy jobs during restart; monitor memory and available disk.

## Validation record and remaining limits

- `actionlint` validates the new workflow and upstream job guard.
- `bash -n` validates smoke script and rollback wrapper.
- 13 offline tests cover image-only update/rollback, interrupted operations,
  health failures, schema gate, concurrent lock, foreign state, runtime drift,
  non-target restart detection, secret-safe failures and a real Docker Compose
  four-file merge preserving gpt2giga, certificate, networks and named volumes.
- The full image build/boot/publish must still complete green on GitHub Runner.
  No image is represented here as successfully built merely because YAML passed.
- Previous local build verification found mismatched installed Sentry transport
  types; frozen CI uses the committed dependency tree and the image build remains
  a hard gate. No production deployment is allowed on a failed/red build.
- GHCR/API permission errors must be fixed in GitHub settings; tokenless or
  personal-token fallbacks are not introduced by the workflow.
