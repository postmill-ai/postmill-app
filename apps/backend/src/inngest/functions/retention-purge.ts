import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { RetentionActivity } from '@gitroom/nestjs-libraries/inngest/activities/retention.activity';
import { InngestRunService } from '@gitroom/nestjs-libraries/inngest/inngest-run.service';
import { trackRun } from './track-run';

/**
 * retention-purge (ENHANCEMENTS_2 I3 + I4c) — daily bounded retention sweep over the
 * previously-unbounded tables (Errors, Notifications, MultipartUpload stragglers,
 * mastra_* traces, hard-purged soft-deleted Post/File) plus the IP/agent retention
 * bound. Mirrors the campaign-tag-purge cron pattern.
 */
export const createRetentionPurge = (
  retentionActivity: RetentionActivity,
  runRepo: InngestRunService
) =>
  inngest.createFunction(
    { id: 'retention-purge' },
    { cron: 'TZ=UTC 30 3 * * *' },
    async ({ step }) =>
      trackRun(step, runRepo, 'retention-purge', async () => {
        const result = await step.run('run-retention', () =>
          retentionActivity.runRetention()
        );
        return result;
      })
  );
