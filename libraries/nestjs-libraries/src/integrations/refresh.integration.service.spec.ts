import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RefreshIntegrationService } from './refresh.integration.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';

const mockAuthTokenDetails = {
  id: 'auth-1',
  name: 'X Account',
  accessToken: 'new-access-token',
  refreshToken: 'new-refresh-token',
  expiresIn: 3600,
  username: '@user',
  picture: 'https://example.com/pic.jpg',
};

const mockIntegration = {
  id: 'integration-1',
  organizationId: 'org-1',
  providerIdentifier: 'x',
  providerVersion: 'v1',
  name: 'My X Account',
  picture: 'https://example.com/avatar.png',
  internalId: 'internal-1',
  rootInternalId: 'internal-1',
  refreshToken: 'old-refresh-token',
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockRefreshToken: ReturnType<typeof vi.fn>;
let mockIntegrationManager: any;
let mockIntegrationService: any;

vi.mock('./integration.manager', () => ({
  IntegrationManager: vi.fn(() => mockIntegrationManager),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: vi.fn(() => mockIntegrationService),
}));

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: vi.fn().mockReturnValue(true),
}));

describe('RefreshIntegrationService', () => {
  let service: RefreshIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    mockRefreshToken = vi.fn().mockResolvedValue(mockAuthTokenDetails);
    mockIntegrationService = {
      createOrUpdateIntegration: vi.fn().mockResolvedValue({}),
      setBetweenRefreshSteps: vi.fn().mockResolvedValue(undefined),
      informAboutRefreshError: vi.fn().mockResolvedValue(undefined),
      refreshNeeded: vi.fn().mockResolvedValue(undefined),
      disconnectChannel: vi.fn().mockResolvedValue(undefined),
    };
    const mockProvider = {
      identifier: 'x',
      name: 'X',
      refreshToken: mockRefreshToken,
      reConnect: undefined,
      refreshCron: true,
      oneTimeToken: false,
    };
    mockIntegrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(mockProvider),
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue(mockProvider),
      requireClientInformation: vi.fn().mockResolvedValue({ client_id: 'mock-id', client_secret: 'mock-secret', instanceUrl: '' }),
    };
    vi.mocked(inngest.send).mockResolvedValue(undefined);
    service = new RefreshIntegrationService(
      mockIntegrationManager as any,
      mockIntegrationService as any,
    );
  });

  describe('refresh', () => {
    it('successfully refreshes token and updates integration', async () => {
      const result = await service.refresh(mockIntegration as any);
      // 4.13: the refresh path now pins the row's stored version.
      expect(mockIntegrationManager.getSocialIntegrationUnchecked).toHaveBeenCalledWith('x', 'v1');
      expect(mockRefreshToken).toHaveBeenCalledWith('old-refresh-token', expect.any(Object));
      expect(mockIntegrationService.createOrUpdateIntegration).toHaveBeenCalledWith(
        undefined,
        false,
        'org-1',
        'My X Account',
        'https://example.com/avatar.png',
        'social',
        'internal-1',
        'x',
        'new-access-token',
        'new-refresh-token',
        3600,
      );
      expect(result).toEqual(mockAuthTokenDetails);
    });

    it('returns false when refreshProcess returns false', async () => {
      mockRefreshToken.mockRejectedValue(new Error('API error'));
      const result = await service.refresh(mockIntegration as any);
      expect(result).toBe(false);
    });

    it('passes cause to refreshProcess on failure', async () => {
      mockRefreshToken.mockRejectedValue(new Error('fail'));
      const result = await service.refresh(mockIntegration as any, 'token_expired');
      expect(result).toBe(false);
      expect(mockIntegrationService.refreshNeeded).toHaveBeenCalled();
    });
  });

  describe('setBetweenSteps', () => {
    it('calls setBetweenRefreshSteps and informAboutRefreshError', async () => {
      await service.setBetweenSteps(mockIntegration as any, 'error cause');
      expect(mockIntegrationService.setBetweenRefreshSteps).toHaveBeenCalledWith(
        'integration-1',
        'org-1'
      );
      expect(mockIntegrationService.informAboutRefreshError).toHaveBeenCalledWith(
        'org-1',
        mockIntegration,
        'error cause',
      );
    });
  });

  describe('startRefreshWorkflow', () => {
    it('cancels any stale loop first, then starts a new chain with unique ids', async () => {
      const result = await service.startRefreshWorkflow('org-1', 'integration-1', mockIntegrationManager.getSocialIntegration());
      expect(inngest.send).toHaveBeenCalledTimes(2);

      const events = vi.mocked(inngest.send).mock.calls.map(([event]) => event as any);
      // F3: the cancel goes out BEFORE the start so a reconnect supersedes any
      // still-sleeping loop (a reconnect upserts the same integration row).
      expect(events[0]).toEqual({
        name: 'integration/refresh-token/cancel',
        data: { integrationId: 'integration-1' },
        id: expect.stringMatching(/^refresh_cancel_integration-1_[0-9a-f-]{36}$/),
      });
      expect(events[1]).toEqual({
        name: 'integration/refresh-token',
        data: { integrationId: 'integration-1', organizationId: 'org-1' },
        id: expect.stringMatching(/^refresh_start_integration-1_[0-9a-f-]{36}$/),
      });
      expect(result).toBeUndefined();
    });

    it('never reuses an id across successive starts (24h dedup window)', async () => {
      const provider = mockIntegrationManager.getSocialIntegration();
      await service.startRefreshWorkflow('org-1', 'integration-1', provider);
      await service.startRefreshWorkflow('org-1', 'integration-1', provider);

      const ids = vi.mocked(inngest.send).mock.calls.map(([event]) => (event as any).id);
      expect(new Set(ids).size).toBe(4);
      expect(ids[1]).toMatch(/^refresh_start_integration-1_[0-9a-f-]{36}$/);
      expect(ids[3]).toMatch(/^refresh_start_integration-1_[0-9a-f-]{36}$/);
    });

    it('returns false when refreshCron is false', async () => {
      const result = await service.startRefreshWorkflow('org-1', 'integration-1', { refreshCron: false } as any);
      expect(result).toBe(false);
    });

    it('returns false when refreshCron is undefined', async () => {
      const result = await service.startRefreshWorkflow('org-1', 'integration-1', {} as any);
      expect(result).toBe(false);
    });

    it('returns false and does not send event when Inngest is disabled', async () => {
      vi.mocked(isInngestEnabled).mockReturnValue(false);
      const result = await service.startRefreshWorkflow('org-1', 'integration-1', mockIntegrationManager.getSocialIntegration());
      expect(inngest.send).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('refreshProcess (via refresh)', () => {
    it('returns refresh directly when rootInternalId equals internalId', async () => {
      const result = await service.refresh(mockIntegration as any);
      expect(result).toEqual(mockAuthTokenDetails);
      expect(mockIntegrationService.createOrUpdateIntegration).toHaveBeenCalled();
    });

    it('calls reConnect when reConnect exists and rootInternalId differs', async () => {
      const reConnectResult = { id: 'reconnected-id', name: 'Reconnected', accessToken: 're-token', username: '@re' };
      mockIntegrationManager.getSocialIntegrationUnchecked.mockReturnValue({
        identifier: 'x',
        refreshToken: mockRefreshToken,
        reConnect: vi.fn().mockResolvedValue(reConnectResult),
        oneTimeToken: false,
      });
      const integrationWithDiffRoot = { ...mockIntegration, rootInternalId: 'root-1', internalId: 'child-1' };
      const result = await service.refresh(integrationWithDiffRoot as any);
      const provider = mockIntegrationManager.getSocialIntegrationUnchecked();
      expect(provider.reConnect).toHaveBeenCalledWith('root-1', 'child-1', 'new-access-token');
      expect(result).toMatchObject({ ...mockAuthTokenDetails, ...reConnectResult });
    });

    it('triggers disconnect chain when refresh returns no accessToken', async () => {
      mockRefreshToken.mockResolvedValue({ ...mockAuthTokenDetails, accessToken: '' });
      const result = await service.refresh(mockIntegration as any);
      expect(result).toBe(false);
      expect(mockIntegrationService.refreshNeeded).toHaveBeenCalled();
      expect(mockIntegrationService.informAboutRefreshError).toHaveBeenCalled();
      expect(mockIntegrationService.disconnectChannel).toHaveBeenCalled();
    });

    it('triggers disconnect chain when refresh returns false', async () => {
      mockRefreshToken.mockResolvedValue(false);
      const result = await service.refresh(mockIntegration as any);
      expect(result).toBe(false);
      expect(mockIntegrationService.disconnectChannel).toHaveBeenCalled();
    });
  });
});
