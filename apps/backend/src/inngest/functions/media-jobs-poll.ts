import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { MediaJobsActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/media-jobs.activity';
import { InngestRunService } from '@postmill-ai/nestjs-libraries/inngest/inngest-run.service';
import { trackRun } from './track-run';

export const createMediaJobsPoll = (
  mediaJobsActivity: MediaJobsActivity,
  runRepo: InngestRunService
) =>
  inngest.createFunction(
    {
      id: 'media-jobs-poll',
      concurrency: 1,
      triggers: [{ cron: 'TZ=UTC * * * * *' }],
    },
    async ({ step }) =>
      trackRun(step, runRepo, 'media-jobs-poll', async () => {
        await step.run('poll-media-jobs', () =>
          mediaJobsActivity.processPendingMediaJobs()
        );
      })
  );
