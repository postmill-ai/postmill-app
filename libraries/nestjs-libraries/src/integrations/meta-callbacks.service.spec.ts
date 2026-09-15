import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const redisStore = new Map<string, string>();
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void redisStore.set(key, value)),
  },
}));

import { MetaCallbacksService, metaDeletionStatusKey } from './meta-callbacks.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Build a Meta signed_request exactly as Meta does. */
const sign = (secret: string, payload: Record<string, unknown>) => {
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(payloadB64).digest();
  return `${b64url(sig)}.${payloadB64}`;
};

const integration = (over: Record<string, unknown>) => ({
  id: 'int-1',
  organizationId: 'org-1',
  name: 'Page',
  providerIdentifier: 'facebook',
  internalId: 'page-1',
  rootInternalId: 'fbuser-1',
  ...over,
});

describe('MetaCallbacksService', () => {
  let service: MetaCallbacksService;
  let prisma: any;
  let integrationRepository: any;
  let integrationService: any;
  let integrationManager: any;
  let postsService: any;
  let usersRepository: any;
  let authProviderRepository: any;
  let encryption: any;
  let auditService: any;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    redisStore.clear();
    process.env.FACEBOOK_APP_SECRET = 'fb-secret';
    process.env.INSTAGRAM_APP_SECRET = 'ig-secret';
    process.env.THREADS_APP_SECRET = 'th-secret';
    process.env.FRONTEND_URL = 'https://app.example/';
    prisma = {
      $transaction: vi.fn(async (ops: unknown[]) => ops),
      plugs: { deleteMany: vi.fn((a) => ({ op: 'plugs', ...a })) },
      socialComment: { deleteMany: vi.fn((a) => ({ op: 'socialComment', ...a })) },
      postAnalyticsSnapshot: { deleteMany: vi.fn((a) => ({ op: 'postAnalyticsSnapshot', ...a })) },
      analyticsSnapshot: { deleteMany: vi.fn((a) => ({ op: 'analyticsSnapshot', ...a })) },
      analyticsAnomaly: { deleteMany: vi.fn((a) => ({ op: 'analyticsAnomaly', ...a })) },
      analyticsAlertRule: { updateMany: vi.fn((a) => ({ op: 'analyticsAlertRule', ...a })) },
      integration: { update: vi.fn((a) => ({ op: 'integration', ...a })) },
    };
    integrationRepository = { findByMetaUser: vi.fn().mockResolvedValue([]) };
    integrationService = {
      disconnectChannel: vi.fn().mockResolvedValue(undefined),
      getPostsForChannel: vi.fn().mockResolvedValue([]),
    };
    integrationManager = { invalidateIntegrationListCache: vi.fn().mockResolvedValue(undefined) };
    postsService = { deletePost: vi.fn().mockResolvedValue(undefined) };
    usersRepository = { getUserByProvider: vi.fn().mockResolvedValue(null) };
    authProviderRepository = { findByProvider: vi.fn().mockResolvedValue(null) };
    encryption = { decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')) };
    auditService = { create: vi.fn().mockResolvedValue(undefined) };
    service = new MetaCallbacksService(
      prisma,
      integrationRepository,
      integrationService,
      integrationManager,
      postsService,
      usersRepository,
      authProviderRepository,
      encryption,
      auditService,
    );
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe('parseSignedRequest', () => {
    it.each([
      ['fb-secret', 'facebook', 'FACEBOOK_APP_SECRET'],
      ['ig-secret', 'instagram-standalone', 'INSTAGRAM_APP_SECRET'],
      ['th-secret', 'threads', 'THREADS_APP_SECRET'],
    ])('verifies a request signed with %s and resolves the app family', async (secret, family, source) => {
      const parsed = await service.parseSignedRequest(
        sign(secret, { user_id: 12345, algorithm: 'HMAC-SHA256', issued_at: 1700000000 }),
      );
      expect(parsed).toMatchObject({ family, source, payload: { user_id: '12345', issued_at: 1700000000 } });
    });

    it('accepts the Facebook SSO secret from AuthProviderConfig when enabled', async () => {
      authProviderRepository.findByProvider.mockResolvedValue({ enabled: true, clientSecret: 'enc:sso-secret' });
      const parsed = await service.parseSignedRequest(sign('sso-secret', { user_id: '1', algorithm: 'HMAC-SHA256' }));
      expect(parsed).toMatchObject({ family: 'facebook', source: 'AuthProviderConfig(FACEBOOK)' });
    });

    it.each([
      ['tampered signature', sign('fb-secret', { user_id: '1', algorithm: 'HMAC-SHA256' }).replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))],
      ['unknown secret', sign('someone-elses-app', { user_id: '1', algorithm: 'HMAC-SHA256' })],
      ['wrong algorithm', sign('fb-secret', { user_id: '1', algorithm: 'HMAC-SHA1' })],
      ['no user_id', sign('fb-secret', { algorithm: 'HMAC-SHA256' })],
      ['malformed', 'not-a-signed-request'],
      ['non-json payload', `${b64url('sig')}.${b64url('nope')}`],
    ])('rejects %s', async (_label, value) => {
      expect(await service.parseSignedRequest(value)).toBeNull();
    });

    it('rejects non-string input', async () => {
      expect(await service.parseSignedRequest(undefined)).toBeNull();
      expect(await service.parseSignedRequest({ signed_request: 'x' })).toBeNull();
    });

    it('ignores unset secrets', async () => {
      delete process.env.FACEBOOK_APP_SECRET;
      expect(await service.parseSignedRequest(sign('fb-secret', { user_id: '1', algorithm: 'HMAC-SHA256' }))).toBeNull();
    });
  });

  describe('deauthorize', () => {
    it('marks every matching channel reconnect-needed across orgs, audits, invalidates caches', async () => {
      integrationRepository.findByMetaUser.mockResolvedValue([
        integration({ id: 'int-1', organizationId: 'org-1' }),
        integration({ id: 'int-2', organizationId: 'org-2', providerIdentifier: 'instagram' }),
      ]);
      const result = await service.deauthorize('facebook', 'fbuser-1');
      expect(result).toEqual({ channels: 2 });
      expect(integrationRepository.findByMetaUser).toHaveBeenCalledWith(['facebook', 'instagram'], 'fbuser-1');
      expect(integrationService.disconnectChannel).toHaveBeenCalledTimes(2);
      expect(integrationService.disconnectChannel).toHaveBeenCalledWith('org-2', expect.objectContaining({ id: 'int-2' }));
      expect(integrationManager.invalidateIntegrationListCache.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['org-1', 'org-2']);
      expect(auditService.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', action: 'integration.deauthorized-by-provider', entityId: 'int-1' }),
      );
      expect(postsService.deletePost).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the app family', async () => {
      await service.deauthorize('threads', 'th-1');
      expect(integrationRepository.findByMetaUser).toHaveBeenCalledWith(['threads'], 'th-1');
      await service.deauthorize('instagram-standalone', 'ig-1');
      expect(integrationRepository.findByMetaUser).toHaveBeenCalledWith(['instagram-standalone'], 'ig-1');
    });

    it('is a no-op (0 channels) for an unknown user', async () => {
      expect(await service.deauthorize('facebook', 'nobody')).toEqual({ channels: 0 });
      expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
    });
  });

  describe('requestDeletion', () => {
    it('soft-deletes posts, purges Meta-derived data, scrubs the channel, records status, returns the Meta shape', async () => {
      integrationRepository.findByMetaUser.mockResolvedValue([integration({})]);
      integrationService.getPostsForChannel.mockResolvedValue([{ group: 'g1' }, { group: 'g2' }]);

      const result = await service.requestDeletion('facebook', 'fbuser-1');

      expect(result.confirmation_code).toMatch(/^[A-Z2-9]{12}$/);
      expect(result.url).toBe(`https://app.example/integrations/social/meta/data-deletion?code=${result.confirmation_code}`);
      expect(postsService.deletePost).toHaveBeenCalledWith('org-1', 'g1');
      expect(postsService.deletePost).toHaveBeenCalledWith('org-1', 'g2');

      const ops = prisma.$transaction.mock.calls[0][0].map((o: any) => o.op);
      expect(ops).toEqual([
        'plugs', 'socialComment', 'postAnalyticsSnapshot', 'analyticsSnapshot', 'analyticsAnomaly', 'analyticsAlertRule', 'integration',
      ]);
      const where = { organizationId: 'org-1', integrationId: 'int-1' };
      expect(prisma.socialComment.deleteMany).toHaveBeenCalledWith({ where });
      expect(prisma.analyticsAlertRule.updateMany).toHaveBeenCalledWith({ where, data: { integrationId: null } });
      expect(prisma.integration.update).toHaveBeenCalledWith({
        where: { id: 'int-1', organizationId: 'org-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          token: '',
          refreshToken: null,
          picture: null,
          profile: null,
          name: 'Removed (Meta data deletion)',
          customInstanceDetails: null,
        }),
      });
      expect(integrationManager.invalidateIntegrationListCache).toHaveBeenCalledWith('org-1');
      expect(auditService.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'integration.deleted-by-provider' }));

      expect(ioRedis.set).toHaveBeenCalledWith(
        metaDeletionStatusKey(result.confirmation_code),
        expect.any(String),
        'EX',
        180 * 24 * 60 * 60,
      );
      expect(result.status).toMatchObject({ status: 'completed', family: 'facebook', channels: 1, notes: [] });
      expect(await service.deletionStatus(result.confirmation_code)).toMatchObject({ status: 'completed', channels: 1 });
    });

    it('still issues a completed status (0 channels) when nothing matches — Meta needs a code either way', async () => {
      const result = await service.requestDeletion('threads', 'nobody');
      expect(result.status).toMatchObject({ status: 'completed', channels: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('never deletes a Facebook-login account; it reports it in the status notes instead', async () => {
      usersRepository.getUserByProvider.mockResolvedValue({ id: 'user-9' });
      const result = await service.requestDeletion('facebook', 'fbuser-1');
      expect(usersRepository.getUserByProvider).toHaveBeenCalledWith('fbuser-1', 'FACEBOOK');
      expect(result.status.notes?.[0]).toContain('Facebook Login');
      expect(result.status.notes?.[0]).toContain('support@postmill.ai');
    });

    it('does not look for SSO accounts for non-Facebook families', async () => {
      await service.requestDeletion('threads', 'th-1');
      expect(usersRepository.getUserByProvider).not.toHaveBeenCalled();
    });

    it('a failing post deletion does not abort the purge', async () => {
      integrationRepository.findByMetaUser.mockResolvedValue([integration({})]);
      integrationService.getPostsForChannel.mockResolvedValue([{ group: 'g1' }]);
      postsService.deletePost.mockRejectedValue(new Error('inngest down'));
      const result = await service.requestDeletion('facebook', 'fbuser-1');
      expect(result.status.channels).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deletionStatus', () => {
    it('is unknown for an unseen or malformed code and case-insensitive for a known one', async () => {
      expect(await service.deletionStatus('NOPE12345678')).toEqual({ code: 'NOPE12345678', status: 'unknown' });
      expect(await service.deletionStatus('../etc')).toMatchObject({ status: 'unknown' });
      redisStore.set(metaDeletionStatusKey('ABCDEFGH2345'), JSON.stringify({ code: 'ABCDEFGH2345', status: 'completed', channels: 2 }));
      expect(await service.deletionStatus('abcdefgh2345')).toMatchObject({ status: 'completed', channels: 2 });
    });
  });
});
