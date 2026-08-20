import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { analyticsBackfillEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { AnalyticsActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/analytics.activity';

export const createAnalyticsBackfill = (analyticsActivity: AnalyticsActivity) =>
  inngest.createFunction(
    { id: 'analytics-backfill', triggers: [analyticsBackfillEvent] },
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
