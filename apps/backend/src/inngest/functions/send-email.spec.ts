import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createSendEmail } from './send-email';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createSendEmail', () => {
  let emailActivity: { sendEmail: ReturnType<typeof vi.fn> };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    emailActivity = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createSendEmail(emailActivity as any);
  });

  it('registers an email/send event handler', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'send-email' }),
      { event: 'email/send' },
      expect.any(Function)
    );
  });

  it('calls step.run to dispatch the email via EmailActivity', async () => {
    const step = createMockStep();
    const event = {
      data: {
        to: 'a@b.com',
        subject: 'Subject',
        html: '<p>Hello</p>',
        replyTo: 'reply@b.com',
      },
    };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith('send', expect.any(Function));
    expect(emailActivity.sendEmail).toHaveBeenCalledWith(
      'a@b.com',
      'Subject',
      '<p>Hello</p>',
      'reply@b.com'
    );
  });
});
