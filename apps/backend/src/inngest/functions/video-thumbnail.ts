import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaVideoThumbnailGenerateEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { MediaJobsActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/media-jobs.activity';

export const createVideoThumbnail = (
  mediaJobsActivity: MediaJobsActivity,
) =>
  inngest.createFunction(
    {
      id: 'media-video-thumbnail',
      concurrency: 5,
      triggers: [mediaVideoThumbnailGenerateEvent],
    },
    async ({ step, event }) => {
      await step.run('generate-video-thumbnail', () =>
        mediaJobsActivity.generateVideoThumbnail(
          event.data.organizationId,
          event.data.fileId
        )
      );
    }
  );
