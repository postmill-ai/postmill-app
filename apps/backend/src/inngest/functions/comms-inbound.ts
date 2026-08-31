import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { commsInboundMessageEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { CommsInboundService } from '@postmill-ai/nestjs-libraries/comms/comms-inbound.service';

// One inbound chat message → connect-code claim or an agent turn + reply.
// The webhook controller already ack'd the provider; only this step waits on
// the agent. Serialized per config so one workspace's burst stays ordered and
// can't starve others. Duplicate deliveries (Slack retries, Matrix cursor
// resets) are dropped by the event-id dedupe stamped at send time.
export const createCommsInbound = (commsInboundService: CommsInboundService) =>
  inngest.createFunction(
    {
      id: 'comms-inbound',
      concurrency: {
        limit: 1,
        key: 'event.data.configId',
      },
      triggers: [commsInboundMessageEvent],
    },
    async ({ step, event }) => {
      return step.run('process-inbound', () =>
        commsInboundService.process(event.data)
      );
    }
  );
