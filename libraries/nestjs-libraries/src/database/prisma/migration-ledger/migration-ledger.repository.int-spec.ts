import { inject } from 'vitest';
import { getTestPrisma } from '@gitroom/nestjs-libraries/testing/test-db';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { MigrationLedgerRepository } from './migration-ledger.repository';

// Template: copy this for other repository integration tests.
// Read inject('dbUrl') (provided by vitest-integration.global.ts), build a PrismaClient via
// getTestPrisma, wrap it in PrismaRepository (cast — at runtime the client exposes every
// model accessor the repo touches), and instantiate the repository under test.
describe('MigrationLedgerRepository (integration)', () => {
  it('round-trips markApplied -> wasApplied against a real DB', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repo = new MigrationLedgerRepository(
      new PrismaRepository<'migrationLedger'>(prisma as unknown as PrismaService)
    );
    try {
      expect(await repo.wasApplied('demo:key')).toBe(false);

      await repo.markApplied('demo:key', 42, 'first run');
      expect(await repo.wasApplied('demo:key')).toBe(true);

      // upsert path: marking again must not throw and stays applied.
      await repo.markApplied('demo:key', 7, 'second run');
      expect(await repo.wasApplied('demo:key')).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });
});
