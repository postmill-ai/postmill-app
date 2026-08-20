import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaPollJobEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { MediaJobsActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/media-jobs.activity';

export const createMediaJobsPollJob = (
  mediaJobsActivity: MediaJobsActivity,
) =>
  inngest.createFunction(
    {
      id: 'media-jobs-poll-job',
      concurrency: 15,
      triggers: [mediaPollJobEvent],
    },
    async ({ step, event }) => {
      await step.run('poll-single-media-job', () =>
        mediaJobsActivity.processPollJob(event.data.jobId)
      );
    }
  );
