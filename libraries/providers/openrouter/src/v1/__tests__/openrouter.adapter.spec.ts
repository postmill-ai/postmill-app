import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => ({
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({}),
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { OpenRouterAdapter } from '../ai.adapter';

describe('OpenRouterAdapter', () => {
  let adapter: OpenRouterAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter();
  });

  describe('metadata', () => {
    it('has identifier "openrouter"', () => {
      expect(adapter.identifier).toBe('openrouter');
    });

    it('has name "OpenRouter"', () => {
      expect(adapter.name).toBe('OpenRouter');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields for apiKey and baseURL', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      expect(keys).toContain('baseURL');

      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);

      const baseField = adapter.credentialFields.find((f) => f.key === 'baseURL');
      expect(baseField?.required).toBe(false);
      expect(baseField?.placeholder).toBe('https://openrouter.ai/api/v1');
    });

    it('has all capabilities enabled', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: true,
        vision: true,
        embeddings: true,
        speech: true,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns multi-provider models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gpt4o = models.find((m) => m.id === 'openai/gpt-4o');
      expect(gpt4o).toBeDefined();
      expect(gpt4o?.kind).toBe('text');

      const claude = models.find((m) => m.id === 'anthropic/claude-sonnet-4-20250514');
      expect(claude).toBeDefined();

      const embedding = models.find((m) => m.id === 'openai/text-embedding-3-small');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');
      expect(embedding?.dimension).toBe(1536);
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
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'sk-or-test' }, 'openai/gpt-4o');
      expect(model).toBeDefined();
    });

    it('works with custom baseURL in provider cache', () => {
      const model = adapter.createLanguageModel(
        { apiKey: 'sk-or-test', baseURL: 'https://custom.openrouter.ai/api/v1' },
        'anthropic/claude-sonnet-4-20250514',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('creates a LangChain model for openai/ prefix', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'sk-or-test' },
        'openai/gpt-4o',
        { temperature: 0.7 },
      );
      expect(model).toBeDefined();
    });

    it('throws for non-openai model prefix', () => {
      expect(() =>
        adapter.createLangchainModel(
          { apiKey: 'sk-or-test' },
          'anthropic/claude-sonnet-4-20250514',
        ),
      ).toThrow(/Only OpenAI-compatible models/);
    });

    it('uses custom baseURL when provided', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'sk-or-test', baseURL: 'https://custom.openrouter.ai/api/v1' },
        'openai/gpt-4o-mini',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { apiKey: 'sk-or-test' },
        'openai/dall-e-3',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { apiKey: 'sk-or-test' },
        'openai/text-embedding-3-small',
      );
      expect(model).toBeDefined();
    });
  });
});
