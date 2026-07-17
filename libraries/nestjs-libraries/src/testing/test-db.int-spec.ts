import { inject } from 'vitest';
import { getTestPrisma } from './test-db';

// Smoke test for the integration harness: proves the per-run DB is created, the schema
// is pushed (so `user` exists), and the connection works. Template: copy for other
// repository integration tests — read inject('dbUrl') and build a client off it.
describe('test-db harness', () => {
  it('connects to a freshly-created, schema-pushed test database', async () => {
    const url = inject('dbUrl');
    const prisma = getTestPrisma(url);
    try {
      const count = await prisma.user.count();
      expect(count).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
