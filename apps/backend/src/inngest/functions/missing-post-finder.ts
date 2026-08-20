import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { PostActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/post.activity';
import { InngestRunService } from '@postmill-ai/nestjs-libraries/inngest/inngest-run.service';
import { trackRun } from './track-run';

export const createMissingPostFinder = (
  postActivity: PostActivity,
  runRepo: InngestRunService
) =>
  inngest.createFunction(
    {
      id: 'missing-post-finder',
      concurrency: 1,
      triggers: [{ cron: 'TZ=UTC 0 * * * *' }],
    },
    async ({ step }) =>
      trackRun(step, runRepo, 'missing-post-finder', async () => {
        await step.run('find-missing', () =>
          postActivity.searchForMissingThreeHoursPosts()
        );
      })
  );
