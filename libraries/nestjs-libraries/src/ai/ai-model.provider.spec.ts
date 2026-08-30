import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIModelProvider } from './ai-model.provider';
import { BadRequestException } from '@nestjs/common';
import { BudgetExceeded, GuardrailViolation } from './governance/errors';
import { createChaosEngine, createStandardInjectors, TimeoutInjector } from '@reaatech/agent-chaos-core';

// AI SDK V2 result shape: text lives in a `content` array of parts, and usage uses
// `inputTokens`/`outputTokens` (NOT the V1 `text` / `promptTokens` / `completionTokens`).
const mockDoGenerate = vi.fn().mockImplementation(async (opts: any) => {
  const lastMsg = opts?.prompt?.at(-1)?.content?.[0]?.text || '';
  let text = 'Generated response';
  if (lastMsg.includes('Extract data') || lastMsg.includes('JSON') || lastMsg.includes('json')) {
    text = '{"title": "test"}';
  }
  return {
    content: [{ type: 'text', text }],
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  };
});
const mockLanguageModel = { modelId: 'gpt-4.1', doGenerate: mockDoGenerate };

// The legacy AIProviderRegistry was deleted; the facade now resolves adapters through
// ProviderResolutionService.resolveAI(id). Mock it with the same per-id adapter logic.
vi.mock('@postmill-ai/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: class {
    resolveAI = vi.fn().mockImplementation((id: string) => {
      if (id === 'openai') {
        return {
          identifier: 'openai',
          name: 'OpenAI',
          type: 'direct' as const,
          credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
          capabilities: { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true },
          listModels: vi.fn().mockResolvedValue([]),
          validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
          createLanguageModel: vi.fn().mockReturnValue(mockLanguageModel),
          createLangchainModel: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ usage_metadata: { input_tokens: 5, output_tokens: 7 } }),
          }),
          createImageModel: vi.fn().mockReturnValue({ doGenerate: vi.fn().mockResolvedValue({ images: ['b64-image-data'] }) }),
          createEmbeddingModel: vi.fn().mockReturnValue({}),
          createSpeechModel: vi.fn().mockReturnValue({}),
        };
      }
      return undefined;
    });
  },
}));

// Minimal ProviderKernel stub — the facade only calls listManifests('ai') for an error message.
const mockKernel = { listManifests: vi.fn().mockReturnValue([]) };

const mockGetActiveProvider = vi.fn().mockResolvedValue({
  identifier: 'openai',
  defaultModel: 'gpt-4.1',
  imageModel: undefined,
  credentials: { apiKey: 'sk-test-key' },
});

const mockGetByIdentifier = vi.fn().mockResolvedValue(null);

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service', () => ({
  OrgAiSettingsService: class MockOrgAiSettings {
    getActiveProvider = mockGetActiveProvider;
    getByIdentifier = mockGetByIdentifier;
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/defaults/defaults-resolution.service', () => ({
  DefaultsResolutionService: class MockDefaultsResolutionService {
    resolve = vi.fn().mockResolvedValue(null);
    resolveAll = vi.fn().mockResolvedValue({});
    candidates = vi.fn().mockResolvedValue([]);
  },
}));

const mockSpendLogData: any[] = [];
vi.mock('@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    getOrgProviderConfigs = vi.fn().mockResolvedValue([]);
    getSystemSettings = vi.fn().mockResolvedValue(null);
    getBrandProfile = vi.fn().mockResolvedValue(null);
    getPromptTemplates = vi.fn().mockResolvedValue([]);
    createSpendLog = vi.fn().mockImplementation((data: any) => { mockSpendLogData.push(data); });
    upsertBrandProfile = vi.fn();
  },
}));

const mockSettings = {
  id: 'singleton',
  secretSettings: null,
  fallbackProvider: null,
  fallbackImageProvider: null,
  guardrailSettings: null,
  budgetSettings: null,
  observability: null,
  mcpSettings: null,
  ragSettings: null,
};

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class MockManager {
    getSettings = vi.fn().mockResolvedValue(mockSettings);
    refreshCache = vi.fn();
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/telemetry.service', () => ({
  TelemetryService: class MockTelemetry {
    configure = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    startSpan = vi.fn().mockImplementation((_name: string, fn: Function, _attrs?: any) => fn({ end: vi.fn(), setStatus: vi.fn(), setAttribute: vi.fn() }));
    static ATTR_GEN_AI_SYSTEM = 'gen_ai.system';
    static ATTR_GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/provider-health.service', () => ({
  ProviderHealthService: class MockHealth {
    recordSuccess = vi.fn();
    recordError = vi.fn();
    getHealth = vi.fn();
    getAllHealth = vi.fn().mockReturnValue({});
    isUnhealthy = vi.fn().mockReturnValue(false);
  },
}));

let budgetAllowed = true;
vi.mock('@postmill-ai/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class MockBudget {
    checkBudget = vi.fn().mockImplementation(async () => ({ allowed: budgetAllowed }));
    recordSpend = vi.fn();
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/guardrail.service', () => ({
  GuardrailService: class MockGuardrail {
    checkInput = vi.fn().mockImplementation(async (text: string) => text);
    checkOutput = vi.fn().mockImplementation(async (text: string) => text);
  },
}));

