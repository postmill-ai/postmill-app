import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/mistral', () => ({
  createMistral: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'mistral-large-latest' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { MistralAdapter } from '../ai.adapter';

describe('MistralAdapter', () => {
  let adapter: MistralAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new MistralAdapter();
  });

  describe('metadata', () => {
    it('has identifier "mistral"', () => {
      expect(adapter.identifier).toBe('mistral');
    });

    it('has name "Mistral AI"', () => {
      expect(adapter.name).toBe('Mistral AI');
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

    it('has capabilities (text, vision, embeddings, tools; no image/speech)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: true,
        embeddings: true,
        speech: false,
        tools: true,
      });
    });

    it('has privacy with trainingOnData false', () => {
      expect(adapter.privacy?.trainingOnData).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns Mistral text and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const large = models.find((m) => m.id === 'mistral-large-latest');
      expect(large).toBeDefined();
      expect(large?.kind).toBe('text');

      const pixtral = models.find((m) => m.id === 'pixtral-large-latest');
      expect(pixtral).toBeDefined();
      expect(pixtral?.capabilities.vision).toBe(true);

      const embed = models.find((m) => m.id === 'mistral-embed');
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
      const model = adapter.createLanguageModel({ apiKey: 'test_key' }, 'mistral-large-latest');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'test_key' },
        'mistral-large-latest',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'test_key' }, 'mistral-small-latest');
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel({ apiKey: 'test_key' }, 'mistral-embed');
      expect(model).toBeDefined();
    });
  });

  describe('no createImageModel', () => {
    it('does not have createImageModel method', () => {
      expect((adapter as any).createImageModel).toBeUndefined();
    });
  });
});
