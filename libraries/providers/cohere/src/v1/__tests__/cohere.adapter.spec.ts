import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/cohere', () => ({
  createCohere: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'command-r-plus' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { CohereAdapter } from '../ai.adapter';

describe('CohereAdapter', () => {
  let adapter: CohereAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CohereAdapter();
  });

  describe('metadata', () => {
    it('has identifier "cohere"', () => {
      expect(adapter.identifier).toBe('cohere');
    });

    it('has name "Cohere"', () => {
      expect(adapter.name).toBe('Cohere');
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

    it('has capabilities (text, embeddings, tools; no image/vision/speech)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: false,
        embeddings: true,
        speech: false,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns text and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const commandR = models.find((m) => m.id === 'command-r-plus');
      expect(commandR).toBeDefined();
      expect(commandR?.kind).toBe('text');

      const embed = models.find((m) => m.id === 'embed-english-v3.0');
      expect(embed).toBeDefined();
      expect(embed?.kind).toBe('embedding');
      expect(embed?.dimension).toBe(1024);
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
      const result = await adapter.validateCredentials({ apiKey: 'test_key' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'test_key' }, 'command-r-plus');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'test_key' },
        'command-r-plus',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'test_key' }, 'command');
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel({ apiKey: 'test_key' }, 'embed-english-v3.0');
      expect(model).toBeDefined();
    });
  });

  describe('no createImageModel', () => {
    it('does not have createImageModel method', () => {
      expect((adapter as any).createImageModel).toBeUndefined();
    });
  });
});
