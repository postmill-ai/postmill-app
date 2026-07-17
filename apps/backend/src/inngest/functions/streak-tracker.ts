import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { EmailActivity } from '@gitroom/nestjs-libraries/inngest/activities/email.activity';
import { PostActivity } from '@gitroom/nestjs-libraries/inngest/activities/post.activity';

export const createStreakTracker = (
  emailActivity: EmailActivity,
  postActivity: PostActivity
) =>
  inngest.createFunction(
    {
      id: 'streak-tracker',
      cancelOn: [
        {
          event: 'streak/cancel',
          if: 'async.data.organizationId == event.data.organizationId',
        },
      ],
    },
    { event: 'streak/start' },
    async ({ step, event }) => {
      const { organizationId } = event.data;
      await step.run('set-streak-start', () =>
        emailActivity.setStreak(organizationId, 'start')
      );
      await step.sleep('wait-22h', '22h');
      // Route through the v2 notification pipeline (category 'streak') so the
      // reminder respects per-user preferences and lands in the in-app bell.
      await step.run('send-reminder', () =>
        postActivity.notifyStreakReminder(organizationId)
      );
      await step.sleep('wait-2h', '2h');
      await step.run('set-streak-end', () =>
        emailActivity.setStreak(organizationId, 'end')
      );
    }
  );
