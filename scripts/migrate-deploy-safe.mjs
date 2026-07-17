#!/usr/bin/env node
/**
 * migrate-deploy-safe.mjs
 *
 * `prisma migrate deploy`, but safe to run against a database that was created by the
 * pre-ENHANCEMENTS_3 `prisma db push` workflow (i.e. has all the tables but no
 * `_prisma_migrations` history). On such a DB a bare `migrate deploy` aborts with
 * **P3005 "The database schema is not empty"**. This wrapper detects that, baselines the
 * committed `0_init` migration as already-applied (`migrate resolve --applied 0_init`),
 * then re-runs `migrate deploy`.
 *
 * Behaviour:
 *   - Empty DB (CI / boot-guard)           → deploy applies 0_init + later migrations. No baseline.
 *   - Existing db-push DB (local dev/prod)  → P3005 → auto-baseline 0_init → deploy. One-time, idempotent.
 *   - Already-baselined DB                  → deploy is a no-op (or applies new migrations).
 *
 * Used by `pnpm run prisma-migrate-deploy-safe` (pm2-run + CI). The raw
 * `prisma-migrate-deploy` script stays available for explicit use.
 *
 * No external deps — shells out to the pinned prisma CLI.
 *
 * ASSUMPTIONS / sharp edges:
 *   - The auto-baseline marks `0_init` as applied WITHOUT verifying the live DB matches it.
 *     This is correct only because `0_init` is generated from the current `schema.prisma`,
 *     and any db-push DB in this repo was pushed from that same schema. Do NOT point this at
 *     a DB that was last pushed from an OLDER schema — it would be marked baselined while
 *     missing newer columns. Use `pnpm run prisma-reset` to rebuild such a DB instead.
 *   - Baseline detection keys on Prisma's **P3005** error code (pinned at prisma@6.5.0). If a
 *     future Prisma changes that code/message, the deploy falls through to a hard fail (the
 *     safe direction) rather than baselining blindly — re-pin/adjust the match if you bump prisma.
 */

import { execFileSync } from 'node:child_process';

const SCHEMA = './libraries/nestjs-libraries/src/database/prisma/schema.prisma';
const PRISMA = ['dlx', 'prisma@6.5.0'];
const BASELINE = '0_init';
// Generous cap so a large committed migration set can't trip the default 1 MB stdout buffer.
const MAX_BUFFER = 64 * 1024 * 1024;

function prisma(args, { capture = false } = {}) {
  return execFileSync('pnpm', [...PRISMA, ...args, '--schema', SCHEMA], {
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
}

function deploy() {
  // Capture so we can inspect the failure for P3005 without losing the output.
  return prisma(['migrate', 'deploy'], { capture: true });
}

try {
  const out = deploy();
  process.stdout.write(out);
  console.log('migrate-deploy-safe: migrations applied.');
} catch (err) {
  const text = `${err.stdout || ''}${err.stderr || ''}`;
  process.stdout.write(text);

  const needsBaseline =
    text.includes('P3005') ||
    /database schema is not empty/i.test(text);

  if (!needsBaseline) {
    console.error('migrate-deploy-safe: deploy failed (not a baseline case).');
    process.exit(1);
  }

  console.error(
    `migrate-deploy-safe: P3005 — existing db-push database detected. ` +
      `Baselining "${BASELINE}" as already-applied, then re-deploying.`
  );
  try {
    prisma(['migrate', 'resolve', '--applied', BASELINE]);
    const out = deploy();
    process.stdout.write(out);
    console.log('migrate-deploy-safe: baselined and migrations applied.');
  } catch (retryErr) {
    process.stdout.write(`${retryErr.stdout || ''}${retryErr.stderr || ''}`);
    console.error('migrate-deploy-safe: baseline + re-deploy failed.');
    process.exit(1);
  }
}
