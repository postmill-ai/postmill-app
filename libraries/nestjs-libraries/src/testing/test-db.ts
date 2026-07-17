import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import path from 'node:path';

// Admin/template DB connection — used only to CREATE/DROP the per-run test database.
// Override with TEST_DATABASE_ADMIN_URL (see .env.example / local-development.md).
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ||
  'postgresql://postmill-local:postmill-local-pwd@localhost:5432/postgres';

const SCHEMA = path.resolve(__dirname, '../database/prisma/schema.prisma');
// Package root (libraries/nestjs-libraries) — a safe cwd for `pnpm exec prisma`.
const PKG_ROOT = path.resolve(__dirname, '../..');

function adminUrlToDbUrl(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function withAdmin<T>(fn: (admin: PrismaClient) => Promise<T>): Promise<T> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Create an isolated Postgres database on the dev container for one Vitest run,
 * push the current Prisma schema into it, and return its URL + a drop() teardown.
 * The first call is slow (a full `db push` of the schema) and runs once per run.
 */
export async function createTestDatabase(): Promise<{
  url: string;
  drop: () => Promise<void>;
}> {
  const dbName = `postmill_test_${process.pid}`;

  await withAdmin(async (admin) => {
    // DROP IF EXISTS guards against a stale DB left by a crashed prior run with the
    // same pid. WITH (FORCE) (PG 13+) terminates any lingering connections.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  });

  const url = adminUrlToDbUrl(ADMIN_URL, dbName);

  // Use `pnpm exec prisma` (workspace-pinned 6.5.0) — not `pnpm dlx` (network re-download).
  execSync(`pnpm exec prisma db push --skip-generate --schema "${SCHEMA}"`, {
    cwd: PKG_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const drop = async () => {
    await withAdmin(async (admin) => {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`
      );
    });
  };

  return { url, drop };
}

/** Build a PrismaClient pointed at a specific (test) database URL. */
export function getTestPrisma(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}
