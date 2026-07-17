import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { MediaJobsActivity } from '@gitroom/nestjs-libraries/inngest/activities/media-jobs.activity';

export const createMediaJobsPollJob = (
  mediaJobsActivity: MediaJobsActivity,
) =>
  inngest.createFunction(
    { id: 'media-jobs-poll-job', concurrency: 15 },
    { event: 'media/poll-job' },
    async ({ step, event }) => {
      await step.run('poll-single-media-job', () =>
        mediaJobsActivity.processPollJob(event.data.jobId)
      );
    }
  );
