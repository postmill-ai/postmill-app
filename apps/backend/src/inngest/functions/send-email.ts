import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { EmailActivity } from '@gitroom/nestjs-libraries/inngest/activities/email.activity';

export const createSendEmail = (emailActivity: EmailActivity) =>
  inngest.createFunction(
    {
      id: 'send-email',
      rateLimit: {
        // No `key`: Inngest compiles `key` as a CEL expression, so a literal like
        // 'email-send' fails to register. Omitting it applies one global bucket,
        // which is the intended 1-email/sec limit across all sends.
        limit: 1,
        period: '1s',
      },
    },
    { event: 'email/send' },
    async ({ step, event }) => {
      const { to, subject, html, replyTo } = event.data;
      await step.run('send', () =>
        emailActivity.sendEmail(to, subject, html, replyTo)
      );
    }
  );
