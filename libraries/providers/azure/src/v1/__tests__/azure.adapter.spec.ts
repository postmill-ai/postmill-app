import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => ({
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({}),
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

import { AzureAdapter } from '../ai.adapter';

describe('AzureAdapter', () => {
  let adapter: AzureAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AzureAdapter();
  });

  describe('metadata', () => {
    it('has identifier "azure"', () => {
      expect(adapter.identifier).toBe('azure');
    });

    it('has name "Azure OpenAI"', () => {
      expect(adapter.name).toBe('Azure OpenAI');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields for apiKey, resourceName, and apiVersion', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      expect(keys).toContain('resourceName');
      expect(keys).toContain('apiVersion');

      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);

      const resourceField = adapter.credentialFields.find((f) => f.key === 'resourceName');
      expect(resourceField?.required).toBe(true);

      const versionField = adapter.credentialFields.find((f) => f.key === 'apiVersion');
      expect(versionField?.required).toBe(false);
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
    it('returns GPT and embedding models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gpt4o = models.find((m) => m.id === 'gpt-4o');
      expect(gpt4o).toBeDefined();
      expect(gpt4o?.kind).toBe('text');

      const embedding = models.find((m) => m.id === 'text-embedding-3-small');
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

    it('returns error for missing resourceName', async () => {
      const result = await adapter.validateCredentials({ apiKey: 'test-key' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Azure resource name is required');
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(
        { apiKey: 'test-key', resourceName: 'my-resource' },
        'gpt-4o',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('throws an error (not installed)', () => {
      expect(() =>
        adapter.createLangchainModel({ apiKey: 'test-key', resourceName: 'my-resource' }, 'gpt-4o'),
      ).toThrow('Azure OpenAI LangChain integration is not installed');
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { apiKey: 'test-key', resourceName: 'my-resource' },
        'dall-e-3',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { apiKey: 'test-key', resourceName: 'my-resource' },
        'text-embedding-3-small',
      );
      expect(model).toBeDefined();
    });
  });
});
