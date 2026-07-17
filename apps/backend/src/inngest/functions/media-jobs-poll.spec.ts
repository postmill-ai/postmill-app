import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createMediaJobsPoll } from './media-jobs-poll';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createMediaJobsPoll', () => {
  let mediaJobsActivity: {
    processPendingMediaJobs: ReturnType<typeof vi.fn>;
  };
  let runRepo: any;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    mediaJobsActivity = {
      processPendingMediaJobs: vi.fn().mockResolvedValue(undefined),
    };
    runRepo = {
      recordStart: vi.fn().mockResolvedValue('2020-01-01T00:00:00.000Z'),
      recordComplete: vi.fn().mockResolvedValue(undefined),
      recordFailed: vi.fn().mockResolvedValue(undefined),
      getAllLatest: vi.fn().mockResolvedValue([]),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createMediaJobsPoll(mediaJobsActivity as any, runRepo as any);
  });

  it('registers a minutely UTC cron handler with concurrency 1', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'media-jobs-poll', concurrency: 1 }),
      { cron: 'TZ=UTC * * * * *' },
      expect.any(Function)
    );
  });

  it('calls step.run to process pending media jobs', async () => {
    const step = createMockStep();

    await getHandler()({ step });

    expect(step.run).toHaveBeenCalledWith('poll-media-jobs', expect.any(Function));
    expect(mediaJobsActivity.processPendingMediaJobs).toHaveBeenCalled();
    expect(runRepo.recordStart).toHaveBeenCalledWith('media-jobs-poll');
    expect(runRepo.recordComplete).toHaveBeenCalled();
  });
});
