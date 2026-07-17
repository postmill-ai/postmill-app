import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderConfigRepository } from './provider-config.repository';

function createMockRepository() {
  const mockProviderConfig = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };

  const mockPrismaRepo = {
    model: {
      providerConfiguration: mockProviderConfig,
    },
  };

  const repository = new ProviderConfigRepository(mockPrismaRepo as any);

  return { repository, mockProviderConfig };
}

describe('ProviderConfigRepository', () => {
  let repository: ProviderConfigRepository;
  let mockProviderConfig: ReturnType<typeof createMockRepository>['mockProviderConfig'];

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createMockRepository();
    repository = created.repository;
    mockProviderConfig = created.mockProviderConfig;
  });

  describe('getAll', () => {
    it('calls findMany with orderBy name asc', async () => {
      const expected = [{ identifier: 'github', name: 'GitHub' }];
      mockProviderConfig.findMany.mockResolvedValue(expected);

      const result = await repository.getAll();

      expect(mockProviderConfig.findMany).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(expected);
    });

    it('returns an empty array when no configurations exist', async () => {
      mockProviderConfig.findMany.mockResolvedValue([]);

      const result = await repository.getAll();

      expect(result).toEqual([]);
    });

    it('returns multiple configurations ordered by name', async () => {
      const configs = [
        { identifier: 'beta', name: 'Beta' },
        { identifier: 'alpha', name: 'Alpha' },
      ];
      mockProviderConfig.findMany.mockResolvedValue(configs);

      const result = await repository.getAll();

      expect(result).toHaveLength(2);
      expect(mockProviderConfig.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getByIdentifier', () => {
    it('calls findUnique with the given identifier', async () => {
      const config = { identifier: 'github', name: 'GitHub' };
      mockProviderConfig.findUnique.mockResolvedValue(config);

      const result = await repository.getByIdentifier('github');

      expect(mockProviderConfig.findUnique).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'github', version: 'v1' } },
      });
      expect(result).toEqual(config);
    });

    it('returns null when identifier does not exist', async () => {
      mockProviderConfig.findUnique.mockResolvedValue(null);

      const result = await repository.getByIdentifier('nonexistent');

      expect(result).toBeNull();
    });

    it('handles identifiers with special characters', async () => {
      const config = { identifier: 'my-app_123', name: 'My App' };
      mockProviderConfig.findUnique.mockResolvedValue(config);

      const result = await repository.getByIdentifier('my-app_123');

      expect(mockProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'my-app_123', version: 'v1' } },
      });
      expect(result).toEqual(config);
    });
  });

  describe('getEnabled', () => {
    it('calls findMany with enabled: true and orderBy name asc', async () => {
      const enabled = [{ identifier: 'github', name: 'GitHub', enabled: true }];
      mockProviderConfig.findMany.mockResolvedValue(enabled);

      const result = await repository.getEnabled();

      expect(mockProviderConfig.findMany).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(enabled);
    });

    it('returns only enabled configurations', async () => {
      const allConfigs = [
        { identifier: 'github', name: 'GitHub', enabled: true },
        { identifier: 'gitlab', name: 'GitLab', enabled: false },
      ];
      mockProviderConfig.findMany.mockResolvedValue(
        allConfigs.filter((c) => c.enabled)
      );

      const result = await repository.getEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('github');
    });

    it('returns empty array when no configurations are enabled', async () => {
      mockProviderConfig.findMany.mockResolvedValue([]);

      const result = await repository.getEnabled();

      expect(result).toEqual([]);
    });
  });

  describe('upsert', () => {
    const baseData = {
      name: 'GitHub',
      enabled: true,
      clientId: 'abc',
      clientSecret: 'secret',
    };

    it('calls upsert with create containing identifier + data and update with data', async () => {
      const upsertResult = { identifier: 'github', ...baseData };
      mockProviderConfig.upsert.mockResolvedValue(upsertResult);

      const result = await repository.upsert('github', baseData);

      expect(mockProviderConfig.upsert).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.upsert).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'github', version: 'v1' } },
        create: { identifier: 'github', version: 'v1', ...baseData },
        update: baseData,
      });
      expect(result).toEqual(upsertResult);
    });

    it('upserts with optional fields omitted', async () => {
      const minimal = { name: 'Minimal', enabled: false };
      mockProviderConfig.upsert.mockResolvedValue({
        identifier: 'min',
        ...minimal,
      });

      const result = await repository.upsert('min', minimal);

      expect(mockProviderConfig.upsert).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'min', version: 'v1' } },
        create: { identifier: 'min', version: 'v1', ...minimal },
        update: minimal,
      });
      expect(result.identifier).toBe('min');
    });

    it('upserts with all optional fields', async () => {
      const full = {
        name: 'Full',
        enabled: true,
        clientId: 'cid',
        clientSecret: 'cs',
        redirectUri: 'https://example.com/callback',
        scopes: 'read,write',
        additionalConfig: '{}',
        setupInstructions: '## Setup',
      };
      mockProviderConfig.upsert.mockResolvedValue({
        identifier: 'full',
        ...full,
      });

      const result = await repository.upsert('full', full);

      expect(mockProviderConfig.upsert).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'full', version: 'v1' } },
        create: { identifier: 'full', version: 'v1', ...full },
        update: full,
      });
      expect(result.scopes).toBe('read,write');
    });
  });

  describe('delete', () => {
    it('calls delete with the given identifier', async () => {
      const deleted = { identifier: 'github', name: 'GitHub' };
      mockProviderConfig.delete.mockResolvedValue(deleted);

      const result = await repository.delete('github');

      expect(mockProviderConfig.delete).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.delete).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'github', version: 'v1' } },
      });
      expect(result).toEqual(deleted);
    });

    it('throws when identifier does not exist', async () => {
      const error = new Error('RecordNotFound');
      mockProviderConfig.delete.mockRejectedValue(error);

      await expect(repository.delete('nonexistent')).rejects.toThrow('RecordNotFound');
    });
  });

  describe('setEnabled', () => {
    it('calls update with enabled: true', async () => {
      const updated = { identifier: 'github', enabled: true };
      mockProviderConfig.update.mockResolvedValue(updated);

      const result = await repository.setEnabled('github', true);

      expect(mockProviderConfig.update).toHaveBeenCalledTimes(1);
      expect(mockProviderConfig.update).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'github', version: 'v1' } },
        data: { enabled: true },
      });
      expect(result).toEqual(updated);
    });

    it('calls update with enabled: false', async () => {
      const updated = { identifier: 'github', enabled: false };
      mockProviderConfig.update.mockResolvedValue(updated);

      const result = await repository.setEnabled('github', false);

      expect(mockProviderConfig.update).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'github', version: 'v1' } },
        data: { enabled: false },
      });
      expect(result.enabled).toBe(false);
    });

    it('throws when identifier does not exist', async () => {
      const error = new Error('RecordNotFound');
      mockProviderConfig.update.mockRejectedValue(error);

      await expect(
        repository.setEnabled('nonexistent', true)
      ).rejects.toThrow('RecordNotFound');
    });
  });
});
