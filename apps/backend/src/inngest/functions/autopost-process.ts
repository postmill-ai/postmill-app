import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AutopostActivity } from '@gitroom/nestjs-libraries/inngest/activities/autopost.activity';

export const createAutopostProcess = (autopostActivity: AutopostActivity) =>
  inngest.createFunction(
    {
      id: 'autopost-process',
      cancelOn: [
        {
          event: 'autopost/cancel',
          if: 'async.data.id == event.data.id',
        },
      ],
    },
    { event: 'autopost/process' },
    async ({ step, event }) => {
      await step.run('process', () =>
        autopostActivity.autoPost(event.data.id, event.data.organizationId)
      );
      await step.sleep('wait-1h', '1h');
      // No `id`: a constant idempotency id would dedupe every hourly hop against
      // the activation event, killing recurrence after the first run (0.9). The
      // memoized `step.sendEvent` already prevents duplicate sends within a run.
      await step.sendEvent('autopost/process', {
        name: 'autopost/process',
        data: { id: event.data.id, organizationId: event.data.organizationId },
      });
    }
  );
