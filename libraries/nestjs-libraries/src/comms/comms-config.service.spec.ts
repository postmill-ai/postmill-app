import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsConfigService } from './comms-config.service';
import { CommsConfigRepository } from './comms-config.repository';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';

const ORG = 'org-1';

describe('CommsConfigService', () => {
  let service: CommsConfigService;
  let repository: any;
  let resolution: any;
  let audit: any;
  let adapter: any;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example';
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
});
