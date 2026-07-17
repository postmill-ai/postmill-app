import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSystemSettings = vi.fn();

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    getSystemSettings = mockGetSystemSettings;
  },
}));

vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: vi.fn((val: string) => val),
  },
}));

import { AiSettingsManager } from './ai-settings.manager';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const baseSettings = {
  id: 'singleton',
  activeProvider: 'openai',
  activeModel: 'gpt-4.1',
  scopeModels: null,
  fallbackProvider: null,
  fallbackImageProvider: null,
  guardrailSettings: null,
  budgetSettings: null,
  rateLimitSettings: null,
  observability: null,
  mcpSettings: null,
  ragSettings: null,
  secretSettings: null,
  updatedAt: new Date(),
};

describe('AiSettingsManager', () => {
  let manager: AiSettingsManager;
  let originalEnvKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnvKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    mockGetSystemSettings.mockResolvedValue({ ...baseSettings });
    (AuthService.fixedDecryption as any).mockReturnValue('decrypted-value');
    manager = new AiSettingsManager(new (AiSettingsService as any)());
  });

  afterEach(() => {
    if (originalEnvKey) {
      process.env.OPENAI_API_KEY = originalEnvKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  describe('getSettings', () => {
    it('returns parsed settings from the repository', async () => {
      const result = await manager.getSettings();
      expect(result).toBeDefined();
      expect(result?.activeProvider).toBe('openai');
      expect(result?.activeModel).toBe('gpt-4.1');
      expect(result?.id).toBe('singleton');
    });

    it('returns null when cache is empty (settings not loaded)', async () => {
      mockGetSystemSettings.mockResolvedValue(null);
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      const result = await manager.getSettings();
      expect(result).toBeNull();
    });

    it('parses JSON blob fields into objects', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...baseSettings,
        budgetSettings: JSON.stringify({ monthlyCap: 100, dailyCap: 10 }),
        guardrailSettings: JSON.stringify({ enabled: true }),
        scopeModels: JSON.stringify({ utility: 'gpt-4.1' }),
        rateLimitSettings: JSON.stringify({ rpm: 60 }),
        observability: JSON.stringify({ endpoint: 'https://otel.example.com' }),
        mcpSettings: JSON.stringify({ tools: ['tool1'] }),
        ragSettings: JSON.stringify({ enabled: true }),
      });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      const result = await manager.getSettings();
      expect(result?.budgetSettings).toEqual({ monthlyCap: 100, dailyCap: 10 });
      expect(result?.guardrailSettings).toEqual({ enabled: true });
      expect(result?.scopeModels).toEqual({ utility: 'gpt-4.1' });
      expect(result?.rateLimitSettings).toEqual({ rpm: 60 });
      expect(result?.observability).toEqual({ endpoint: 'https://otel.example.com' });
      expect(result?.mcpSettings).toEqual({ tools: ['tool1'] });
      expect(result?.ragSettings).toEqual({ enabled: true });
    });

    it('handles malformed JSON blob fields gracefully (leaves as string)', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...baseSettings,
        budgetSettings: 'not-valid-json',
        guardrailSettings: '{broken',
      });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      const result = await manager.getSettings();
      expect(typeof result?.budgetSettings).toBe('string');
      expect(result?.budgetSettings).toBe('not-valid-json');
      expect(typeof result?.guardrailSettings).toBe('string');
      expect(result?.guardrailSettings).toBe('{broken');
    });

    it('decrypts secretSettings when present', async () => {
      (AuthService.fixedDecryption as any).mockReturnValue('{"apiKey":"decrypted-key"}');

      mockGetSystemSettings.mockResolvedValue({
        ...baseSettings,
        secretSettings: 'encrypted-secret-data',
      });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      const result = await manager.getSettings();
      expect(result?.secretSettings).toEqual({ apiKey: 'decrypted-key' });
      expect(AuthService.fixedDecryption).toHaveBeenCalledWith('encrypted-secret-data');
    });

    it('handles decryption failure gracefully (sets undefined)', async () => {
      (AuthService.fixedDecryption as any).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      mockGetSystemSettings.mockResolvedValue({
        ...baseSettings,
        secretSettings: 'bad-data',
      });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      const result = await manager.getSettings();
      expect(result?.secretSettings).toBeUndefined();
    });
  });

  describe('refreshCache', () => {
    it('invalidates and reloads the cache', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: 'openai' });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      let result = await manager.getSettings();
      expect(result?.activeProvider).toBe('openai');

      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: 'anthropic' });
      await manager.refreshCache();

      result = await manager.getSettings();
      expect(result?.activeProvider).toBe('anthropic');
      expect(mockGetSystemSettings).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent refresh calls', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      await Promise.all([manager.refreshCache(), manager.refreshCache(), manager.refreshCache()]);
      expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasActiveConfig', () => {
    it('returns false when cache is not loaded', () => {
      expect(manager.hasActiveConfig()).toBe(false);
    });

    it('returns false when only env var is set (no env fallback)', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: null });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      await manager.getSettings();
      expect(manager.hasActiveConfig()).toBe(false);
    });

    it('returns false when no active provider and no env key', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: null });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      await manager.getSettings();
      expect(manager.hasActiveConfig()).toBe(false);
    });

    it('returns true when activeProvider is set', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: 'openai' });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      await manager.getSettings();
      expect(manager.hasActiveConfig()).toBe(true);
    });
  });

  describe('hasActiveConfigAsync', () => {
    it('returns true when active provider is set', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: 'openai' });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      const result = await manager.hasActiveConfigAsync();
      expect(result).toBe(true);
    });

    it('returns false when only env var is set (no env fallback)', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: null });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      const result = await manager.hasActiveConfigAsync();
      expect(result).toBe(false);
    });

    it('returns false when no active provider and no env key', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, activeProvider: null });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      const result = await manager.hasActiveConfigAsync();
      expect(result).toBe(false);
    });

    it('triggers a cache refresh when stale', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      await manager.hasActiveConfigAsync();
      expect(mockGetSystemSettings).toHaveBeenCalled();
    });
  });

  describe('ensureFresh', () => {
    it('refreshes cache when stale', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      await manager.getSettings();
      const initialCallCount = mockGetSystemSettings.mock.calls.length;

      await manager.refreshCache();
      expect(mockGetSystemSettings.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
