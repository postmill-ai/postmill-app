import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { orgPortabilityImportEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { createOrgPortabilityImport } from './org-portability-import';
import { captureFunctionHandler, createMockStep } from '../test/step.mock';

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { createFunction: vi.fn() },
}));

describe('createOrgPortabilityImport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs one import per organization in a durable step', async () => {
    const service = { processImport: vi.fn(async () => undefined) };
    const getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createOrgPortabilityImport(service as any);
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'org-portability-import',
        concurrency: { limit: 1, key: 'event.data.organizationId' },
        triggers: [orgPortabilityImportEvent],
      }),
      expect.any(Function),
    );
    const step = createMockStep();
    await getHandler()({ step, event: { data: { jobId: 'job-1', organizationId: 'org-1' } } });
    expect(step.run).toHaveBeenCalledWith('import-organization', expect.any(Function));
    expect(service.processImport).toHaveBeenCalledWith('job-1');
  });
});
