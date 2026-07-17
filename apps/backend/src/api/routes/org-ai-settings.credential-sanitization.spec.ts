import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization } from '@prisma/client';

const aiSvcMock = {
  getActiveProvider: vi.fn(),
  getProviders: vi.fn(),
};

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service', () => ({
  OrgAiSettingsService: class {
    getActiveProvider = aiSvcMock.getActiveProvider;
    getProviders = aiSvcMock.getProviders;
  },
}));

import { OrgAiSettingsController } from './org-ai-settings.controller';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';

const org: Organization = { id: 'org-1' } as any;

function makeController() {
  return new OrgAiSettingsController(
    aiSvcMock as any,
    {
      getProviderConfigSummary: vi.fn(),
    } as unknown as AiDefaultsService,
  ) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrgAiSettingsController — credential sanitization (#53)', () => {
  describe('getConfig', () => {
    it('strips decrypted credentials from the active provider', async () => {
      aiSvcMock.getActiveProvider.mockResolvedValue({
        identifier: 'openai',
        name: 'OpenAI',
        type: 'direct',
        defaultModel: 'gpt-4',
        credentials: {
          apiKey: 'sk-secret-key-12345',
        },
      });
      aiSvcMock.getProviders.mockResolvedValue([]);
      const controller = makeController();
      controller._defaultsService.getProviderConfigSummary = vi.fn().mockResolvedValue({
        active: {
          identifier: 'openai',
          name: 'OpenAI',
          type: 'direct',
          defaultModel: 'gpt-4',
        },
        providers: [],
      });

      const result = await controller.getConfig(org);

      expect(result.active).toBeDefined();
      expect(result.active).not.toHaveProperty('credentials');
      expect(result.active).toHaveProperty('identifier', 'openai');
      expect(result.active).toHaveProperty('name', 'OpenAI');
      expect(result.active).toHaveProperty('defaultModel', 'gpt-4');
    });

    it('handles when no active provider is configured', async () => {
      aiSvcMock.getActiveProvider.mockResolvedValue(null);
      aiSvcMock.getProviders.mockResolvedValue([]);
      const controller = makeController();
      controller._defaultsService.getProviderConfigSummary = vi.fn().mockResolvedValue({
        active: null,
        providers: [],
      });

      const result = await controller.getConfig(org);

      expect(result.active).toBeNull();
      expect(result.providers).toBeDefined();
    });

    it('returns provider list without credentials', async () => {
      aiSvcMock.getActiveProvider.mockResolvedValue(null);
      aiSvcMock.getProviders.mockResolvedValue([
        {
          identifier: 'openai',
          name: 'OpenAI',
          isConfigured: true,
          isActive: false,
        },
        {
          identifier: 'anthropic',
          name: 'Anthropic',
          isConfigured: false,
          isActive: false,
        },
      ]);
      const controller = makeController();
      controller._defaultsService.getProviderConfigSummary = vi.fn().mockResolvedValue({
        active: null,
        providers: [
          {
            identifier: 'openai',
            name: 'OpenAI',
            isConfigured: true,
            isActive: false,
          },
          {
            identifier: 'anthropic',
            name: 'Anthropic',
            isConfigured: false,
            isActive: false,
          },
        ],
      });

      const result = await controller.getConfig(org);

      expect(result.providers).toHaveLength(2);
      expect(result.providers[0]).not.toHaveProperty('credentials');
      expect(
        result.providers.every(
          (p: Record<string, unknown>) => !('credentials' in p),
        ),
      ).toBe(true);
    });

    it('preserves other active provider properties', async () => {
      aiSvcMock.getActiveProvider.mockResolvedValue({
        identifier: 'anthropic',
        name: 'Anthropic',
        type: 'direct',
        capabilities: ['text', 'vision'],
        defaultModel: 'claude-opus',
        imageModel: 'claude-vision',
        credentials: { apiKey: 'super-secret' },
      });
      aiSvcMock.getProviders.mockResolvedValue([]);
      const controller = makeController();
      controller._defaultsService.getProviderConfigSummary = vi.fn().mockResolvedValue({
        active: {
          identifier: 'anthropic',
          name: 'Anthropic',
          type: 'direct',
          capabilities: ['text', 'vision'],
          defaultModel: 'claude-opus',
          imageModel: 'claude-vision',
        },
        providers: [],
      });

      const result = await controller.getConfig(org);

      expect(result.active).toMatchObject({
        identifier: 'anthropic',
        name: 'Anthropic',
        type: 'direct',
        capabilities: ['text', 'vision'],
        defaultModel: 'claude-opus',
        imageModel: 'claude-vision',
      });
    });
  });
});
