import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaDesignExportEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { createDesignExport } from './design-export';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createDesignExport', () => {
  let designExportActivity: { processExportJob: ReturnType<typeof vi.fn> };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    designExportActivity = { processExportJob: vi.fn().mockResolvedValue(undefined) };
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createDesignExport(designExportActivity as any);
  });

  it('registers an event handler with the render concurrency cap', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'media-design-export',
        concurrency: { limit: 3 },
        triggers: [mediaDesignExportEvent],
      }),
      expect.any(Function),
    );
  });

  it('processes the export job from the event payload as a step', async () => {
    const step = createMockStep();

    await getHandler()({ step, event: { data: { jobId: 'job-9' } } });

    expect(step.run).toHaveBeenCalledWith('export', expect.any(Function));
    expect(designExportActivity.processExportJob).toHaveBeenCalledWith('job-9');
  });
});
