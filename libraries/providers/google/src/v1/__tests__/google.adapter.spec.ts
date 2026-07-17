import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({}),
      modelId: 'gemini-2.5-flash',
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

import { GoogleAdapter } from '../ai.adapter';

describe('GoogleAdapter', () => {
  let adapter: GoogleAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GoogleAdapter();
  });

  describe('metadata', () => {
    it('has identifier "google"', () => {
      expect(adapter.identifier).toBe('google');
    });

    it('has name "Google Gemini"', () => {
      expect(adapter.name).toBe('Google Gemini');
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
    it('returns Gemini and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gemini = models.find((m) => m.id === 'gemini-2.5-pro');
      expect(gemini).toBeDefined();
      expect(gemini?.kind).toBe('text');

      const embedding = models.find((m) => m.id === 'text-embedding-004');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');
      expect(embedding?.dimension).toBe(768);
    });

    it('does not throw on empty credentials', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
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
      const model = adapter.createLanguageModel({ apiKey: 'AIza-test' }, 'gemini-2.5-flash');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('throws an error (not installed)', () => {
      expect(() => adapter.createLangchainModel({ apiKey: 'AIza-test' }, 'gemini-2.5-flash'))
        .toThrow('Google Generative AI LangChain integration is not installed');
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel({ apiKey: 'AIza-test' }, 'imagen-3.0');
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel({ apiKey: 'AIza-test' }, 'text-embedding-004');
      expect(model).toBeDefined();
    });
  });
});
