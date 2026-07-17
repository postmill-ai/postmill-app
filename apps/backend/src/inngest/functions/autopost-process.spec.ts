import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createAutopostProcess } from './autopost-process';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createAutopostProcess', () => {
  let autopostActivity: { autoPost: ReturnType<typeof vi.fn> };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    autopostActivity = {
      autoPost: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createAutopostProcess(autopostActivity as any);
  });

  it('registers an autopost/process event handler with cancelOn', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'autopost-process',
        cancelOn: [
          {
            event: 'autopost/cancel',
            if: 'async.data.id == event.data.id',
          },
        ],
      }),
      { event: 'autopost/process' },
      expect.any(Function)
    );
  });

  it('runs autoPost, sleeps 1h, then re-emits autopost/process WITHOUT a constant idempotency id (0.9)', async () => {
    const step = createMockStep();
    const event = { data: { id: 'auto-1', organizationId: 'org-1' } };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith('process', expect.any(Function));
    expect(autopostActivity.autoPost).toHaveBeenCalledWith('auto-1', 'org-1');
    expect(step.sleep).toHaveBeenCalledWith('wait-1h', '1h');
    // 0.9: the self-send must NOT carry a constant `autopost-${id}` id, or every
    // hourly hop would dedupe against the activation event and recurrence dies
    // after the first run. The memoized step.sendEvent prevents in-run dupes.
    expect(step.sendEvent).toHaveBeenCalledWith('autopost/process', {
      name: 'autopost/process',
      data: { id: 'auto-1', organizationId: 'org-1' },
    });
    const [, payload] = step.sendEvent.mock.calls[0];
    expect(payload).not.toHaveProperty('id');
  });
});
