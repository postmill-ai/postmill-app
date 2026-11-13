# Fork CI and manual image updates

Operator runbook and baseline review: `docs/fork-image-updates.md`.

- `.github/workflows/fork-image.yml` builds only AREN-876/postmill-app, on main,
  the initial fix/openai-gpt6-compat branch, or manual dispatch on these refs.
  Dispatch only becomes available when the workflow is present on the default
  branch; use branch push for pre-merge bootstrap.
- The upstream release writer is repository-guarded. Never publish the fork's
  images to postmill-ai or add latest/rolling tags to the fork workflow.
- Build linux/amd64 on GitHub, smoke the loaded image before push. The smoke
  network is internal; its tmpfs PostgreSQL is disposable, not production.
  Do not provide working API keys. CI initializes that empty schema only.
- Keep image tags full SHA; refuse existing tags. Operators pin registry digests.
  GITHUB_TOKEN needs contents:read/packages:write only. No SSH/deploy credentials.
- `tools/deploy/postmill-update` and postmill-rollback share the four-file merge
  contract: compose.yaml, compose.override.yaml, compose.giga.yaml, compose.image.yaml.
  Only the fourth file's image and private update state may change. Never build
  on VPS, run down/prune/volume removal, or recreate dependencies.
- Keep default schema/migration mismatch refusal. Reviewed target hashes are a
  per-target acknowledgement after separately approved DB preparation, not a
  migration/status-check command. Image rollback never restores DB schema/data.
- Preserve pending state for interrupted operations. Do not bypass drift checks
  for live mounts/environment/networks or the immutable image-ID comparison.
- Checks: actionlint; bash -n for shell files; PYTHONDONTWRITEBYTECODE=1 python3
  -m unittest discover -s tools/deploy -p 'test_*.py'. A green syntax/unit run
  does not establish a green full-image build, boot, GHCR push or VPS upgrade.
