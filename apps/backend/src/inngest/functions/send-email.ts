import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { emailSendEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { EmailActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/email.activity';

export const createSendEmail = (emailActivity: EmailActivity) =>
  inngest.createFunction(
    {
      id: 'send-email',
      // No rateLimit: the inherited 1-email/sec global bucket made the
      // self-hosted executor silently drop every second same-second email
      // (live-proven 2026-09-11: welcome/admin pair — one run initialized,
      // the other received but never executed, never retried). Flood control
      // belongs at the source (24h notification dedup), not here.
      triggers: [emailSendEvent],
    },
    async ({ step, event }) => {
      const { to, subject, html, replyTo } = event.data;
      await step.run('send', () =>
        emailActivity.sendEmail(to, subject, html, replyTo)
      );
    }
  );
