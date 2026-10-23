import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaVideoThumbnailGenerateEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { createVideoThumbnail } from './video-thumbnail';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createVideoThumbnail', () => {
  let mediaJobsActivity: {
    generateVideoThumbnail: ReturnType<typeof vi.fn>;
  };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    mediaJobsActivity = {
      generateVideoThumbnail: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createVideoThumbnail(mediaJobsActivity as any);
  });

  it('registers a media/video-thumbnail.generate handler with concurrency 5', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'media-video-thumbnail',
        concurrency: 5,
        triggers: [mediaVideoThumbnailGenerateEvent],
      }),
      expect.any(Function)
    );
  });

  it('calls generateVideoThumbnail with the event org + file ids', async () => {
    const step = createMockStep();

    await getHandler()({
      step,
      event: { data: { organizationId: 'org-1', fileId: 'file-1' } },
    });

    expect(step.run).toHaveBeenCalledWith(
      'generate-video-thumbnail',
      expect.any(Function)
    );
    expect(mediaJobsActivity.generateVideoThumbnail).toHaveBeenCalledWith(
      'org-1',
      'file-1'
    );
  });
});
