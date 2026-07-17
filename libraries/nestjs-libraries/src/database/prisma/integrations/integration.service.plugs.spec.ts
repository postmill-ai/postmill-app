import { describe, it, expect, vi, beforeEach } from 'vitest';

// Side-effectful imports pulled in transitively by integration.service — stub them so the unit
// constructs without a Redis connection or a real storage adapter.
vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  RedisService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: class {
    getLocalAdapterForOrg = vi.fn().mockResolvedValue({ uploadSimple: vi.fn(), uploadFile: vi.fn() });
  },
}));

import { IntegrationService } from './integration.service';
import {
  clearAllCredentials,
  getOrgCredential,
  setCredentials,
} from '@gitroom/nestjs-libraries/integrations/credentials';

/**
 * Regression guard for the v3.7.1 cold-cache plug bug (§4.6).
 *
 * Plug automation hooks (e.g. X OAuth1 autoRepostPost / autoPlugPost / repostPostUsers) sign with
 * the provider's app credentials read via getOrgCredential(orgId, identifier, key), which resolves
 * from the lazily-populated per-org credential cache. Plugs run in worker processes that may not
 * have warmed the org's cache, and as of v3.7.1 there is no process.env fallback — so the plug
 * dispatchers (processPlugs / processInternalPlug) MUST warm the cache (via
 * integrationManager.getClientInformation, which ensureFresh-es the org) before invoking the plug.
 *
 * These tests model a COLD cache and a getClientInformation mock that warms it the way the real
 * OrgProviderConfigManager.ensureFresh would. If the warm is removed from the code under test, the
 * cache stays cold and the plug observes an empty app key — the semantic assertions fail.
 */
describe('IntegrationService — plug credential cache warming (v3.7.1 §4.6)', () => {
  const ORG_ID = 'org-1';
  const PROVIDER = 'x';
  const REAL_APP_KEY = 'db-app-key';
  const REAL_APP_SECRET = 'db-app-secret';

  let service: IntegrationService;
  let integrationRepository: any;
  let integrationManager: any;
  let callOrder: string[];
  let observedAppKey: string | undefined;

  // The plug method a provider would expose — reads its app key from the org credential cache,
  // exactly like x.provider's autoRepostPost / repostPostUsers do.
  const plugMethod = vi.fn(() => {
    callOrder.push('plug');
    observedAppKey = getOrgCredential(ORG_ID, PROVIDER, 'clientId');
    return true;
  });

  const mockProvider = {
    identifier: PROVIDER,
    autoRepostPost: plugMethod,
    repostPostUsers: plugMethod,
  };

  beforeEach(() => {
    clearAllCredentials(); // cold cache: nothing seeded for any org
    callOrder = [];
    observedAppKey = undefined;
    plugMethod.mockClear();

    integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(mockProvider),
      getInternalPlugs: vi.fn().mockReturnValue({
        internalPlugs: [{ identifier: 'repost', methodName: 'repostPostUsers' }],
      }),
      // Simulate ensureFresh: resolving an org's client info populates the whole-org cred cache.
      getClientInformation: vi.fn(async (identifier: string, orgId: string) => {
        callOrder.push('warm');
        setCredentials(orgId, identifier, {
          clientId: REAL_APP_KEY,
          clientSecret: REAL_APP_SECRET,
        });
        return { client_id: REAL_APP_KEY, client_secret: REAL_APP_SECRET, instanceUrl: '' };
      }),
    };

    integrationRepository = {
      getPlugForSystem: vi.fn().mockResolvedValue({
        id: 'plug-1',
        plugFunction: 'autoRepostPost',
        data: JSON.stringify([{ name: 'likesAmount', value: '10' }]),
        integration: {
          id: 'integration-1',
          organizationId: ORG_ID,
          providerIdentifier: PROVIDER,
        },
      }),
      getIntegrationById: vi.fn().mockResolvedValue({
        id: 'integration-1',
        organizationId: ORG_ID,
        providerIdentifier: PROVIDER,
      }),
    };

    service = new IntegrationService(
      integrationRepository as any,
      {} as any, // AutopostService (unused here)
      integrationManager as any,
      {} as any, // NotificationService (unused here)
      {} as any, // RefreshIntegrationService (unused here)
      {} as any, // (placeholder — unused in spec)
    );
  });

  describe('processPlugs', () => {
    it('warms the org credential cache before invoking the plug', async () => {
      await service.processPlugs({
        plugId: 'plug-1',
        postId: 'post-1',
        delay: 0,
        totalRuns: 1,
        currentRun: 1,
      });

      // Warm happened, with the right (providerIdentifier, orgId).
      expect(integrationManager.getClientInformation).toHaveBeenCalledWith(PROVIDER, ORG_ID);
      // Ordering: warm strictly before the plug dispatch.
      expect(callOrder).toEqual(['warm', 'plug']);
      // The plug saw the DB-backed app key, not an empty string from a cold cache.
      expect(observedAppKey).toBe(REAL_APP_KEY);
    });
  });

  describe('processInternalPlug', () => {
    it('warms the org credential cache before invoking the internal plug', async () => {
      await service.processInternalPlug({
        post: 'post-1',
        originalIntegration: 'integration-0',
        integration: 'integration-1',
        plugName: 'repost',
        orgId: ORG_ID,
        delay: 0,
        information: {},
      });

      expect(integrationManager.getClientInformation).toHaveBeenCalledWith(PROVIDER, ORG_ID);
      expect(callOrder).toEqual(['warm', 'plug']);
      expect(observedAppKey).toBe(REAL_APP_KEY);
    });
  });
});