import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { OrgAiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';

import { DefaultsResolutionService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { AiSettingsManager } from './ai-settings.manager';
import { TelemetryService } from './governance/telemetry.service';
import { ProviderHealthService } from './governance/provider-health.service';
import { BudgetService } from './governance/budget.service';
import { GuardrailService } from './governance/guardrail.service';

vi.mock('@postmill-ai/nestjs-libraries/brands/brands.service', () => ({
  BrandsService: class MockBrands {
    getBrand = vi.fn().mockResolvedValue(null);
    getDefaultBrand = vi.fn().mockResolvedValue(null);
  },
}));

import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';

describe('AIModelProvider', () => {
  let provider: AIModelProvider;
  let resolution: ProviderResolutionService;
  let aiSettings: AiSettingsService;
  let orgAiSettings: OrgAiSettingsService;
  let settingsManager: AiSettingsManager;
  let telemetry: TelemetryService;
  let health: ProviderHealthService;
  let budget: BudgetService;
  let guardrails: GuardrailService;
  let brandsService: BrandsService;
  let defaultsResolution: DefaultsResolutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    budgetAllowed = true;

    mockGetActiveProvider.mockResolvedValue({
      identifier: 'openai',
      defaultModel: 'gpt-4.1',
      imageModel: undefined,
      credentials: { apiKey: 'sk-test-key' },
    });
    mockGetByIdentifier.mockResolvedValue(null);

    resolution = new (ProviderResolutionService as any)();
    aiSettings = new (AiSettingsService as any)();
    orgAiSettings = new (OrgAiSettingsService as any)();
    settingsManager = new (AiSettingsManager as any)();
    telemetry = new (TelemetryService as any)();
    health = new (ProviderHealthService as any)();
    budget = new (BudgetService as any)();
    guardrails = new (GuardrailService as any)();
    brandsService = new (BrandsService as unknown as new () => BrandsService)();
    defaultsResolution = new (DefaultsResolutionService as any)();

    provider = new AIModelProvider(
      aiSettings as any,
      orgAiSettings as any,
      settingsManager as any,
      telemetry as any,
      health as any,
      budget as any,
      guardrails as any,
      brandsService,
      resolution as any,
      defaultsResolution as any,
      mockKernel as any,
    );
  });

  describe('getSurfaceDefaults', () => {
    it('returns defaults for utility scope', () => {
      const defaults = provider.getSurfaceDefaults('utility');
      expect(defaults.textModel).toBe('gpt-4.1');
      expect(defaults.imageModel).toBe('chatgpt-image-latest');
    });

    it('returns defaults for generator scope with temperature', () => {
      const defaults = provider.getSurfaceDefaults('generator');
      expect(defaults.textModel).toBe('gpt-4.1');
      expect(defaults.imageModel).toBe('chatgpt-image-latest');
      expect(defaults.temperature).toBe(0.7);
    });

    it('returns defaults for agent scope', () => {
      const defaults = provider.getSurfaceDefaults('agent');
      expect(defaults.textModel).toBe('gpt-5.2');
    });

    it('returns defaults for mcp scope', () => {
      const defaults = provider.getSurfaceDefaults('mcp');
      expect(defaults.textModel).toBe('gpt-4.1');
    });
  });

  describe('_imageFilePart', () => {
    const part = (url: string) => (provider as any)._imageFilePart(url);

    it('derives the media type from a recognizable URL extension', () => {
      expect(part('https://cdn.example.com/hero.jpg').mediaType).toBe('image/jpeg');
      expect(part('https://cdn.example.com/hero.jpeg?w=100').mediaType).toBe('image/jpeg');
      expect(part('https://cdn.example.com/hero.webp').mediaType).toBe('image/webp');
      expect(part('https://cdn.example.com/hero.gif#x').mediaType).toBe('image/gif');
      expect(part('https://cdn.example.com/hero.png').mediaType).toBe('image/png');
    });

    it('keeps image/png for extensionless or unrecognized URLs', () => {
      expect(part('https://cdn.example.com/hero').mediaType).toBe('image/png');
      expect(part('https://cdn.example.com/hero.bmp').mediaType).toBe('image/png');
      expect(part('https://cdn.example.com/download?format=jpg').mediaType).toBe('image/png');
    });

    it('keeps the data-URI and bare-base64 branches untouched', () => {
      const uri = part('data:image/jpeg;base64,AAA BBB');
      expect(uri.mediaType).toBe('image/jpeg');
      expect(uri.data).toBe('AAABBB');
      expect(part('QUJD').mediaType).toBe('image/png');
    });
  });

  describe('_enforceContextWindow', () => {
    // 40k chars ≈ 10k tokens: over the 8000-token unknown-model default, well
    // under gpt-4o's 128000.
    const prompt = 'x'.repeat(40000);

    it('resolves hub-prefixed model IDs via the unprefixed tail', () => {
      expect((provider as any)._enforceContextWindow(prompt, 'openai/gpt-4o')).toBe(prompt);
    });

    it('keeps the exact-table lookup for unprefixed IDs', () => {
      expect((provider as any)._enforceContextWindow(prompt, 'gpt-4o')).toBe(prompt);
    });

    it('still truncates unknown models at the 8000-token default', () => {
      expect((provider as any)._enforceContextWindow(prompt, 'unknown-model')).not.toBe(prompt);
    });
  });

  describe('languageModel', () => {
    it('returns a language model when config is active', async () => {
      const model = await provider.languageModel('utility', 'org-123');
      expect(model).toBeDefined();
    });

    it('returns null from resolveConfigForScope when no orgId and no OPENAI_API_KEY', async () => {
      const prev = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const resolved = await provider.resolveConfigForScope('utility');
        expect(resolved).toBeNull();
      } finally {
        if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
      }
    });

    it('returns null (AI off) when the org has no active provider — env OPENAI_API_KEY is NOT used (v3.6.3)', async () => {
      // No per-org provider means AI is off for that tenant. A deployment's env
      // OPENAI_API_KEY must never be silently used as the tenant's AI.
      mockGetActiveProvider.mockResolvedValue(null);
      const prev = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-env-key';
      try {
        const resolved = await provider.resolveConfigForScope('utility', 'org-123');
        expect(resolved).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prev;
      }
    });

    it('returns the resolved config with active provider credentials', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4.1',
        credentials: { apiKey: 'sk-org-key' },
      });

      const resolved = await provider.resolveConfigForScope('utility', 'org-123');

      expect(resolved?.providerId).toBe('openai');
      expect(resolved?.modelId).toBe('gpt-4.1');
      expect(resolved?.creds.apiKey).toBe('sk-org-key');
    });

    it('returns the active provider config with its credentials and model', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4o-mini',
        credentials: { apiKey: 'sk-org-key' },
      });

      const resolved = await provider.resolveConfigForScope('utility', 'org-123');

      expect(resolved?.creds.apiKey).toBe('sk-org-key');
      expect(resolved?.modelId).toBe('gpt-4o-mini');
    });

    it('returns the active provider when it differs from the surface default', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'anthropic',
        defaultModel: 'claude-sonnet-4-20250514',
        credentials: { apiKey: 'sk-anthropic' },
      });
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') return mockOpenaiAdapter;
        if (id === 'anthropic') {
          return {
            identifier: 'anthropic',
            name: 'Anthropic',
            credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
            capabilities: { text: true, image: false },
            createLanguageModel: vi.fn().mockReturnValue({ modelId: 'claude-sonnet', doGenerate: vi.fn() }),
            createLangchainModel: vi.fn(),
          };
        }
        return undefined;
      });

      const resolved = await provider.resolveConfigForScope('utility', 'org-123');

      expect(resolved?.providerId).toBe('anthropic');
      expect(resolved?.creds.apiKey).toBe('sk-anthropic');
      expect(resolved?.modelId).toBe('claude-sonnet-4-20250514');
    });

    it('does not merge governance settings into provider credentials', async () => {
      (settingsManager.getSettings as any).mockResolvedValue({
        ...mockSettings,
        secretSettings: {
          qdrantApiKey: 'qdrant-secret',
          otelHeaders: '{"authorization":"Bearer otel"}',
        },
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4.1',
        credentials: { apiKey: 'sk-org-key' },
      });

      const resolved = await provider.resolveConfigForScope('utility', 'org-123');

      expect(resolved?.creds).toEqual({ apiKey: 'sk-org-key' });
    });
  });

  describe('langchainModel', () => {
    it('returns a langchain model', async () => {
      const model = await provider.langchainModel('generator', 'org-123');
      expect(model).toBeDefined();
    });

    it('records usage after invoke via the budget wrapper', async () => {
      (budget.recordSpend as any).mockClear();
      const model = await provider.langchainModel('utility', 'org-123');
      const result = await model.invoke([{ role: 'user', content: 'hi' }]);
      expect(result).toBeDefined();
      expect(budget.checkBudget).toHaveBeenCalledWith('utility', 'org-123', 'openai');
      expect(budget.recordSpend).toHaveBeenCalledTimes(1);
      const spend = (budget.recordSpend as any).mock.calls[0][0];
      expect(spend.inputTokens).toBe(5);
      expect(spend.outputTokens).toBe(7);
      expect(spend.provider).toBe('openai');
      expect(spend.model).toBe('gpt-4.1');
      expect(spend.scope).toBe('utility');
    });
  });

  describe('imageModel', () => {
    it('returns a model with a generate method', async () => {
      const model = await provider.imageModel('utility', 'org-123');
      const result = await model.generate('test prompt');
      expect(typeof result).toBe('string');
    });

    it('uses the fallback image provider image model instead of the primary text model', async () => {
      const createFallbackImageModel = vi.fn().mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ images: ['fallback-image'] }),
      });
      const primaryAdapter = {
        identifier: 'anthropic',
        name: 'Anthropic',
        credentialFields: [{ key: 'apiKey' }],
        createLanguageModel: vi.fn(),
        createLangchainModel: vi.fn(),
      };
      const fallbackAdapter = {
        identifier: 'openai',
        name: 'OpenAI',
        credentialFields: [{ key: 'apiKey' }],
        createImageModel: createFallbackImageModel,
      };

      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'anthropic') return primaryAdapter;
        if (id === 'openai') return fallbackAdapter;
        return undefined;
      });
      (settingsManager.getSettings as any).mockResolvedValue({
        ...mockSettings,
        fallbackImageProvider: 'openai',
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'anthropic',
        defaultModel: 'claude-sonnet-4-20250514',
        credentials: { apiKey: 'sk-anthropic' },
      });
      // The fallback provider differs from the active one → its own org config
      // supplies the credentials; the model is the surface image default (the
      // active provider's text defaultModel must NOT leak across providers).
      mockGetByIdentifier.mockImplementation((_orgId: string, id: string) =>
        id === 'openai'
          ? { credentials: { apiKey: 'sk-openai-own' }, defaultModel: 'gpt-4o' }
          : null,
      );

      const model = await provider.imageModel('utility', 'org-123');
      const result = await model.generate('test prompt');

      expect(result).toBe('fallback-image');
      expect(createFallbackImageModel).toHaveBeenCalledWith(
        { apiKey: 'sk-openai-own' },
        'chatgpt-image-latest',
      );
    });

    it('uses the org-resolved text-to-image media default when it belongs to the active provider', async () => {
      const createGatewayImageModel = vi.fn().mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ images: ['hub-image'] }),
      });
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'gateway') {
          return {
            identifier: 'gateway',
            name: 'Vercel AI',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: vi.fn(),
            createImageModel: createGatewayImageModel,
          };
        }
        return undefined;
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'gateway',
        defaultModel: 'openai/gpt-4o',
        credentials: { apiKey: 'gw-key' },
      });
      (defaultsResolution.resolve as any).mockImplementation((domain: string, category: string) =>
        domain === 'media' && category === 'text-to-image'
          ? { providerId: 'gateway', version: 'v1', model: 'openai/gpt-image-1', source: 'stored' }
          : null,
      );

      const model = await provider.imageModel('utility', 'org-123');
      const result = await model.generate('test prompt');

      expect(result).toBe('hub-image');
      // Not the hardcoded surface default — the hub's own resolved image model.
      expect(createGatewayImageModel).toHaveBeenCalledWith(
        { apiKey: 'gw-key' },
        'openai/gpt-image-1',
      );
    });

    it('ignores a text-to-image media default owned by a different provider', async () => {
      const createGatewayImageModel = vi.fn().mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ images: ['hub-image'] }),
      });
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'gateway') {
          return {
            identifier: 'gateway',
            name: 'Vercel AI',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: vi.fn(),
            createImageModel: createGatewayImageModel,
          };
        }
        return undefined;
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'gateway',
        defaultModel: 'openai/gpt-4o',
        credentials: { apiKey: 'gw-key' },
      });
      // Replicate owns the media default — its model ID is foreign to the
      // gateway adapter, so the surface default applies instead.
      (defaultsResolution.resolve as any).mockImplementation((domain: string, category: string) =>
        domain === 'media' && category === 'text-to-image'
          ? { providerId: 'replicate', version: 'v1', model: 'black-forest-labs/flux-schnell', source: 'stored' }
          : null,
      );

      const model = await provider.imageModel('utility', 'org-123');
      await model.generate('test prompt');

      expect(createGatewayImageModel).toHaveBeenCalledWith(
        { apiKey: 'gw-key' },
        'chatgpt-image-latest',
      );
    });
  });

  describe('generateText', () => {
    it('generates text via the resolved model', async () => {
      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBeDefined();
    });

    it('extracts text from the V2 content[] array (not a top-level result.text)', async () => {
      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('Generated response');
    });

    it('records usage/cost from V2 inputTokens/outputTokens', async () => {
      (budget.recordSpend as any).mockClear();
      await provider.generateText('utility', 'Hello world', { orgId: 'org-123', userId: 'user-1' });
      expect(budget.recordSpend).toHaveBeenCalledTimes(1);
      const spend = (budget.recordSpend as any).mock.calls[0][0];
      // mockDoGenerate returns usage: { inputTokens: 10, outputTokens: 20 }
      expect(spend.inputTokens).toBe(10);
      expect(spend.outputTokens).toBe(20);
      expect(spend.costUsd).toBeGreaterThan(0);
    });

    it('normalizes AI SDK v6 object-shaped usage ({inputTokens: {total}}) to plain ints', async () => {
      (budget.recordSpend as any).mockClear();
      mockDoGenerate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Generated response' }],
        usage: {
          inputTokens: { total: 191, noCache: 191, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 9, text: 9, reasoning: 0 },
        },
        finishReason: 'stop',
      });
      await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(budget.recordSpend).toHaveBeenCalledTimes(1);
      const spend = (budget.recordSpend as any).mock.calls[0][0];
      expect(spend.inputTokens).toBe(191);
      expect(spend.outputTokens).toBe(9);
      expect(Number.isFinite(spend.costUsd)).toBe(true);
    });

    it('does not fail the generation when recordSpend throws', async () => {
      (budget.recordSpend as any).mockClear();
      (budget.recordSpend as any).mockRejectedValueOnce(new Error('Prisma validation'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('Generated response');
      warn.mockRestore();
    });

    it('uses the fallback provider default model when the primary model belongs to another provider', async () => {
      const primaryModel = {
        doGenerate: vi.fn().mockRejectedValue(new Error('primary provider failed')),
      };
      // Intentionally V1-shaped (top-level `text`, V1 usage keys) to prove the facade still
      // tolerates older/V1 adapters via the _extractText guard and the V1 usage fallback.
      const fallbackModel = {
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Fallback response',
          usage: { promptTokens: 1, completionTokens: 1 },
        }),
      };
      const createFallbackLanguageModel = vi.fn().mockReturnValue(fallbackModel);

      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'anthropic') {
          return {
            identifier: 'anthropic',
            name: 'Anthropic',
            credentialFields: [{ key: 'apiKey' }],
            createLanguageModel: vi.fn().mockReturnValue(primaryModel),
            createLangchainModel: vi.fn(),
          };
        }
        if (id === 'openai') {
          return {
            identifier: 'openai',
            name: 'OpenAI',
            credentialFields: [{ key: 'apiKey' }],
            createLanguageModel: createFallbackLanguageModel,
            createLangchainModel: vi.fn(),
          };
        }
        return undefined;
      });
      (settingsManager.getSettings as any).mockResolvedValue({
        ...mockSettings,
        fallbackProvider: 'openai',
      });
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'anthropic',
        defaultModel: 'claude-sonnet-4-20250514',
        credentials: { apiKey: 'sk-anthropic' },
      });
      // Fallback provider differs from the active one → the fallback's OWN org
      // config supplies credentials and the default model (not anthropic's).
      mockGetByIdentifier.mockImplementation((_orgId: string, id: string) =>
        id === 'openai'
          ? { credentials: { apiKey: 'sk-openai-own' }, defaultModel: 'gpt-4o-mini' }
          : null,
      );

      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });

      expect(result).toBe('Fallback response');
      expect(createFallbackLanguageModel).toHaveBeenCalledWith(
        { apiKey: 'sk-openai-own' },
        'gpt-4o-mini',
        expect.any(Object),
      );
    });

    it('rejects when budget is exceeded', async () => {
      budgetAllowed = false;
      await expect(
        provider.generateText('utility', 'Hello', { orgId: 'org-123' })
      ).rejects.toThrow(BudgetExceeded);
    });
  });

  describe('cross-provider fallback credentials', () => {
    const failingGatewayModel = {
      doGenerate: vi.fn().mockRejectedValue(new Error('gateway down')),
    };

    function wireHubPrimaryWithOpenaiFallback() {
      const createOpenaiLanguageModel = vi.fn().mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'OpenAI fallback response' }],
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      });
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'gateway') {
          return {
            identifier: 'gateway',
            name: 'Vercel AI',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: vi.fn().mockReturnValue(failingGatewayModel),
            createLangchainModel: vi.fn(),
          };
        }
        if (id === 'openai') {
          return {
            identifier: 'openai',
            name: 'OpenAI',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: createOpenaiLanguageModel,
            createLangchainModel: vi.fn(),
          };
        }
        return undefined;
      });
      (settingsManager.getSettings as any).mockResolvedValue({
        ...mockSettings,
        fallbackProvider: 'openai',
      });
      return createOpenaiLanguageModel;
    }

    it('fetches the fallback provider\'s own credentials when it differs from the active provider', async () => {
      const createOpenaiLanguageModel = wireHubPrimaryWithOpenaiFallback();
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'gateway',
        defaultModel: 'openai/gpt-4o',
        credentials: { apiKey: 'gw-key' },
      });
      mockGetByIdentifier.mockImplementation((_orgId: string, id: string) =>
        id === 'openai'
          ? { credentials: { apiKey: 'sk-openai-own' }, defaultModel: 'gpt-4o-mini' }
          : null,
      );

      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });

      expect(result).toBe('OpenAI fallback response');
      // Not the gateway key — cross-provider reuse is a guaranteed 401, and the
      // active provider's hub-prefixed defaultModel is foreign to the fallback.
      expect(createOpenaiLanguageModel).toHaveBeenCalledWith(
        { apiKey: 'sk-openai-own' },
        'gpt-4o-mini',
        expect.any(Object),
      );
    });

    it('reuses the active provider credentials when the active provider IS the fallback', async () => {
      const createOpenaiLanguageModel = wireHubPrimaryWithOpenaiFallback();
      // The scope default resolves to gateway while the org's ACTIVE provider is
      // openai — fallback "openai" === active provider, so its creds/defaultModel
      // are reused without a per-identifier config fetch.
      (defaultsResolution.resolve as any).mockImplementation((_domain: string, category: string) =>
        category === 'low-reasoning'
          ? { providerId: 'gateway', version: 'v1', model: 'openai/gpt-4o', source: 'stored' }
          : null,
      );
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4.1',
        credentials: { apiKey: 'sk-org-key' },
      });
      mockGetByIdentifier.mockImplementation((_orgId: string, id: string) =>
        id === 'gateway' ? { credentials: { apiKey: 'gw-key' } } : null,
      );

      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });

      expect(result).toBe('OpenAI fallback response');
      expect(createOpenaiLanguageModel).toHaveBeenCalledWith(
        { apiKey: 'sk-org-key' },
        'gpt-4.1',
        expect.any(Object),
      );
      expect(mockGetByIdentifier).not.toHaveBeenCalledWith('org-123', 'openai', expect.anything());
    });
  });

  describe('generateObject', () => {
    it('generates structured output via the resolved model', async () => {
      const result = await provider.generateObject<any>(
        'utility',
        'Extract data',
        { title: 'test' },
        { orgId: 'org-123' },
      );
      expect(result).toBeDefined();
    });

    it('parses JSON extracted from the V2 content[] array', async () => {
      const result = await provider.generateObject<any>(
        'utility',
        'Extract data',
        { title: 'test' },
        { orgId: 'org-123' },
      );
      // mockDoGenerate returns content:[{type:'text', text:'{"title":"test"}'}] for JSON prompts
      expect(result).toEqual({ title: 'test' });
    });
  });

  describe('abort signal threading', () => {
    it('generateText passes options.signal as abortSignal to doGenerate', async () => {
      mockDoGenerate.mockClear();
      const controller = new AbortController();

      await provider.generateText('utility', 'Hello world', {
        orgId: 'org-123',
        signal: controller.signal,
      });

      expect(mockDoGenerate.mock.calls.at(-1)![0].abortSignal).toBe(controller.signal);
    });

    it('generateObject passes options.signal as abortSignal to doGenerate', async () => {
      mockDoGenerate.mockClear();
      const controller = new AbortController();

      await provider.generateObject<any>(
        'utility',
        'Extract data',
        { title: 'test' },
        { orgId: 'org-123', signal: controller.signal },
      );

      expect(mockDoGenerate.mock.calls.at(-1)![0].abortSignal).toBe(controller.signal);
    });

    it('generateTextWithModel passes args.signal as abortSignal to doGenerate', async () => {
      mockDoGenerate.mockClear();
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      const controller = new AbortController();

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'Hello',
        signal: controller.signal,
      });

      expect(mockDoGenerate.mock.calls.at(-1)![0].abortSignal).toBe(controller.signal);
    });

    it('generateObjectWithModel passes args.signal as abortSignal to doGenerate', async () => {
      mockDoGenerate.mockClear();
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      mockDoGenerate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"title": "test"}' }],
        usage: { inputTokens: 10, outputTokens: 20 },
        finishReason: 'stop',
      });
      const controller = new AbortController();

      await provider.generateObjectWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'Extract data',
        signal: controller.signal,
      });

      expect(mockDoGenerate.mock.calls.at(-1)![0].abortSignal).toBe(controller.signal);
    });
  });

  describe('semantic cache + routing (opt-in, off by default)', () => {
    function makeCache(over: Partial<{ get: any; set: any; setModelProvider: any }> = {}) {
      return {
        get: over.get ?? vi.fn().mockResolvedValue(null),
        set: over.set ?? vi.fn().mockResolvedValue(undefined),
        setModelProvider: over.setModelProvider ?? vi.fn(),
      };
    }
    function makeRouter(modelId?: string) {
      return {
        resolveModel: vi.fn().mockResolvedValue({
          modelId: modelId ?? 'gpt-4.1',
          routed: !!modelId,
          blocked: false,
        }),
      };
    }
    function makeProvider(cache?: any, router?: any) {
      return new AIModelProvider(
        aiSettings as any,
        orgAiSettings as any,
        settingsManager as any,
        telemetry as any,
        health as any,
        budget as any,
        guardrails as any,
        brandsService,
        resolution as any,
        defaultsResolution as any,
        mockKernel as any,
        cache,
        router,
      );
    }

    it('default-off: no cache services injected ⇒ model is still called, behavior unchanged', async () => {
      mockDoGenerate.mockClear();
      const result = await provider.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('Generated response');
      expect(mockDoGenerate).toHaveBeenCalledTimes(1);
    });

    it('wires the embedding tier on construction via setModelProvider', () => {
      const cache = makeCache();
      makeProvider(cache, makeRouter());
      expect(cache.setModelProvider).toHaveBeenCalledTimes(1);
    });

    it('cache hit returns the cached value WITHOUT calling the model', async () => {
      mockDoGenerate.mockClear();
      const cache = makeCache({ get: vi.fn().mockResolvedValue('cached!') });
      const p = makeProvider(cache, makeRouter());
      const result = await p.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('cached!');
      expect(mockDoGenerate).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('cache miss populates the cache after a successful generation', async () => {
      mockDoGenerate.mockClear();
      const cache = makeCache();
      const p = makeProvider(cache, makeRouter());
      const result = await p.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('Generated response');
      expect(mockDoGenerate).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledTimes(1);
      // the cache.set call is scoped per org + scope
      const [orgId, scope] = cache.set.mock.calls[0];
      expect(orgId).toBe('org-123');
      expect(scope).toBe('utility');
    });

    it('uses distinct org ids in cache keys for different orgs (no cross-org collision)', async () => {
      const getA = vi.fn().mockResolvedValue(null);
      const cache = makeCache({ get: getA });
      const p = makeProvider(cache, makeRouter());
      await p.generateText('utility', 'same prompt', { orgId: 'org-A' });
      await p.generateText('utility', 'same prompt', { orgId: 'org-B' });
      const orgsQueried = getA.mock.calls.map((c: any[]) => c[0]);
      expect(orgsQueried).toContain('org-A');
      expect(orgsQueried).toContain('org-B');
    });

    it('routing-off: configured model resolves unchanged even with a router present', async () => {
      const router = makeRouter(); // returns same gpt-4.1, routed:false
      const p = makeProvider(makeCache(), router);
      const resolved = await p.resolveConfigForScope('utility', 'org-123');
      expect(resolved?.modelId).toBe('gpt-4.1');
    });

    it('routing-on: router selects a different model id', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4.1',
        credentials: { apiKey: 'sk-x' },
      });
      const router = makeRouter('gpt-4o-mini');
      const p = makeProvider(makeCache(), router);
      const resolved = await p.resolveConfigForScope('utility', 'org-123');
      expect(router.resolveModel).toHaveBeenCalled();
      expect(resolved?.modelId).toBe('gpt-4o-mini');
    });

    it('embedding tier degrades to prompt-hash when embeddings unavailable', async () => {
      // The mock adapter returns an embedding model without a usable doEmbed, so the cache's
      // semantic tier can't compute vectors and silently degrades to prompt-hash only.
      const cache = makeCache();
      const p = makeProvider(cache, makeRouter());
      const result = await p.generateText('utility', 'Hello world', { orgId: 'org-123' });
      expect(result).toBe('Generated response');
      // prompt-hash tier still populates after generation.
      expect(cache.set).toHaveBeenCalled();
    });
  });

  describe('resilience (agent-chaos-core)', () => {
    it('creates a chaos engine with standard injectors', () => {
      const engine = createChaosEngine({
        probability: 0.5,
        seed: 42,
      });
      expect(engine).toBeDefined();
    });

    it('creates standard injectors including timeout and rate-limit', () => {
      const injectors = createStandardInjectors({ probability: 0.5 });
      expect(injectors.length).toBeGreaterThan(0);
      const timeoutInjector = injectors.find((i: any) => i instanceof TimeoutInjector);
      expect(timeoutInjector).toBeDefined();
    });

    it('timeout injector has configurable delay', () => {
      const injector = new TimeoutInjector({ timeoutMs: 5000 });
      expect(injector).toBeDefined();
    });
  });

  describe('category defaults (unconditional)', () => {
    it('uses a stored high-reasoning default for generator/agent/mcp scopes and reasoning:true', async () => {
      (defaultsResolution.resolve as any).mockImplementation(
        (_domain: string, category: string) => {
          if (category === 'high-reasoning') {
            return Promise.resolve({
              providerId: 'openai',
              version: 'v1',
              model: 'gpt-5',
              source: 'stored',
            });
          }
          return Promise.resolve(null);
        },
      );

      for (const scope of ['generator', 'agent', 'mcp'] as const) {
        const resolved = await provider.resolveConfigForScope(scope, 'org-123');
        expect(resolved?.providerId).toBe('openai');
        expect(resolved?.modelId).toBe('gpt-5');
      }

      // resolveConfigForScope does not accept reasoning options, so exercise the
      // private resolver directly for the reasoning:true branch.
      const reasoningResolved = await (provider as any)._resolveConfig('utility', 'org-123', { reasoning: true });
      expect(reasoningResolved?.providerId).toBe('openai');
      expect(reasoningResolved?.modelId).toBe('gpt-5');
    });

    it('falls back to SURFACE_DEFAULTS when no candidate is resolved', async () => {
      (defaultsResolution.resolve as any).mockResolvedValue(null);
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: '',
        credentials: { apiKey: 'sk-test' },
      });

      const resolved = await provider.resolveConfigForScope('agent', 'org-123');
      expect(resolved?.modelId).toBe('gpt-5.2');
    });

    it('consults category defaults even when AI_MODEL_DEFAULTS_ENABLED=false is set (no kill switch)', async () => {
      // v1.0.0 removed the kill switch — the env var must be inert and the
      // category-defaults path always taken.
      vi.stubEnv('AI_MODEL_DEFAULTS_ENABLED', 'false');
      try {
        (defaultsResolution.resolve as any).mockResolvedValue({
          providerId: 'openai',
          version: 'v1',
          model: 'gpt-5',
          source: 'stored',
        });

        const resolved = await provider.resolveConfigForScope('utility', 'org-123');

        expect(defaultsResolution.resolve).toHaveBeenCalledWith('ai', 'low-reasoning', 'org-123');
        expect(resolved?.modelId).toBe('gpt-5');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('capability checks use the org-pinned version (PV-01)', () => {
    it('resolveProviderRef returns providerId and version from resolved config', async () => {
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'openai',
        defaultModel: 'gpt-4.1',
        version: 'v2',
        credentials: { apiKey: 'sk-test' },
      });

      const ref = await provider.resolveProviderRef('utility', 'org-123');

      expect(ref.providerId).toBe('openai');
      expect(ref.version).toBe('v2');
    });

    it('hasCapability passes version to _resolveAI', () => {
      (resolution.resolveAI as any).mockClear();
      provider.hasCapability('openai', 'vision', 'v2');
      expect(resolution.resolveAI).toHaveBeenCalledWith('openai', {
        version: 'v2',
        credentials: {},
        orgId: undefined,
      });
    });

    it('hasCapability does not hard-default to v1 when no version is supplied', () => {
      (resolution.resolveAI as any).mockClear();
      provider.hasCapability('openai', 'vision');
      expect(resolution.resolveAI).toHaveBeenCalledWith('openai', {
        version: undefined,
        credentials: {},
        orgId: undefined,
      });
    });

    it('modelHasCapability passes version to _resolveAI', async () => {
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') {
          return {
            identifier: 'openai',
            credentialFields: [{ key: 'apiKey' }],
            listModels: vi.fn().mockResolvedValue([
              { id: 'gpt-4o', capabilities: { vision: true } },
            ]),
          };
        }
        return undefined;
      });

      await provider.modelHasCapability('openai', 'gpt-4o', 'vision', { apiKey: 'k' }, 'v3');

      expect(resolution.resolveAI).toHaveBeenCalledWith('openai', {
        credentials: { apiKey: 'k' },
        version: 'v3',
      });
    });
  });

  describe('generateTextWithModel / generateObjectWithModel', () => {
    it('passes the explicit model id to createLanguageModel', async () => {
      const createLanguageModel = vi.fn().mockReturnValue(mockLanguageModel);
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') {
          return {
            identifier: 'openai',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel,
          };
        }
        return undefined;
      });
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'custom-model-42', {
        prompt: 'Hello',
      });

      expect(createLanguageModel).toHaveBeenCalledWith(
        { apiKey: 'sk-test' },
        'custom-model-42',
        { temperature: undefined },
      );
    });

    it('runs governance wrappers when generating text with an explicit model', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'Hello',
      });

      expect(budget.checkBudget).toHaveBeenCalledWith('utility', 'org-123', 'openai');
      expect(guardrails.checkInput).toHaveBeenCalledWith('Hello', { orgId: 'org-123' });
      expect(telemetry.startSpan).toHaveBeenCalled();
      expect(guardrails.checkOutput).toHaveBeenCalled();
      expect(health.recordSuccess).toHaveBeenCalledWith('openai');
    });

    it('splits a data-URI imageUrl into a raw-base64 file part (no doubled prefix)', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      // 1x1 transparent PNG — provider adapters prepend their own
      // `data:<mime>;base64,` to a string `data`, so the part must carry the
      // raw payload only ("Invalid base64 image_url" otherwise).
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'describe this image',
        imageUrl: `data:image/png;base64,${b64}`,
      });

      const prompt = mockDoGenerate.mock.calls.at(-1)![0].prompt;
      const filePart = prompt[0].content.find((p: any) => p.type === 'file');
      expect(filePart.mediaType).toBe('image/png');
      expect(filePart.data).toBe(b64);
    });

    it('passes a remote imageUrl as a URL file part instead of base64-wrapping it', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'describe this image',
        imageUrl: 'https://example.com/sheet.png',
      });

      const prompt = mockDoGenerate.mock.calls.at(-1)![0].prompt;
      const filePart = prompt[0].content.find((p: any) => p.type === 'file');
      expect(filePart.data).toBeInstanceOf(URL);
      expect((filePart.data as URL).toString()).toBe('https://example.com/sheet.png');
    });

    it('builds one file part per imageUrl, in caller order (multi-image critique)', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      await provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'compare Image 1 against Image 2',
        imageUrl: [`data:image/png;base64,${b64}`, 'https://example.com/reference.jpg'],
      });

      const prompt = mockDoGenerate.mock.calls.at(-1)![0].prompt;
      const content = prompt[0].content;
      // Text part first, then file parts in the order the URLs were passed —
      // the critic prompt addresses "Image 1"/"Image 2" by this order.
      expect(content[0].type).toBe('text');
      expect(content[1].type).toBe('file');
      expect(content[1].data).toBe(b64);
      expect(content[2].type).toBe('file');
      expect(content[2].data).toBeInstanceOf(URL);
      expect((content[2].data as URL).toString()).toBe('https://example.com/reference.jpg');
      expect(content).toHaveLength(3);
    });

    it('runs governance wrappers when generating an object with an explicit model', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      mockDoGenerate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"title": "test"}' }],
        usage: { inputTokens: 10, outputTokens: 20 },
        finishReason: 'stop',
      });

      await provider.generateObjectWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
        prompt: 'Extract data',
      });

      expect(budget.checkBudget).toHaveBeenCalledWith('utility', 'org-123', 'openai');
      expect(guardrails.checkInput).toHaveBeenCalledWith('Extract data', { orgId: 'org-123' });
      expect(telemetry.startSpan).toHaveBeenCalled();
      expect(guardrails.checkOutput).toHaveBeenCalled();
      expect(health.recordSuccess).toHaveBeenCalledWith('openai');
    });

    it('rejects with BadRequestException when modelId is omitted', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      await expect(
        provider.generateTextWithModel('org-123', 'openai', 'v1', undefined as any, { prompt: 'Hello' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        provider.generateObjectWithModel('org-123', 'openai', 'v1', undefined as any, { prompt: 'JSON' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with GuardrailViolation when input guardrails reject', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      (guardrails.checkInput as any).mockRejectedValueOnce(new GuardrailViolation('blocked prompt'));

      await expect(
        provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', { prompt: 'bad prompt' }),
      ).rejects.toThrow(GuardrailViolation);

      expect(mockDoGenerate).not.toHaveBeenCalled();
    });

    it('rejects with BudgetExceeded when budget check disallows text generation', async () => {
      const createLanguageModel = vi.fn();
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') {
          return {
            identifier: 'openai',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel,
          };
        }
        return undefined;
      });
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      (budget.checkBudget as any).mockResolvedValueOnce({ allowed: false, reason: 'monthly cap hit' });

      await expect(
        provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', { prompt: 'Hello' }),
      ).rejects.toThrow(BudgetExceeded);

      expect(createLanguageModel).not.toHaveBeenCalled();
    });

    it('rejects with BudgetExceeded when budget check disallows object generation', async () => {
      const createLanguageModel = vi.fn();
      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') {
          return {
            identifier: 'openai',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel,
          };
        }
        return undefined;
      });
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      (budget.checkBudget as any).mockResolvedValueOnce({ allowed: false, reason: 'daily cap hit' });

      await expect(
        provider.generateObjectWithModel('org-123', 'openai', 'v1', 'gpt-4.1', { prompt: 'JSON' }),
      ).rejects.toThrow(BudgetExceeded);

      expect(createLanguageModel).not.toHaveBeenCalled();
    });

    it('resolves credentials via latest active version when no version is passed (PV-03)', async () => {
      mockGetByIdentifier.mockImplementation((_orgId: string, _id: string, v?: string) => {
        // Simulate OrgAiSettingsService: when version is omitted the service resolves
        // the org's pinned v2 row; a hardcoded v1 default would return null.
        if (v === 'v2' || v === undefined) {
          return { credentials: { apiKey: 'v2-key' } };
        }
        return null;
      });

      const creds = await (provider as any)._credentialsForProvider('org-123', 'openai');

      expect(creds).toEqual({ apiKey: 'v2-key' });
      expect(mockGetByIdentifier).toHaveBeenCalledWith('org-123', 'openai', undefined);
    });
  });

  describe('governedLanguageModel', () => {
    it('returns a proxy whose doGenerate runs governance and records usage', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      const governed = await provider.governedLanguageModel('agent', 'org-123');
      const result = await governed.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      });

      expect(result.content?.[0]?.text).toBe('Generated response');
      expect(budget.checkBudget).toHaveBeenCalledWith('agent', 'org-123', 'openai');
      expect(guardrails.checkInput).toHaveBeenCalledWith('Hello', { orgId: 'org-123' });
      expect(guardrails.checkOutput).toHaveBeenCalledWith('Generated response', { orgId: 'org-123' });
      expect(health.recordSuccess).toHaveBeenCalledWith('openai');
      // Usage must be recorded exactly once (by the budget wrapper applied in
      // languageModel()); the governance wrapper must not double-record.
      expect(budget.recordSpend).toHaveBeenCalledTimes(1);
    });

    it('proxy doGenerate rejects when the input guardrails reject', async () => {
      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });
      (guardrails.checkInput as any).mockRejectedValueOnce(new GuardrailViolation('blocked'));

      const governed = await provider.governedLanguageModel('agent', 'org-123');

      await expect(
        governed.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'bad' }] }],
        }),
      ).rejects.toThrow(GuardrailViolation);
    });
  });

  describe('provider-scoped budget enforcement', () => {
    it('blocks the capped provider but still allows a different provider', async () => {
      (budget.checkBudget as any).mockImplementation(
        async (_scope: string, _orgId: string, provider: string) => ({
          allowed: provider !== 'openai',
          reason: provider === 'openai' ? 'provider_budget_exceeded' : undefined,
        }),
      );

      (resolution.resolveAI as any).mockImplementation((id: string) => {
        if (id === 'openai') {
          return {
            identifier: 'openai',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: vi.fn().mockReturnValue(mockLanguageModel),
          };
        }
        if (id === 'anthropic') {
          return {
            identifier: 'anthropic',
            credentialFields: [{ key: 'apiKey', required: true }],
            createLanguageModel: vi.fn().mockReturnValue({
              doGenerate: vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'Anthropic response' }],
                usage: { inputTokens: 1, outputTokens: 1 },
              }),
            }),
          };
        }
        return undefined;
      });

      mockGetByIdentifier.mockResolvedValue({
        credentials: { apiKey: 'sk-test' },
      });

      await expect(
        provider.generateTextWithModel('org-123', 'openai', 'v1', 'gpt-4.1', {
          prompt: 'Hello',
        }),
      ).rejects.toThrow(BudgetExceeded);

      const anthropicResult = await provider.generateTextWithModel(
        'org-123',
        'anthropic',
        'v1',
        'claude-sonnet',
        { prompt: 'Hello' },
      );
      expect(anthropicResult).toBe('Anthropic response');
    });
  });

  describe('prompt tool-output sanitization (gateway poisoning fix)', () => {
    // Live-verified prod crash (2026-08-27, org on the gateway hub): Mastra's
    // agent-delegation tool stores providerMetadata.mastra.modelOutput =
    // {type:'text', value: output.text}; when the sub-agent result is an error
    // object without `text` (tool-input validation failure), JSONB persistence
    // drops the undefined value and Mastra's MessageList.llmPrompt() later swaps
    // {type:'text'} (no value) into the tool-result output verbatim. The Vercel
    // AI Gateway zod-rejects that shape ("Invalid input" at
    // prompt[N].content[0]), the stream dies, and the poisoned memory row bricks
    // every later turn of the thread. The wrapper must repair the shape before
    // the prompt leaves for the provider.
    const poisonedPrompt = () => [
      { role: 'user', content: [{ type: 'text', text: 'generate a bird image' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'agent-media', input: { prompt: 'bird' } },
        ],
      },
      {
        role: 'tool',
        content: [
          // The exact shape recalled from mastra_messages for a failed
          // agent-media delegation (value key dropped by JSONB).
          { type: 'tool-result', toolCallId: 'call_1', toolName: 'agent-media', output: { type: 'text' } },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'approved, proceed' }] },
    ];

    const sanitize = (prompt: any) =>
      (provider as any)._sanitizePromptToolOutputs(prompt, 'gateway', 'openai/gpt-4.1-mini');

    it('repairs a text output whose value was dropped (the poisoned shape)', () => {
      const result = sanitize(poisonedPrompt());
      expect(result[2].content[0].output).toEqual({ type: 'text', value: '' });
    });

    it('repairs every other value-less / mis-shaped output variant', () => {
      const tool = (output: any) => ({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'c', toolName: 't', output }],
      });
      // Missing output entirely.
      expect(sanitize([{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c', toolName: 't' }] }])[0].content[0].output)
        .toEqual({ type: 'json', value: null });
      // Bare string output.
      expect(sanitize([tool('raw string')])[0].content[0].output).toEqual({ type: 'text', value: 'raw string' });
      // json with undefined value -> null.
      expect(sanitize([tool({ type: 'json' })])[0].content[0].output).toEqual({ type: 'json', value: null });
      // error-text with non-string value.
      expect(sanitize([tool({ type: 'error-text', value: { code: 1 } })])[0].content[0].output)
        .toEqual({ type: 'error-text', value: '{"code":1}' });
      // content with non-array value -> re-homed as json.
      expect(sanitize([tool({ type: 'content', value: 'x' })])[0].content[0].output)
        .toEqual({ type: 'json', value: 'x' });
      // unknown output type -> re-homed as json.
      expect(sanitize([tool({ type: 'weird', value: 7 })])[0].content[0].output)
        .toEqual({ type: 'json', value: 7 });
    });

    it('passes spec-valid prompts through by reference', () => {
      const prompt = [
        { role: 'system', content: [{ type: 'text', text: 'sys' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} }],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool-result', toolCallId: 'c1', toolName: 't', output: { type: 'json', value: { needsConfirmation: true } } },
            { type: 'tool-result', toolCallId: 'c2', toolName: 't', output: { type: 'text', value: 'done' } },
            { type: 'tool-result', toolCallId: 'c3', toolName: 't', output: { type: 'json', value: null } },
            { type: 'tool-result', toolCallId: 'c4', toolName: 't', output: { type: 'execution-denied', reason: 'no' } },
            { type: 'tool-result', toolCallId: 'c5', toolName: 't', output: { type: 'content', value: [{ type: 'text', text: 'x' }] } },
          ],
        },
      ];
      expect(sanitize(prompt)).toBe(prompt);
    });

    it('returns non-array prompts untouched', () => {
      expect(sanitize(undefined)).toBe(undefined);
      expect(sanitize('plain string prompt')).toBe('plain string prompt');
    });

    it('does not mutate the caller-owned prompt', async () => {
      const prompt = poisonedPrompt();
      const model = await provider.languageModel('agent', 'org-123');
      const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() });
      (mockLanguageModel as any).doStream = doStream;

      await (model as any).doStream({ prompt });

      expect(prompt[2].content[0].output).toEqual({ type: 'text' });
      expect(doStream.mock.calls[0][0].prompt[2].content[0].output).toEqual({ type: 'text', value: '' });
    });

    it('repairs the prompt on the doGenerate path too', async () => {
      const model = await provider.languageModel('agent', 'org-123');
      await (model as any).doGenerate({ prompt: poisonedPrompt() });
      const sent = mockDoGenerate.mock.calls.at(-1)?.[0]?.prompt;
      expect(sent[2].content[0].output).toEqual({ type: 'text', value: '' });
    });

    it('sends a gateway-schema-valid payload after repair (mocked fetch, real @ai-sdk/gateway serialization)', async () => {
      const { createGateway } = await import('@ai-sdk/gateway');
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('data: {"type":"finish","finishReason":"stop","usage":{"inputTokens":1,"outputTokens":1}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
      (resolution.resolveAI as any).mockImplementation((id: string) =>
        id === 'gateway'
          ? {
              identifier: 'gateway',
              name: 'Vercel AI',
              credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
              capabilities: { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true },
              createLanguageModel: vi.fn().mockImplementation(() =>
                createGateway({ apiKey: 'gw-test', fetch: fetchSpy as any }).languageModel('openai/gpt-4.1-mini'),
              ),
            }
          : undefined,
      );
      mockGetActiveProvider.mockResolvedValue({
        identifier: 'gateway',
        defaultModel: 'openai/gpt-4.1-mini',
        credentials: { apiKey: 'gw-test' },
      });

      const model = await provider.languageModel('agent', 'org-123');
      await (model as any).doStream({ prompt: poisonedPrompt() });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      // The shape the gateway zod-rejected live (output.value undefined) is now
      // a valid text output.
      expect(body.prompt[2].content[0]).toMatchObject({
        type: 'tool-result',
        toolCallId: 'call_1',
        output: { type: 'text', value: '' },
      });
    });
  });
});
