import { describe, it, expect, vi } from 'vitest';
import { DesignExportActivity } from './design-export.activity';

const makeActivity = (opts: { job?: any; exportResult?: 'completed' | 'failed' | 'stuck' }) => {
  const job = opts.job ?? null;
  let reads = 0;
  const aiSettings = {
    getMediaJobByIdUnscoped: vi.fn(async () => {
      // First read is the pending guard; the after-read reflects what
      // processExport did to the row.
      reads++;
      if (!job) return null;
      if (reads === 1) return job;
      if (opts.exportResult === 'completed') return { ...job, status: 'completed' };
      if (opts.exportResult === 'failed') return { ...job, status: 'failed' };
      return job;
    }),
  };
  const organizationService = { getOrgById: vi.fn(async () => ({ id: 'org-1' })) };
  const designExportService = { processExport: vi.fn(async () => undefined) };
  const activity = new DesignExportActivity(
    aiSettings as any,
    organizationService as any,
    designExportService as any
  );
  return { activity, aiSettings, designExportService };
};

describe('DesignExportActivity.processExportJob', () => {
  const pending = { id: 'job-1', organizationId: 'org-1', provider: 'design-export', status: 'pending' };

  it('no-ops for a missing or non-pending job (retry/re-dispatch idempotency)', async () => {
    const { activity, designExportService } = makeActivity({ job: null });
    await activity.processExportJob('job-1');
    expect(designExportService.processExport).not.toHaveBeenCalled();

    const done = makeActivity({ job: { ...pending, status: 'completed' } });
    await done.activity.processExportJob('job-1');
    expect(done.designExportService.processExport).not.toHaveBeenCalled();
  });

  it('runs the export and resolves when it completes', async () => {
    const { activity, designExportService } = makeActivity({ job: pending, exportResult: 'completed' });
    await activity.processExportJob('job-1');
    expect(designExportService.processExport).toHaveBeenCalledWith('job-1');
  });

  it('returns cleanly when the export recorded its own failure (no retry burn)', async () => {
    const { activity } = makeActivity({ job: pending, exportResult: 'failed' });
    await expect(activity.processExportJob('job-1')).resolves.toBeUndefined();
  });

  it('throws when the job neither completed nor failed (drives an Inngest retry)', async () => {
    const { activity } = makeActivity({ job: pending, exportResult: 'stuck' });
    await expect(activity.processExportJob('job-1')).rejects.toThrow(/did not complete/);
  });

  it('no-ops when the org is gone', async () => {
    const aiSettings = { getMediaJobByIdUnscoped: vi.fn(async () => pending) };
    const organizationService = { getOrgById: vi.fn(async () => null) };
    const svc = { processExport: vi.fn() };
    const a = new DesignExportActivity(aiSettings as any, organizationService as any, svc as any);
    await a.processExportJob('job-1');
    expect(svc.processExport).not.toHaveBeenCalled();
  });
});
