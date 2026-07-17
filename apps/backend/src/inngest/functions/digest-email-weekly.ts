import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { DigestActivity } from '@gitroom/nestjs-libraries/inngest/activities/digest.activity';
import { InngestEvents } from '@gitroom/nestjs-libraries/inngest/inngest.types';
import dayjs from 'dayjs';

export const createDigestEmailWeekly = (digestActivity: DigestActivity) =>
  inngest.createFunction(
    { id: 'digest-email-weekly' },
    { cron: 'TZ=America/New_York 0 9 * * 1' },
    async ({ step }) => {
      const targets = await step.run('get-weekly-digest-targets', () =>
        digestActivity.getPendingDigestTargets('weekly')
      );

      if (targets.length === 0) {
        return { fannedOut: 0 };
      }

      const today = dayjs().format('YYYY-MM-DD');
      await step.sendEvent(
        'fan-out-weekly-digests',
        targets.map((target) => ({
          name: 'digest/send-one' as const,
          data: {
            userId: target.userId,
            email: target.email,
            organizationId: target.organizationId,
            frequency: 'weekly' as const,
          } as InngestEvents['digest/send-one']['data'],
          id: `digest:weekly:${target.userId}:${target.organizationId}:${today}`,
        }))
      );

      return { fannedOut: targets.length };
    }
  );
