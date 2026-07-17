import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '@prisma/client';
import { AuthProviderRepository } from './auth-provider.repository';
import type { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// The repository stores credentials exactly as given — encryption happens in
// the calling layer (AdminController) via EncryptionService. This mock mirrors
// EncryptionService's encrypt/decrypt contract for the round-trip test.
const encryptionServiceMock = {
  encrypt: vi.fn((value: string) => `v2:enc(${value})`),
  decrypt: vi.fn((stored: string) =>
    stored.replace(/^v2:enc\((.*)\)$/, '$1')
  ),
};

interface MockModel {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

describe('AuthProviderRepository', () => {
  let model: MockModel;
  let repository: AuthProviderRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    model = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    };
    const prismaRepo = {
      model: { authProviderConfig: model },
    } as unknown as PrismaRepository<'authProviderConfig'>;
    repository = new AuthProviderRepository(prismaRepo);
  });

  describe('list', () => {
    it('lists configs ordered by provider', async () => {
      const configs = [{ provider: Provider.GITHUB }];
      model.findMany.mockResolvedValue(configs);

      expect(await repository.list()).toBe(configs);
      expect(model.findMany).toHaveBeenCalledWith({
        orderBy: { provider: 'asc' },
      });
    });
  });

  describe('findByProvider', () => {
    it('finds a config by its unique provider', async () => {
      const config = { provider: Provider.GOOGLE, enabled: true };
      model.findUnique.mockResolvedValue(config);

      expect(await repository.findByProvider(Provider.GOOGLE)).toBe(config);
      expect(model.findUnique).toHaveBeenCalledWith({
        where: { provider_version: { provider: Provider.GOOGLE, version: 'v1' } },
      });
    });

    it('returns null for an unconfigured provider', async () => {
      model.findUnique.mockResolvedValue(null);
      expect(await repository.findByProvider(Provider.GITHUB)).toBeNull();
    });
  });

  describe('upsert', () => {
    it('creates with provider + data and updates with data only', async () => {
      const data = { enabled: true, displayName: 'GitHub' };
      model.upsert.mockResolvedValue({ provider: Provider.GITHUB, ...data });

      const result = await repository.upsert(Provider.GITHUB, data);

      expect(model.upsert).toHaveBeenCalledWith({
        where: { provider_version: { provider: Provider.GITHUB, version: 'v1' } },
        create: { provider: Provider.GITHUB, version: 'v1', ...data },
        update: data,
      });
      expect(result).toEqual({ provider: Provider.GITHUB, ...data });
    });

    it('stores encrypted clientId/clientSecret verbatim (encryption round-trip)', async () => {
      const clientId = 'github-client-id';
      const clientSecret = 'github-client-secret';
      const data = {
        clientId: encryptionServiceMock.encrypt(clientId),
        clientSecret: encryptionServiceMock.encrypt(clientSecret),
      };
      model.upsert.mockImplementation(
        ({ create }: { create: Record<string, string> }) => create
      );

      const stored = (await repository.upsert(
        Provider.GITHUB,
        data
      )) as unknown as { clientId: string; clientSecret: string };

      // What reaches the database is ciphertext, never plaintext.
      expect(stored.clientId).not.toBe(clientId);
      expect(stored.clientSecret).not.toBe(clientSecret);
      expect(stored.clientId).toBe('v2:enc(github-client-id)');

      // Decrypting what was stored yields the original values.
      expect(encryptionServiceMock.decrypt(stored.clientId)).toBe(clientId);
      expect(encryptionServiceMock.decrypt(stored.clientSecret)).toBe(
        clientSecret
      );
    });

    it('round-trips OIDC endpoint fields untouched', async () => {
      const data = {
        authUrl: 'https://idp.example.com/auth',
        tokenUrl: 'https://idp.example.com/token',
        userInfoUrl: 'https://idp.example.com/userinfo',
        scopes: 'openid email profile',
      };
      model.upsert.mockResolvedValue({ provider: Provider.GENERIC, ...data });

      await repository.upsert(Provider.GENERIC, data);

      expect(model.upsert).toHaveBeenCalledWith({
        where: { provider_version: { provider: Provider.GENERIC, version: 'v1' } },
        create: { provider: Provider.GENERIC, version: 'v1', ...data },
        update: data,
      });
    });
  });

  describe('delete', () => {
    it('deletes by provider', async () => {
      model.delete.mockResolvedValue({ provider: Provider.GITHUB });

      const result = await repository.delete(Provider.GITHUB);

      expect(model.delete).toHaveBeenCalledWith({
        where: { provider_version: { provider: Provider.GITHUB, version: 'v1' } },
      });
      expect(result).toEqual({ provider: Provider.GITHUB });
    });
  });
});
