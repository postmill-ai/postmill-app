import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createMediaRender } from './media-render';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createMediaRender', () => {
  let mediaJobsActivity: { processRenderJob: ReturnType<typeof vi.fn> };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaJobsActivity = { processRenderJob: vi.fn().mockResolvedValue(undefined) };
    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createMediaRender(mediaJobsActivity as any);
  });

  it('registers an event handler with a 3-concurrent limit', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'media-render',
        concurrency: { limit: 3 },
      }),
      { event: 'media/render' },
      expect.any(Function),
    );
  });

  it('processes the render job from the event payload as a step', async () => {
    const step = createMockStep();

    await getHandler()({ step, event: { data: { jobId: 'job-7', op: 'design' } } });

    expect(step.run).toHaveBeenCalledWith('render', expect.any(Function));
    expect(mediaJobsActivity.processRenderJob).toHaveBeenCalledWith('job-7');
  });
});
