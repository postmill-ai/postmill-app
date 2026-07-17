import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createRefreshToken } from './refresh-token';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createRefreshToken', () => {
  let integrationsActivity: {
    getIntegrationsById: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
  };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    integrationsActivity = {
      getIntegrationsById: vi.fn(),
      refreshToken: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createRefreshToken(integrationsActivity as any);
  });

  it('registers an integration/refresh-token event handler with cancelOn', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'refresh-token',
        cancelOn: [
          {
            event: 'integration/refresh-token/cancel',
            if: 'async.data.integrationId == event.data.integrationId',
          },
        ],
      }),
      { event: 'integration/refresh-token' },
      expect.any(Function)
    );
  });

  it('gets the integration, sleeps until expiry, rechecks, refreshes, and re-emits with a unique id', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById
      .mockResolvedValueOnce({
        id: 'int-1',
        tokenExpiration: future,
        deletedAt: null,
        refreshNeeded: false,
      })
      .mockResolvedValueOnce({
        id: 'int-1',
        tokenExpiration: future,
        deletedAt: null,
        refreshNeeded: false,
      });
    integrationsActivity.refreshToken.mockResolvedValue({ accessToken: 'tok' });

    const step = createMockStep();
    const event = {
      data: { integrationId: 'int-1', organizationId: 'org-1' },
    };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith('get', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('recheck', expect.any(Function));
    expect(step.run).toHaveBeenCalledWith('refresh', expect.any(Function));
    expect(integrationsActivity.refreshToken).toHaveBeenCalled();
    expect(step.sleep).toHaveBeenCalledWith('sleep-until-expiry', expect.any(Number));
    // F3: the reschedule id must be unique per cycle — a constant id lands in
    // Inngest's 24h dedup window and black-holes the chain.
    expect(step.sendEvent).toHaveBeenCalledWith('integration/refresh-token', {
      name: 'integration/refresh-token',
      data: { integrationId: 'int-1', organizationId: 'org-1', retries: 0 },
      id: expect.stringMatching(/^refresh_int-1_[0-9a-f-]{36}$/),
    });
  });

  it('enqueues two successive cycles with distinct reschedule ids (1h TTL)', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: future,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue({ accessToken: 'tok' });

    // Cycle 1 — the start event carries no retries counter.
    const step1 = createMockStep();
    await getHandler()({
      step: step1,
      event: { data: { integrationId: 'int-1', organizationId: 'org-1' } },
    });
    const rescheduled1 = step1.sendEvent.mock.calls[0][1];
    expect(rescheduled1.id).toMatch(/^refresh_int-1_[0-9a-f-]{36}$/);
    expect(rescheduled1.data).toEqual({
      integrationId: 'int-1',
      organizationId: 'org-1',
      retries: 0,
    });

    // Cycle 2 — feed the rescheduled payload back in.
    const step2 = createMockStep();
    await getHandler()({ step: step2, event: { data: rescheduled1.data } });
    const rescheduled2 = step2.sendEvent.mock.calls[0][1];
    expect(rescheduled2.id).toMatch(/^refresh_int-1_[0-9a-f-]{36}$/);
    expect(rescheduled2.id).not.toBe(rescheduled1.id);
  });

  it('returns early when the integration is missing or deleted', async () => {
    integrationsActivity.getIntegrationsById.mockResolvedValue(null);

    const step = createMockStep();
    const event = {
      data: { integrationId: 'int-1', organizationId: 'org-1' },
    };

    await getHandler()({ step, event });

    expect(step.sleep).not.toHaveBeenCalled();
    expect(step.sendEvent).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'not-a-date'])(
    'terminates without sleeping when tokenExpiration is %s',
    async (tokenExpiration) => {
      integrationsActivity.getIntegrationsById.mockResolvedValue({
        id: 'int-1',
        tokenExpiration,
        deletedAt: null,
        refreshNeeded: false,
      });

      const step = createMockStep();
      await getHandler()({
        step,
        event: { data: { integrationId: 'int-1', organizationId: 'org-1' } },
      });

      // Never step.sleep(NaN): a missing/unparseable expiry terminates the chain.
      expect(step.sleep).not.toHaveBeenCalled();
      expect(step.sendEvent).not.toHaveBeenCalled();
      expect(integrationsActivity.refreshToken).not.toHaveBeenCalled();
    }
  );

  it('refreshes immediately on first sight of an expired-but-healthy token', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue({ accessToken: 'tok' });

    const step = createMockStep();
    await getHandler()({
      step,
      event: { data: { integrationId: 'int-1', organizationId: 'org-1' } },
    });

    // Genuinely recoverable (not yet refreshNeeded) → no sleep, straight to refresh.
    expect(step.sleep).not.toHaveBeenCalled();
    expect(integrationsActivity.refreshToken).toHaveBeenCalledTimes(1);
    expect(step.sendEvent.mock.calls[0][1].data.retries).toBe(0);
  });

  it('applies a minimum sleep floor on retry cycles for an expired token', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue(false);

    const step = createMockStep();
    await getHandler()({
      step,
      event: {
        data: { integrationId: 'int-1', organizationId: 'org-1', retries: 1 },
      },
    });

    // 5-minute floor — a revoked token must not hot-loop at 0-sleep.
    expect(step.sleep).toHaveBeenCalledWith(
      'sleep-until-expiry',
      5 * 60 * 1000
    );
    expect(step.sendEvent.mock.calls[0][1].data.retries).toBe(2);
  });

  it('terminates a revoked token within 5 failed cycles (bounded notifications)', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    // The refresh keeps failing without flagging the row (e.g. retired
    // adapter) — only the retries cap may stop the chain.
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue(false);

    let data: any = { integrationId: 'int-1', organizationId: 'org-1' };
    for (let cycle = 0; cycle < 8; cycle++) {
      const step = createMockStep();
      await getHandler()({ step, event: { data } });
      const rescheduled = step.sendEvent.mock.calls[0]?.[1];
      if (!rescheduled) {
        break;
      }
      data = rescheduled.data;
    }

    // Exactly 5 failed refresh attempts, then the chain terminates — it can
    // neither hot-loop nor keep firing refresh-error notifications forever.
    expect(integrationsActivity.refreshToken).toHaveBeenCalledTimes(5);

    const lastStep = createMockStep();
    await getHandler()({ step: lastStep, event: { data } });
    expect(lastStep.sleep).not.toHaveBeenCalled();
    expect(lastStep.sendEvent).not.toHaveBeenCalled();
    expect(integrationsActivity.refreshToken).toHaveBeenCalledTimes(5);
  });

  it('terminates on the next cycle once the integration is flagged refreshNeeded', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    // First cycle: healthy-but-expired → immediate refresh attempt; the real
    // refresh path flags the row refreshNeeded on failure.
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue(false);

    const step1 = createMockStep();
    await getHandler()({
      step: step1,
      event: { data: { integrationId: 'int-1', organizationId: 'org-1' } },
    });
    expect(integrationsActivity.refreshToken).toHaveBeenCalledTimes(1);
    const rescheduled = step1.sendEvent.mock.calls[0][1];
    expect(rescheduled.data.retries).toBe(1);

    // Second cycle: the row is now flagged → terminate without another attempt.
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: true,
    });
    const step2 = createMockStep();
    await getHandler()({ step: step2, event: { data: rescheduled.data } });
    expect(step2.sleep).not.toHaveBeenCalled();
    expect(step2.sendEvent).not.toHaveBeenCalled();
    expect(integrationsActivity.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('resets the retries counter after a successful refresh', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById.mockResolvedValue({
      id: 'int-1',
      tokenExpiration: past,
      deletedAt: null,
      refreshNeeded: false,
    });
    integrationsActivity.refreshToken.mockResolvedValue({ accessToken: 'tok' });

    const step = createMockStep();
    await getHandler()({
      step,
      event: {
        data: { integrationId: 'int-1', organizationId: 'org-1', retries: 3 },
      },
    });

    expect(step.sendEvent.mock.calls[0][1].data.retries).toBe(0);
  });

  it('returns early when the integration is flagged refreshNeeded during the sleep', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    integrationsActivity.getIntegrationsById
      .mockResolvedValueOnce({
        id: 'int-1',
        tokenExpiration: future,
        deletedAt: null,
        refreshNeeded: false,
      })
      .mockResolvedValueOnce({
        id: 'int-1',
        tokenExpiration: future,
        deletedAt: null,
        refreshNeeded: true,
      });

    const step = createMockStep();
    await getHandler()({
      step,
      event: { data: { integrationId: 'int-1', organizationId: 'org-1' } },
    });

    expect(step.sleep).toHaveBeenCalled();
    expect(integrationsActivity.refreshToken).not.toHaveBeenCalled();
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});
