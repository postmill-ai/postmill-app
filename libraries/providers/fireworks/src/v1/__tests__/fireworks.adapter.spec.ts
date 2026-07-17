import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/fireworks', () => ({
  createFireworks: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'llama-v4-scout' })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { FireworksAdapter } from '../ai.adapter';

describe('FireworksAdapter', () => {
  let adapter: FireworksAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new FireworksAdapter();
  });

  describe('metadata', () => {
    it('has identifier "fireworks"', () => {
      expect(adapter.identifier).toBe('fireworks');
    });

    it('has name "Fireworks AI"', () => {
      expect(adapter.name).toBe('Fireworks AI');
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

      const llama = models.find((m) => m.id === 'accounts/fireworks/models/llama-v4-scout-17b-16e-instruct');
      expect(llama).toBeDefined();
      expect(llama?.kind).toBe('text');

      const deepseek = models.find((m) => m.id === 'accounts/fireworks/models/deepseek-r1');
      expect(deepseek).toBeDefined();

      const flux = models.find((m) => m.id === 'accounts/fireworks/models/flux-1-dev-fp8');
      expect(flux).toBeDefined();
      expect(flux?.kind).toBe('image');

      const embedding = models.find((m) => m.id === 'nomic-ai/text-embed-v2-moushikada-lora');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');
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
      const result = await adapter.validateCredentials({ apiKey: 'fw_test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(
        { apiKey: 'fw_test' },
        'accounts/fireworks/models/llama-v4-scout-17b-16e-instruct',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'fw_test' },
        'accounts/fireworks/models/llama-v4-scout-17b-16e-instruct',
        { temperature: 0.7 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'fw_test' },
        'accounts/fireworks/models/deepseek-r1',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { apiKey: 'fw_test' },
        'accounts/fireworks/models/flux-1-dev-fp8',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { apiKey: 'fw_test' },
        'nomic-ai/text-embed-v2-moushikada-lora',
      );
      expect(model).toBeDefined();
    });
  });
});
