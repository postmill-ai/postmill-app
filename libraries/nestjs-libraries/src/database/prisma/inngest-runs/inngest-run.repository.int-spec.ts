import { inject } from 'vitest';
import { getTestPrisma } from '@gitroom/nestjs-libraries/testing/test-db';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { InngestRunRepository } from './inngest-run.repository';

describe('InngestRunRepository (integration)', () => {
  it('records start -> complete, computes duration, upserts, and lists latest', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const repo = new InngestRunRepository(
      new PrismaRepository<'inngestFunctionRun'>(prisma as unknown as PrismaService)
    );
    try {
      const startedAt = await repo.recordStart('demo-fn');
      let [row] = await repo.getAllLatest();
      expect(row.functionId).toBe('demo-fn');
      expect(row.status).toBe('running');
      expect(row.completedAt).toBeNull();

      await repo.recordComplete('demo-fn', startedAt);
      [row] = (await repo.getAllLatest()).filter((r) => r.functionId === 'demo-fn');
      expect(row.status).toBe('completed');
      expect(row.completedAt).not.toBeNull();
      expect(row.durationMs).toBeGreaterThanOrEqual(0);

      // upsert path: a second run reuses the single row and resets it to running.
      const restart = await repo.recordStart('demo-fn');
      [row] = (await repo.getAllLatest()).filter((r) => r.functionId === 'demo-fn');
      expect(row.status).toBe('running');
      expect(row.completedAt).toBeNull();

      await repo.recordFailed('demo-fn', restart, 'boom');
      [row] = (await repo.getAllLatest()).filter((r) => r.functionId === 'demo-fn');
      expect(row.status).toBe('failed');
    } finally {
      await prisma.$disconnect();
    }
  });
});
