import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/perplexity', () => ({
  createPerplexity: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'sonar-pro' })),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { PerplexityAdapter } from '../ai.adapter';

describe('PerplexityAdapter', () => {
  let adapter: PerplexityAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PerplexityAdapter();
  });

  describe('metadata', () => {
    it('has identifier "perplexity"', () => {
      expect(adapter.identifier).toBe('perplexity');
    });

    it('has name "Perplexity"', () => {
      expect(adapter.name).toBe('Perplexity');
    });

    it('has type "direct"', () => {
      expect(adapter.type).toBe('direct');
    });

    it('has credentialFields with apiKey', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.type).toBe('password');
    });

    it('has capabilities (text, tools only; no image/vision/embeddings/speech)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: false,
        embeddings: false,
        speech: false,
        tools: true,
      });
    });

    it('has privacy with trainingOnData false', () => {
      expect(adapter.privacy?.trainingOnData).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns Sonar models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const sonarPro = models.find((m) => m.id === 'sonar-pro');
      expect(sonarPro).toBeDefined();
      expect(sonarPro?.kind).toBe('text');

      const sonar = models.find((m) => m.id === 'sonar');
      expect(sonar).toBeDefined();

      const reasoningPro = models.find((m) => m.id === 'sonar-reasoning-pro');
      expect(reasoningPro).toBeDefined();

      const deepResearch = models.find((m) => m.id === 'sonar-deep-research');
      expect(deepResearch).toBeDefined();
    });

    it('does not throw on empty credentials', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for empty apiKey', async () => {
      const result = await adapter.validateCredentials({});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('returns ok: false on network failure', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
      const result = await adapter.validateCredentials({ apiKey: 'pplx-test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'pplx-test' }, 'sonar-pro');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'pplx-test' },
        'sonar-pro',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'pplx-test' }, 'sonar-reasoning');
      expect(model).toBeDefined();
    });
  });

  describe('no createImageModel', () => {
    it('does not have createImageModel method', () => {
      expect((adapter as any).createImageModel).toBeUndefined();
    });
  });

  describe('no createEmbeddingModel', () => {
    it('does not have createEmbeddingModel method', () => {
      expect((adapter as any).createEmbeddingModel).toBeUndefined();
    });
  });
});
