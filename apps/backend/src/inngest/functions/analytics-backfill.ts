import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AnalyticsActivity } from '@gitroom/nestjs-libraries/inngest/activities/analytics.activity';

export const createAnalyticsBackfill = (analyticsActivity: AnalyticsActivity) =>
  inngest.createFunction(
    { id: 'analytics-backfill' },
    { event: 'analytics/backfill' },
    async ({ step, event }) => {
      await step.run('backfill', () => {
        const { integrationId, organizationId } = event.data;
        return analyticsActivity.backfillIntegration({
          integrationId,
          organizationId,
        });
      });
    }
  );
