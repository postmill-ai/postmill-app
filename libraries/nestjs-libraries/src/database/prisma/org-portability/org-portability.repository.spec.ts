import { describe, expect, it, vi } from 'vitest';
import { OrgPortabilityRepository } from './org-portability.repository';

describe('OrgPortabilityRepository export claims', () => {
  it('atomically claims pending jobs and processing jobs stale for one hour', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new OrgPortabilityRepository({
      orgPortabilityJob: { updateMany },
    } as any);

    await repository.claimExportJob('job-1');

    const input = updateMany.mock.calls[0][0];
    expect(input).toMatchObject({
      where: {
        id: 'job-1',
        kind: 'export',
        OR: [{ status: 'pending' }, { status: 'processing' }],
      },
      data: { status: 'processing', error: null },
    });
    const staleBefore = input.where.OR[1].updatedAt.lt as Date;
    expect(staleBefore.getTime()).toBeLessThanOrEqual(Date.now() - 3_600_000);
    expect(staleBefore.getTime()).toBeGreaterThan(Date.now() - 3_601_000);
  });
});
