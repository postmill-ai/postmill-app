import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/togetherai', () => ({
  createTogetherAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'meta-llama/Llama-4-Scout' })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { TogetherAIAdapter } from '../ai.adapter';

describe('TogetherAIAdapter', () => {
  let adapter: TogetherAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TogetherAIAdapter();
  });

  describe('metadata', () => {
    it('has identifier "togetherai"', () => {
      expect(adapter.identifier).toBe('togetherai');
    });

    it('has name "Together AI"', () => {
      expect(adapter.name).toBe('Together AI');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields with apiKey', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.type).toBe('password');
    });

    it('has capabilities (text, image, vision, embeddings, tools)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: true,
        vision: true,
        embeddings: true,
        speech: false,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns Llama, DeepSeek, image, and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const llama = models.find((m) => m.id === 'meta-llama/Llama-4-Scout-17B-16E-Instruct');
      expect(llama).toBeDefined();
      expect(llama?.kind).toBe('text');

      const deepseek = models.find((m) => m.id === 'deepseek-ai/DeepSeek-R1');
      expect(deepseek).toBeDefined();

      const flux = models.find((m) => m.id === 'black-forest-labs/FLUX.1-dev');
      expect(flux).toBeDefined();
      expect(flux?.kind).toBe('image');

      const embedding = models.find((m) => m.id === 'togethercomputer/m2-bert-80M-8k-retrieval');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');
      expect(embedding?.dimension).toBe(768);
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
      const result = await adapter.validateCredentials({ apiKey: 'test-key' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(
        { apiKey: 'test-key' },
        'meta-llama/Llama-4-Scout-17B-16E-Instruct',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'test-key' },
        'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        { temperature: 0.7, topP: 0.9, maxTokens: 2048 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'test-key' },
        'deepseek-ai/DeepSeek-R1',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { apiKey: 'test-key' },
        'black-forest-labs/FLUX.1-dev',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { apiKey: 'test-key' },
        'togethercomputer/m2-bert-80M-8k-retrieval',
      );
      expect(model).toBeDefined();
    });
  });
});
