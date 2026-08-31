import { createHash } from 'node:crypto';
import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { commsMatrixSyncOneEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { CommsInboundService } from '@postmill-ai/nestjs-libraries/comms/comms-inbound.service';

// Matrix has no webhooks — a minutely cron fans out one sync per enabled
// matrix comms config (comments-collection pattern: no event ids on the
// fan-out, the cron's concurrency:1 is the throttle; a slow homeserver never
// blocks the sweep).
export const createCommsMatrixSync = (commsInboundService: CommsInboundService) =>
  inngest.createFunction(
    {
      id: 'comms-matrix-sync',
      concurrency: 1,
      triggers: [{ cron: 'TZ=UTC * * * * *' }],
    },
    async ({ step }) => {
      const configs = await step.run('list-matrix-configs', async () => {
        const rows = await commsInboundService.listPollConfigs('matrix');
        return rows.map((row) => ({
          configId: row.id,
          organizationId: row.organizationId,
        }));
      });

      if (configs.length > 0) {
        await step.sendEvent(
          'fan-out-matrix-sync',
          configs.map((config) => ({
            name: 'comms/matrix.sync-one' as const,
            data: config,
          }))
        );
      }
    }
  );

// One /sync round for one config. Per-config concurrency 1 prevents two
// overlapping polls from double-reading the same cursor; the emitted inbound
// events carry Matrix event_id-based dedupe ids, so even a cursor replay
// cannot double-process a message.
export const createCommsMatrixSyncOne = (commsInboundService: CommsInboundService) =>
  inngest.createFunction(
    {
      id: 'comms-matrix-sync-one',
      concurrency: {
        limit: 1,
        key: 'event.data.configId',
      },
      triggers: [commsMatrixSyncOneEvent],
    },
    async ({ step, event }) => {
      const { configId, organizationId } = event.data;

      const result = await step.run('poll-matrix', () =>
        commsInboundService.pollConfig(organizationId, configId, 'matrix')
      );

      if (result.messages.length > 0) {
        await step.sendEvent(
          'emit-inbound',
          result.messages.map((message) => ({
            name: 'comms/inbound.message' as const,
            id: `comms-inbound:${configId}:${
              message.messageId ??
              createHash('sha256')
                .update(`${message.externalUserId}:${message.text}`)
                .digest('hex')
            }`,
            data: {
              configId,
              organizationId,
              identifier: 'matrix',
              externalUserId: message.externalUserId!,
              externalChannelId: message.externalChannelId,
              text: message.text!,
              messageId: message.messageId,
            },
          }))
        );
      }
    }
  );
