import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createStreakTracker } from './streak-tracker';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createStreakTracker', () => {
  let emailActivity: {
    setStreak: ReturnType<typeof vi.fn>;
  };
  let postActivity: {
    notifyStreakReminder: ReturnType<typeof vi.fn>;
  };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    emailActivity = {
      setStreak: vi.fn().mockResolvedValue(undefined),
    };
    postActivity = {
      notifyStreakReminder: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createStreakTracker(emailActivity as any, postActivity as any);
  });

  it('registers a streak/start event handler with cancelOn', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'streak-tracker',
        cancelOn: [
          {
            event: 'streak/cancel',
            if: 'async.data.organizationId == event.data.organizationId',
          },
        ],
      }),
      { event: 'streak/start' },
      expect.any(Function)
    );
  });

  it('sets streak start, waits 22h, sends reminders, waits 2h, then sets streak end', async () => {
    const step = createMockStep();
    const event = { data: { organizationId: 'org-1' } };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith('set-streak-start', expect.any(Function));
    expect(emailActivity.setStreak).toHaveBeenCalledWith('org-1', 'start');

    expect(step.sleep).toHaveBeenCalledWith('wait-22h', '22h');

    expect(step.run).toHaveBeenCalledWith('send-reminder', expect.any(Function));
    expect(postActivity.notifyStreakReminder).toHaveBeenCalledWith('org-1');

    expect(step.sleep).toHaveBeenCalledWith('wait-2h', '2h');

    expect(step.run).toHaveBeenCalledWith('set-streak-end', expect.any(Function));
    expect(emailActivity.setStreak).toHaveBeenCalledWith('org-1', 'end');
  });
});
