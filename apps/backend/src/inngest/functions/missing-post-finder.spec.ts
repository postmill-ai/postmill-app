import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createMissingPostFinder } from './missing-post-finder';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createMissingPostFinder', () => {
  let postActivity: {
    searchForMissingThreeHoursPosts: ReturnType<typeof vi.fn>;
  };
  let runRepo: any;
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    postActivity = {
      searchForMissingThreeHoursPosts: vi.fn().mockResolvedValue(undefined),
    };
    runRepo = {
      recordStart: vi.fn().mockResolvedValue('2020-01-01T00:00:00.000Z'),
      recordComplete: vi.fn().mockResolvedValue(undefined),
      recordFailed: vi.fn().mockResolvedValue(undefined),
      getAllLatest: vi.fn().mockResolvedValue([]),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createMissingPostFinder(postActivity as any, runRepo as any);
  });

  it('registers an hourly UTC cron handler with concurrency 1', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'missing-post-finder', concurrency: 1 }),
      { cron: 'TZ=UTC 0 * * * *' },
      expect.any(Function)
    );
  });

  it('calls step.run to search for missing posts', async () => {
    const step = createMockStep();

    await getHandler()({ step });

    expect(step.run).toHaveBeenCalledWith('find-missing', expect.any(Function));
    expect(postActivity.searchForMissingThreeHoursPosts).toHaveBeenCalled();
    expect(runRepo.recordStart).toHaveBeenCalledWith('missing-post-finder');
    expect(runRepo.recordComplete).toHaveBeenCalled();
  });
});
