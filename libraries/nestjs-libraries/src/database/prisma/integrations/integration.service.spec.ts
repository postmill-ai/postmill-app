import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrationService } from './integration.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
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
