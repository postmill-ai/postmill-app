import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const redisStore = new Map<string, string>();
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
  },
}));

const safeFetchMock = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args),
}));

import { CommsConfigService } from './comms-config.service';
import { CommsConfigRepository } from './comms-config.repository';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';

const ORG = 'org-1';

const PLATFORM_ENV_VARS = [
  'SLACK_ID',
  'SLACK_SECRET',
  'SLACK_SIGNING_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_PUBLIC_KEY',
  'TELEGRAM_TOKEN',
];
const savedEnv: Record<string, string | undefined> = Object.fromEntries(
  PLATFORM_ENV_VARS.map((v) => [v, process.env[v]]),
);

afterAll(() => {
  for (const v of PLATFORM_ENV_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
});

describe('CommsConfigService', () => {
  let service: CommsConfigService;
  let repository: any;
  let resolution: any;
  let audit: any;
  let adapter: any;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example';
    redisStore.clear();
    safeFetchMock.mockReset();
    for (const v of PLATFORM_ENV_VARS) delete process.env[v];
    repository = {
      getByOrg: vi.fn().mockResolvedValue([]),
      getByIdentifier: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation((_org: string, identifier: string, data: any) =>
        Promise.resolve({ id: 'cfg-1', identifier, ...data }),
      ),
      delete: vi.fn().mockResolvedValue({ count: 1 }),
    };
    adapter = {
      name: 'telegram',
      capabilities: {
        webhookInbound: true,
        pollInbound: false,
        threads: false,
        webhookRegistration: true,
      },
      sendDirectMessage: vi.fn(),
      registerWebhook: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ ok: true, extra: { botUsername: 'pm_bot' } }),
    };
    resolution = {
      listManifests: vi.fn().mockReturnValue([
        {
          providerId: 'telegram',
          displayName: 'Telegram',
          version: 'v1',
          capabilities: adapter.capabilities,
          credentialFields: [
            { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
          ],
          setupNotes: 'notes',
        },
      ]),
      resolveComms: vi.fn().mockReturnValue(adapter),
      resolveWriteVersion: vi.fn().mockReturnValue('v1'),
      invalidate: vi.fn(),
    };
    audit = { record: vi.fn() };
    const encryption = {
      encrypt: vi.fn((value: string) => `enc:${value}`),
      decrypt: vi.fn((value: string) => value.replace(/^enc:/, '')),
    };
    service = new CommsConfigService(
      repository as CommsConfigRepository,
      encryption as unknown as EncryptionService,
      resolution as ProviderResolutionService,
      audit as AuditService,
    );
  });

  describe('getProviders', () => {
    it('masks credentials into per-field booleans and never returns values', async () => {
      repository.getByOrg.mockResolvedValue([
        {
          identifier: 'telegram',
          enabled: true,
          version: 'v1',
          webhookToken: 'tok123',
          credentials: `enc:${JSON.stringify({ botToken: 'secret', webhookSecret: 's' })}`,
          extraConfig: { webhookRegistered: true },
        },
      ]);
      const [item] = await service.getProviders(ORG);
      expect(item.isConfigured).toBe(true);
      expect(item.credentialsSet).toEqual({ botToken: true });
      expect(JSON.stringify(item)).not.toContain('secret');
      expect(item.webhookUrl).toBe('https://backend.example/webhooks/comms/telegram/tok123');
      expect(item.webhookRegistered).toBe(true);
    });

    it('lists unconfigured providers without a webhook URL', async () => {
      const [item] = await service.getProviders(ORG);
      expect(item.isConfigured).toBe(false);
      expect(item.webhookUrl).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('merges onto stored credentials so partial updates keep secrets', async () => {
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        version: 'v1',
        webhookToken: 'tok123',
        credentials: `enc:${JSON.stringify({ botToken: 'old', webhookSecret: 'ws' })}`,
        extraConfig: {},
      });
      await service.upsert(ORG, 'telegram', { enabled: true }, 'user-1');
      const stored = JSON.parse(
        repository.upsert.mock.calls[0][2].credentials.replace(/^enc:/, ''),
      );
      expect(stored.botToken).toBe('old');
      expect(stored.webhookSecret).toBe('ws');
      expect(resolution.invalidate).toHaveBeenCalledWith('comms', 'telegram', ORG);
      expect(audit.record).toHaveBeenCalled();
    });

    it('mints a webhook token + secret on create and registers the webhook', async () => {
      await service.upsert(ORG, 'telegram', { credentials: { botToken: 'tok' } });
      const call = repository.upsert.mock.calls[0][2];
      expect(call.webhookToken).toMatch(/^[0-9a-f]{32}$/);
      const stored = JSON.parse(call.credentials.replace(/^enc:/, ''));
      expect(stored.webhookSecret).toMatch(/^[0-9a-f]{32}$/);
      expect(adapter.registerWebhook).toHaveBeenCalledWith(
        `https://backend.example/webhooks/comms/telegram/${call.webhookToken}`,
        stored.webhookSecret,
      );
      expect(call.extraConfig.webhookRegistered).toBe(true);
    });

    it('surfaces webhook-registration failure without failing the save', async () => {
      adapter.registerWebhook.mockRejectedValue(new Error('telegram down'));
      const result = await service.upsert(ORG, 'telegram', {
        credentials: { botToken: 'tok' },
      });
      expect(result).toBeTruthy();
      const call = repository.upsert.mock.calls[0][2];
      expect(call.extraConfig.webhookRegistered).toBe(false);
      expect(call.extraConfig.webhookError).toContain('telegram down');
    });

    it('never lets a client write the internal webhookSecret', async () => {
      await service.upsert(ORG, 'telegram', {
        credentials: { botToken: 'tok', webhookSecret: 'attacker' },
      });
      const stored = JSON.parse(
        repository.upsert.mock.calls[0][2].credentials.replace(/^enc:/, ''),
      );
      expect(stored.webhookSecret).not.toBe('attacker');
    });
  });

  describe('test', () => {
    it('persists non-secret extras from a successful test', async () => {
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        version: 'v1',
        webhookToken: 'tok123',
        credentials: `enc:${JSON.stringify({ botToken: 't', webhookSecret: 'ws' })}`,
        extraConfig: {},
      });
      const result = await service.test(ORG, 'telegram');
      expect(result.ok).toBe(true);
      expect(repository.upsert.mock.calls[0][2].extraConfig.botUsername).toBe('pm_bot');
    });

    it('re-attempts a failed webhook registration on test', async () => {
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        version: 'v1',
        webhookToken: 'tok123',
        credentials: `enc:${JSON.stringify({ botToken: 't', webhookSecret: 'ws' })}`,
        extraConfig: { webhookRegistered: false, webhookError: 'was down' },
      });
      await service.test(ORG, 'telegram');
      expect(adapter.registerWebhook).toHaveBeenCalled();
      const extra = repository.upsert.mock.calls[0][2].extraConfig;
      expect(extra.webhookRegistered).toBe(true);
      expect(extra.webhookError).toBeUndefined();
    });

    it('returns the adapter error on failure', async () => {
      adapter.testConnection.mockResolvedValue({ ok: false, error: 'bad token' });
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        version: 'v1',
        webhookToken: 'tok123',
        credentials: `enc:${JSON.stringify({ botToken: 't' })}`,
        extraConfig: {},
      });
      expect(await service.test(ORG, 'telegram')).toEqual({ ok: false, error: 'bad token' });
    });
  });

  it('delete invalidates the resolution cache and audits', async () => {
    await service.delete(ORG, 'telegram', 'user-1');
    expect(resolution.invalidate).toHaveBeenCalledWith('comms', 'telegram', ORG);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'credential.deleted' }),
    );
  });

  it('resolveAdapter refuses disabled or missing configs', async () => {
    await expect(service.resolveAdapter(ORG, 'telegram')).rejects.toThrow('not configured');
    repository.getByIdentifier.mockResolvedValue({
      identifier: 'telegram',
      enabled: false,
      credentials: null,
    });
    await expect(service.resolveAdapter(ORG, 'telegram')).rejects.toThrow('not configured');
  });

  describe('getProviders platform fields', () => {
    it('serializes setup steps, portal/docs links, and the platform markers', async () => {
      process.env.TELEGRAM_TOKEN = 'tg-1';
      resolution.listManifests.mockReturnValue([
        {
          providerId: 'telegram',
          displayName: 'Telegram',
          version: 'v1',
          capabilities: adapter.capabilities,
          credentialFields: [
            { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
          ],
          setupNotes: 'notes',
          setupSteps: ['one', 'two'],
          portalUrl: 'https://t.me/BotFather',
          portalLabel: 'Telegram @BotFather',
          docsUrl: 'https://docs.postmill.ai/operations-guide/platform-comms-apps#telegram',
        },
      ]);
      const [item] = await service.getProviders(ORG);
      expect(item.setupSteps).toEqual(['one', 'two']);
      expect(item.portalUrl).toBe('https://t.me/BotFather');
      expect(item.portalLabel).toBe('Telegram @BotFather');
      expect(item.docsUrl).toContain('#telegram');
      expect(item.platformConnect).toBe('env');
      expect(item.platformConfigured).toBe(true);
      // Telegram registers its webhook programmatically — nothing to paste.
      expect(item.platformWebhookUrl).toBeUndefined();
    });

    it('reports platformConfigured false when the env app is incomplete', async () => {
      const [item] = await service.getProviders(ORG);
      expect(item.platformConnect).toBe('env');
      expect(item.platformConfigured).toBe(false);
    });

    it('exposes the platform webhook URL for slack but no marker for matrix', async () => {
      resolution.listManifests.mockReturnValue([
        {
          providerId: 'slack',
          displayName: 'Slack',
          version: 'v1',
          capabilities: adapter.capabilities,
          credentialFields: [],
          webhookInstructions: 'paste it',
        },
        {
          providerId: 'matrix',
          displayName: 'Matrix',
          version: 'v1',
          capabilities: adapter.capabilities,
          credentialFields: [],
        },
      ]);
      const items = await service.getProviders(ORG);
      const slack = items.find((i) => i.identifier === 'slack')!;
      const matrix = items.find((i) => i.identifier === 'matrix')!;
      expect(slack.platformConnect).toBe('oauth');
      expect(slack.platformWebhookUrl).toBe(
        'https://backend.example/webhooks/comms/platform/slack',
      );
      expect(slack.webhookInstructions).toBe('paste it');
      expect(matrix.platformConnect).toBeUndefined();
      expect(matrix.platformConfigured).toBe(false);
      expect(matrix.platformWebhookUrl).toBeUndefined();
    });
  });

  describe('ensureWebhookUrl', () => {
    it('creates a disabled placeholder with a minted token', async () => {
      const result = await service.ensureWebhookUrl(ORG, 'telegram');
      const call = repository.upsert.mock.calls[0][2];
      expect(call.enabled).toBe(false);
      expect(call.webhookToken).toMatch(/^[0-9a-f]{32}$/);
      expect(call.credentials).toBeUndefined();
      expect(result.webhookUrl).toBe(
        `https://backend.example/webhooks/comms/telegram/${call.webhookToken}`,
      );
    });

    it('is idempotent — an existing row just yields its URL', async () => {
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        webhookToken: 'tok123',
        enabled: false,
      });
      const result = await service.ensureWebhookUrl(ORG, 'telegram');
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(result.webhookUrl).toBe(
        'https://backend.example/webhooks/comms/telegram/tok123',
      );
    });

    it('400s on an unknown provider', async () => {
      resolution.resolveComms.mockImplementation(() => {
        throw new Error('Provider comms/nope@v1 not found');
      });
      await expect(service.ensureWebhookUrl(ORG, 'nope')).rejects.toThrow(
        'Unknown comms provider',
      );
    });
  });

  describe('platformConnect', () => {
    beforeEach(() => {
      adapter.provision = vi.fn().mockResolvedValue(undefined);
      safeFetchMock.mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'g-1' }, { id: 'g-2' }],
      });
    });

    it('400s for providers without an env platform app (or unknown ones)', async () => {
      await expect(service.platformConnect(ORG, 'slack')).rejects.toThrow(
        'does not support platform connect',
      );
      await expect(service.platformConnect(ORG, 'matrix')).rejects.toThrow(
        'does not support platform connect',
      );
    });

    it('400s when the platform env app is not configured', async () => {
      await expect(service.platformConnect(ORG, 'telegram')).rejects.toThrow(
        'not configured on this deployment',
      );
    });

    it('stores the discord env credentials, provisions, and captures guild ids', async () => {
      process.env.DISCORD_CLIENT_ID = 'app-1';
      process.env.DISCORD_BOT_TOKEN = 'bot-1';
      process.env.DISCORD_PUBLIC_KEY = 'pk-1';
      const result = await service.platformConnect(ORG, 'discord', 'user-1');
      expect(result).toEqual({
        ok: true,
        test: { ok: true, extra: { botUsername: 'pm_bot' } },
      });
      const call = repository.upsert.mock.calls[0][2];
      expect(call.enabled).toBe(true);
      expect(
        JSON.parse(call.credentials.replace(/^enc:/, '')),
      ).toEqual({ applicationId: 'app-1', botToken: 'bot-1', publicKey: 'pk-1' });
      expect(adapter.provision).toHaveBeenCalled();
      expect(call.extraConfig.provisioned).toBe(true);
      expect(call.extraConfig.guildIds).toEqual(['g-1', 'g-2']);
      expect(safeFetchMock).toHaveBeenCalledWith(
        'https://discord.com/api/v10/users/@me/guilds',
        { headers: { Authorization: 'Bot bot-1' } },
      );
      expect(resolution.invalidate).toHaveBeenCalledWith('comms', 'discord', ORG);
    });

    it('registers the telegram webhook against the platform URL with the derived secret', async () => {
      process.env.TELEGRAM_TOKEN = 'tg-1';
      await service.platformConnect(ORG, 'telegram');
      expect(adapter.registerWebhook).toHaveBeenCalledWith(
        'https://backend.example/webhooks/comms/platform/telegram',
        expect.stringMatching(/^[0-9a-f]{64}$/),
      );
      const call = repository.upsert.mock.calls[0][2];
      expect(call.extraConfig.webhookRegistered).toBe(true);
    });

    it('reuses the pre-minted webhook token of a placeholder row', async () => {
      process.env.TELEGRAM_TOKEN = 'tg-1';
      repository.getByIdentifier.mockResolvedValue({
        id: 'cfg-1',
        identifier: 'telegram',
        version: 'v1',
        webhookToken: 'preminted',
        credentials: null,
        extraConfig: {},
        enabled: false,
      });
      await service.platformConnect(ORG, 'telegram');
      expect(repository.upsert.mock.calls[0][2].webhookToken).toBe('preminted');
    });

    it('400s with the verbatim provider error when the test fails', async () => {
      process.env.TELEGRAM_TOKEN = 'tg-1';
      adapter.testConnection.mockResolvedValue({ ok: false, error: 'Telegram getMe failed: 401 unauthorized' });
      await expect(service.platformConnect(ORG, 'telegram')).rejects.toThrow(
        'Telegram getMe failed: 401 unauthorized',
      );
    });
  });

  describe('slack oauth', () => {
    beforeEach(() => {
      process.env.SLACK_ID = 'slack-client';
      process.env.SLACK_SECRET = 'slack-secret';
      process.env.SLACK_SIGNING_SECRET = 'slack-signing';
    });

    it('builds the authorize url and binds org+user to the state', async () => {
      const { url } = await service.getSlackOAuthUrl(ORG, 'user-1');
      expect(url).toContain('https://slack.com/oauth/v2/authorize?client_id=slack-client');
      expect(url).toContain('scope=chat%3Awrite%2Cim%3Awrite%2Cim%3Ahistory%2Capp_mentions%3Aread');
      expect(url).toContain(
        `redirect_uri=${encodeURIComponent('https://backend.example/settings/comms/oauth/slack/callback')}`,
      );
      const state = new URL(url).searchParams.get('state')!;
      expect(redisStore.get(`comms-oauth:${state}`)).toBe(
        JSON.stringify({ orgId: ORG, userId: 'user-1' }),
      );
    });

    it('400s when the platform slack app is not configured', async () => {
      delete process.env.SLACK_ID;
      await expect(service.getSlackOAuthUrl(ORG, 'user-1')).rejects.toThrow(
        'not configured on this deployment',
      );
    });

    it('exchanges the code, stores bot token + signing secret + teamId, enables', async () => {
      const { url } = await service.getSlackOAuthUrl(ORG, 'user-1');
      const state = new URL(url).searchParams.get('state')!;
      safeFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          access_token: 'xoxb-new',
          team: { id: 'T1' },
        }),
      });
      await service.handleSlackOAuthCallback('code-1', state);
      expect(safeFetchMock).toHaveBeenCalledWith(
        'https://slack.com/api/oauth.v2.access',
        expect.objectContaining({ method: 'POST' }),
      );
      const call = repository.upsert.mock.calls[0][2];
      expect(call.enabled).toBe(true);
      // The mock adapter declares webhookRegistration, so upsert also mints
      // an internal webhookSecret — assert the OAuth-written keys only.
      expect(JSON.parse(call.credentials.replace(/^enc:/, ''))).toMatchObject({
        botToken: 'xoxb-new',
        signingSecret: 'slack-signing',
      });
      expect(call.extraConfig.teamId).toBe('T1');
      expect(audit.record).toHaveBeenCalled();
      // State is single-use.
      expect(redisStore.has(`comms-oauth:${state}`)).toBe(false);
      await expect(service.handleSlackOAuthCallback('code-1', state)).rejects.toThrow(
        'Invalid or expired state',
      );
    });

    it('rejects an unknown state and surfaces slack exchange errors', async () => {
      await expect(
        service.handleSlackOAuthCallback('code-1', 'nope'),
      ).rejects.toThrow('Invalid or expired state');
      const { url } = await service.getSlackOAuthUrl(ORG, 'user-1');
      const state = new URL(url).searchParams.get('state')!;
      safeFetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_code' }),
      });
      await expect(
        service.handleSlackOAuthCallback('bad-code', state),
      ).rejects.toThrow('Slack authorization failed: invalid_code');
    });
  });
});
