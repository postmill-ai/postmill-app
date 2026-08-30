import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSystemSettings = vi.fn();

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    getSystemSettings = mockGetSystemSettings;
  },
}));

vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: vi.fn((val: string) => val),
  },
}));

import { AiSettingsManager } from './ai-settings.manager';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';

const baseSettings = {
  id: 'singleton',
  fallbackProvider: null,
  fallbackImageProvider: null,
  guardrailSettings: null,
  budgetSettings: null,
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
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, fallbackProvider: 'openai@v1' });
      manager = new AiSettingsManager(new (AiSettingsService as any)());
      const result = await manager.getSettings();
      expect(result).toBeDefined();
      expect(result?.fallbackProvider).toBe('openai');
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
        observability: JSON.stringify({ endpoint: 'https://otel.example.com' }),
        mcpSettings: JSON.stringify({ tools: ['tool1'] }),
        ragSettings: JSON.stringify({ enabled: true }),
      });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      const result = await manager.getSettings();
      expect(result?.budgetSettings).toEqual({ monthlyCap: 100, dailyCap: 10 });
      expect(result?.guardrailSettings).toEqual({ enabled: true });
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
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, fallbackProvider: 'openai@v1' });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      let result = await manager.getSettings();
      expect(result?.fallbackProvider).toBe('openai');

      mockGetSystemSettings.mockResolvedValue({ ...baseSettings, fallbackProvider: 'anthropic@v1' });
      await manager.refreshCache();

      result = await manager.getSettings();
      expect(result?.fallbackProvider).toBe('anthropic');
      expect(mockGetSystemSettings).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent refresh calls', async () => {
      mockGetSystemSettings.mockResolvedValue({ ...baseSettings });
      manager = new AiSettingsManager(new (AiSettingsService as any)());

      await Promise.all([manager.refreshCache(), manager.refreshCache(), manager.refreshCache()]);
      expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
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
