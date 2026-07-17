import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/groq', () => ({
  createGroq: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'llama-4-scout' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { GroqAdapter } from '../ai.adapter';

describe('GroqAdapter', () => {
  let adapter: GroqAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GroqAdapter();
  });

  describe('metadata', () => {
    it('has identifier "groq"', () => {
      expect(adapter.identifier).toBe('groq');
    });

    it('has name "Groq"', () => {
      expect(adapter.name).toBe('Groq');
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

    it('has capabilities (text, vision, embeddings, tools; no image)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: true,
        embeddings: true,
        speech: false,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns Llama, Mixtral, and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const llama = models.find((m) => m.id === 'llama-4-scout-17b-16e-instruct');
      expect(llama).toBeDefined();
      expect(llama?.kind).toBe('text');

      const mixtral = models.find((m) => m.id === 'mixtral-8x7b-32768');
      expect(mixtral).toBeDefined();

      const embedding = models.find((m) => m.id === 'all-minilm-l6-v2');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');
      expect(embedding?.dimension).toBe(384);
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
      const result = await adapter.validateCredentials({ apiKey: 'gsk_test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'gsk_test' }, 'llama-4-scout-17b-16e-instruct');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'gsk_test' },
        'llama-4-scout-17b-16e-instruct',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'gsk_test' }, 'mixtral-8x7b-32768');
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel({ apiKey: 'gsk_test' }, 'all-minilm-l6-v2');
      expect(model).toBeDefined();
    });
  });

  describe('no createImageModel', () => {
    it('does not have createImageModel method', () => {
      expect((adapter as any).createImageModel).toBeUndefined();
    });
  });
});
