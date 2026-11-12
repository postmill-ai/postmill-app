import { describe, expect, it, vi } from 'vitest';
import { OrgPortabilityRepository } from './org-portability.repository';
import { OrgImportRepository } from './org-import.repository';

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

describe('OrgPortabilityRepository expiry', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const matches = (job: any, where: any): boolean => {
    if (where.id && job.id !== where.id) return false;
    if (!(job.expiresAt < where.expiresAt.lt)) return false;
    return where.OR.some((branch: any) =>
      branch.status.in.includes(job.status)
      && (!branch.updatedAt || job.updatedAt < branch.updatedAt.lt));
  };
  const makeRepository = (jobs: any[]) => {
    const findMany = vi.fn(async ({ where }: any) => jobs.filter((job) => matches(job, where)));
    const updateMany = vi.fn(async ({ where, data }: any) => {
      const hits = jobs.filter((job) => matches(job, where));
      hits.forEach((job) => Object.assign(job, data));
      return { count: hits.length };
    });
    return {
      repository: new OrgPortabilityRepository({ orgPortabilityJob: { findMany, updateMany } } as any),
      updateMany,
    };
  };

  it('never expires an in-flight job that is still active past its deadline', async () => {
    const jobs = ['uploading', 'validating', 'pending', 'processing'].map((status) => ({
      id: status,
      status,
      expiresAt: hoursAgo(1),
      updatedAt: hoursAgo(2),
      archiveKeyCiphertext: 'v2:key',
    }));
    const { repository } = makeRepository(jobs);

    await expect(repository.expireJobs(now)).resolves.toEqual([]);
    expect(jobs.every((job) => job.status !== 'expired' && job.archiveKeyCiphertext)).toBe(true);
  });

  it('expires idle jobs past their deadline and orphaned active jobs idle for a full TTL', async () => {
    const jobs = [
      { id: 'completed', status: 'completed', expiresAt: hoursAgo(1), updatedAt: hoursAgo(1) },
      { id: 'ready', status: 'ready', expiresAt: hoursAgo(1), updatedAt: hoursAgo(2) },
      { id: 'failed', status: 'failed', expiresAt: hoursAgo(1), updatedAt: hoursAgo(20) },
      { id: 'stuck', status: 'processing', expiresAt: hoursAgo(30), updatedAt: hoursAgo(25), archiveKeyCiphertext: 'v2:key' },
      { id: 'fresh', status: 'completed', expiresAt: new Date(now.getTime() + 60_000), updatedAt: hoursAgo(30) },
      { id: 'done', status: 'expired', expiresAt: hoursAgo(50), updatedAt: hoursAgo(50) },
    ];
    const { repository } = makeRepository(jobs);

    const expired = await repository.expireJobs(now);

    expect(expired.map((job) => job.id)).toEqual(['completed', 'ready', 'failed', 'stuck']);
    expect(jobs.find((job) => job.id === 'stuck')).toMatchObject({ status: 'expired', archiveKeyCiphertext: null });
    expect(jobs.find((job) => job.id === 'fresh')!.status).toBe('completed');
  });

  it('skips a job that changed status between the read and the guarded write', async () => {
    const job = { id: 'ready', status: 'ready', expiresAt: hoursAgo(1), updatedAt: hoursAgo(1) };
    const { repository, updateMany } = makeRepository([job]);
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(repository.expireJobs(now)).resolves.toEqual([]);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 'ready', expiresAt: { lt: now } });
  });

  it('restarts the 24-hour download window when an export completes', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new OrgPortabilityRepository({ orgPortabilityJob: { updateMany } } as any);
    const before = Date.now();

    await repository.completeExportJob('job-1', { spoolPath: '/spool/job-1.zip', archiveSha256: 'sha', progress: {} });

    const input = (updateMany.mock.calls[0] as any[])[0];
    expect(input.where).toEqual({ id: 'job-1', kind: 'export', status: 'processing' });
    const expiresAt = input.data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
  });

  it('never leaves a row both expired and completed, whichever transition lands first', async () => {
    const stale = () => ({
      id: 'job-1',
      kind: 'export',
      status: 'processing',
      spoolPath: null as string | null,
      expiresAt: hoursAgo(30),
      updatedAt: hoursAgo(25),
    });
    const conditional = (jobs: any[]) => vi.fn(async ({ where, data }: any) => {
      const hits = jobs.filter((job) => (
        where.expiresAt ? matches(job, where) : job.id === where.id && job.status === where.status
      ) && (!('spoolPath' in where) || job.spoolPath === where.spoolPath));
      hits.forEach((job) => Object.assign(job, data, data.expiresAt ? { updatedAt: now } : {}));
      return { count: hits.length };
    });
    const completion = { spoolPath: '/spool/job-1.zip', archiveSha256: 'sha', progress: {} };

    // Expiry wins: the worker's completion loses its claim and the row stays expired.
    const expiredFirst = [stale()];
    const a = new OrgPortabilityRepository({
      orgPortabilityJob: {
        findMany: vi.fn(async ({ where }: any) => expiredFirst.filter((job) => matches(job, where))),
        updateMany: conditional(expiredFirst),
      },
    } as any);
    expect(await a.expireJobs(now)).toHaveLength(1);
    await expect(a.completeExportJob('job-1', completion)).resolves.toEqual({ count: 0 });
    expect(expiredFirst[0]).toMatchObject({ status: 'expired', spoolPath: null });

    // Completion lands after the sweep's read: the guarded expire update no longer matches,
    // so the sweep returns nothing and the fresh archive is never removed.
    const completedFirst = [stale()];
    const b = new OrgPortabilityRepository({
      orgPortabilityJob: {
        findMany: vi.fn(async ({ where }: any) => completedFirst.filter((job) => matches(job, where)).map((job) => ({ ...job }))),
        updateMany: conditional(completedFirst),
      },
    } as any);
    const findMany = (b as any)._prisma.orgPortabilityJob.findMany;
    findMany.mockImplementationOnce(async ({ where }: any) => {
      const read = completedFirst.filter((job) => matches(job, where)).map((job) => ({ ...job }));
      await b.completeExportJob('job-1', completion);
      return read;
    });
    await expect(b.expireJobs(now)).resolves.toEqual([]);
    expect(completedFirst[0]).toMatchObject({ status: 'completed', spoolPath: '/spool/job-1.zip' });
  });
});

describe('OrgImportRepository completion', () => {
  it('completes an import only while it is still claimed as processing', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const repository = new OrgImportRepository({} as any);

    await expect(repository.completeJobInTransaction({ orgPortabilityJob: { updateMany } } as any, 'job-1', {}))
      .resolves.toEqual({ count: 0 });
    expect((updateMany.mock.calls[0] as any[])[0].where).toEqual({ id: 'job-1', kind: 'import', status: 'processing' });
  });
});
