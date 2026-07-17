import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { DigestActivity } from '@gitroom/nestjs-libraries/inngest/activities/digest.activity';
import { InngestEvents } from '@gitroom/nestjs-libraries/inngest/inngest.types';
import dayjs from 'dayjs';

export const createDigestEmailDaily = (digestActivity: DigestActivity) =>
  inngest.createFunction(
    { id: 'digest-email-daily' },
    { cron: 'TZ=America/New_York 0 9 * * *' },
    async ({ step }) => {
      const targets = await step.run('get-daily-digest-targets', () =>
        digestActivity.getPendingDigestTargets('daily')
      );

      if (targets.length === 0) {
        return { fannedOut: 0 };
      }

      const today = dayjs().format('YYYY-MM-DD');
      await step.sendEvent(
        'fan-out-daily-digests',
        targets.map((target) => ({
          name: 'digest/send-one' as const,
          data: {
            userId: target.userId,
            email: target.email,
            organizationId: target.organizationId,
            frequency: 'daily' as const,
          } as InngestEvents['digest/send-one']['data'],
          id: `digest:daily:${target.userId}:${target.organizationId}:${today}`,
        }))
      );

      return { fannedOut: targets.length };
    }
  );

export const createDigestSendOne = (digestActivity: DigestActivity) =>
  inngest.createFunction(
    { id: 'digest-send-one' },
    { event: 'digest/send-one' },
    async ({ step, event }) => {
      const result = await step.run('send-one-digest', () =>
        digestActivity.sendOneDigest(event.data)
      );
      return result;
    }
  );
