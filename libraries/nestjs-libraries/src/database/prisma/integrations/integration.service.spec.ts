import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrationService } from './integration.service';
import {
  inngest,
  isInngestEnabled,
} from '@postmill-ai/nestjs-libraries/inngest/inngest.client';

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: vi.fn().mockReturnValue(true),
}));

describe('IntegrationService.getHealthSummary', () => {
  it('returns only unhealthy integrations and omits token fields', async () => {
    const repository = {
      getIntegrationsHealth: vi.fn().mockResolvedValue([
        { id: 'i1', name: 'X', providerIdentifier: 'x', picture: 'x.png', refreshNeeded: false, disabled: false, tokenExpiration: null },
        { id: 'i2', name: 'LinkedIn', providerIdentifier: 'linkedin', picture: 'li.png', refreshNeeded: true, disabled: false, tokenExpiration: null },
        { id: 'i3', name: 'Bluesky', providerIdentifier: 'bluesky', picture: 'bs.png', refreshNeeded: false, disabled: true, tokenExpiration: null },
      ]),
    } as any;

    const service = new IntegrationService(
      repository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.getHealthSummary('org-1');

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(['i2', 'i3']);
    for (const item of result) {
      expect(item).not.toHaveProperty('token');
      expect(item).not.toHaveProperty('refreshToken');
    }
  });

  it('returns empty array when all channels are healthy', async () => {
    const repository = {
      getIntegrationsHealth: vi.fn().mockResolvedValue([
        { id: 'i1', refreshNeeded: false, disabled: false },
      ]),
    } as any;

    const service = new IntegrationService(
      repository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(await service.getHealthSummary('org-1')).toEqual([]);
  });
});

describe('IntegrationService.informAboutRefreshError (24h dedup)', () => {
  const integration = {
    id: 'int-yt',
    organizationId: 'org-1',
    providerIdentifier: 'youtube',
  } as any;

  const build = (hasRecent: boolean | Error) => {
    const notificationService = {
      hasRecentForIntegration: vi.fn().mockImplementation(
        hasRecent instanceof Error
          ? () => Promise.reject(hasRecent)
          : () => Promise.resolve(hasRecent)
      ),
      notify: vi.fn().mockResolvedValue(undefined),
    } as any;
    const service = new IntegrationService(
      {} as any,
      {} as any,
      {} as any,
      notificationService,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, notificationService };
  };

  it('notifies when no recent refresh-error notification exists for the channel', async () => {
    const { service, notificationService } = build(false);

    await service.informAboutRefreshError('org-1', integration);

    expect(notificationService.hasRecentForIntegration).toHaveBeenCalledWith(
      'org-1',
      'channels',
      'int-yt',
      24 * 60 * 60 * 1000
    );
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        category: 'channels',
        metadata: expect.objectContaining({ integrationId: 'int-yt' }),
      })
    );
  });

  it('skips the notification when one was already sent within 24h', async () => {
    const { service, notificationService } = build(true);

    await service.informAboutRefreshError('org-1', integration);

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('notifies anyway when the dedup probe fails (never suppress the alert)', async () => {
    const { service, notificationService } = build(new Error('db down'));

    await service.informAboutRefreshError('org-1', integration);

    expect(notificationService.notify).toHaveBeenCalled();
  });
});

describe('IntegrationService.refreshTokens', () => {
  it('continues the sweep past a failing integration', async () => {
    const failProvider = {
      identifier: 'youtube',
      oneTimeToken: false,
      refreshToken: vi.fn().mockRejectedValue(new Error('dead token')),
    };
    const okProvider = {
      identifier: 'x',
      oneTimeToken: false,
      refreshToken: vi.fn().mockResolvedValue({
        refreshToken: 'new-r',
        accessToken: 'new-a',
        expiresIn: 3600,
      }),
    };
    const repository = {
      needsToBeRefreshed: vi.fn().mockResolvedValue([
        { id: 'i-dead', organizationId: 'org-1', providerIdentifier: 'youtube', providerVersion: 'v1', refreshToken: 'old-r', name: 'YT', internalId: 'yt-1' },
        { id: 'i-ok', organizationId: 'org-1', providerIdentifier: 'x', providerVersion: 'v1', refreshToken: 'old-x', name: 'X', internalId: 'x-1' },
      ]),
      refreshNeeded: vi.fn().mockResolvedValue(undefined),
    } as any;
    const manager = {
      getSocialIntegrationUnchecked: vi.fn((id: string) =>
        id === 'youtube' ? failProvider : okProvider
      ),
      requireClientInformation: vi.fn().mockResolvedValue(undefined),
    } as any;
    const notificationService = {
      hasRecentForIntegration: vi.fn().mockResolvedValue(false),
      notify: vi.fn().mockResolvedValue(undefined),
    } as any;
    const service = new IntegrationService(
      repository,
      {} as any,
      manager,
      notificationService,
      {} as any,
      {} as any,
      {} as any
    );
    const upsert = vi
      .spyOn(service, 'createOrUpdateIntegration')
      .mockResolvedValue({} as any);

    await service.refreshTokens();

    // The dead channel is flagged + the user alerted (deduped)…
    expect(repository.refreshNeeded).toHaveBeenCalledWith('org-1', 'i-dead');
    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    // …and the healthy channel behind it still refreshes (no batch abort).
    expect(okProvider.refreshToken).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      undefined,
      false,
      'org-1',
      'X',
      undefined,
      'social',
      'x-1',
      'x',
      'new-a',
      'new-r',
      3600
    );
  });
});

describe('IntegrationService.deleteChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isInngestEnabled).mockReturnValue(true);
  });

  const build = () => {
    const repository = {
      deleteChannel: vi.fn().mockResolvedValue({ id: 'int-1' }),
    } as any;
    const audit = { create: vi.fn().mockResolvedValue(undefined) } as any;
    const service = new IntegrationService(
      repository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      audit,
    );
    return { service, repository };
  };

  it('emits a refresh-token cancel with a unique id after deleting', async () => {
    const { service, repository } = build();

    const result = await service.deleteChannel('org-1', 'int-1');

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1');
    expect(result).toEqual({ id: 'int-1' });
    // F3: kill any still-sleeping token-refresh loop for the deleted channel.
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(inngest.send).mock.calls[0][0]).toEqual({
      name: 'integration/refresh-token/cancel',
      data: { integrationId: 'int-1' },
      id: expect.stringMatching(/^refresh_cancel_int-1_[0-9a-f-]{36}$/),
    });
  });

  it('uses a fresh cancel id per delete (24h dedup window)', async () => {
    const { service } = build();

    await service.deleteChannel('org-1', 'int-1');
    await service.deleteChannel('org-1', 'int-1');

    const ids = vi.mocked(inngest.send).mock.calls.map(([event]) => (event as any).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('does not emit a cancel when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);
    const { service } = build();

    await service.deleteChannel('org-1', 'int-1');

    expect(inngest.send).not.toHaveBeenCalled();
  });
});
