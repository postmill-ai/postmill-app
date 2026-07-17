import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createMediaJobsPollJob } from './media-jobs-poll-job';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createMediaJobsPollJob', () => {
  let mediaJobsActivity: {
    processPollJob: ReturnType<typeof vi.fn>;
  };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    mediaJobsActivity = {
      processPollJob: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createMediaJobsPollJob(mediaJobsActivity as any);
  });

  it('registers a media/poll-job handler with concurrency 15', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'media-jobs-poll-job', concurrency: 15 }),
      { event: 'media/poll-job' },
      expect.any(Function)
    );
  });

  it('calls processPollJob with the event jobId', async () => {
    const step = createMockStep();

    await getHandler()({ step, event: { data: { jobId: 'job-123' } } });

    expect(step.run).toHaveBeenCalledWith('poll-single-media-job', expect.any(Function));
    expect(mediaJobsActivity.processPollJob).toHaveBeenCalledWith('job-123');
  });
});
