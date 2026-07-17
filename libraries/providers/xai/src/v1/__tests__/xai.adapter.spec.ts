import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/xai', () => ({
  createXai: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'grok-4' })),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { XaiAdapter } from '../ai.adapter';

describe('XaiAdapter', () => {
  let adapter: XaiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new XaiAdapter();
  });

  describe('metadata', () => {
    it('has identifier "xai"', () => {
      expect(adapter.identifier).toBe('xai');
    });

    it('has name "xAI Grok"', () => {
      expect(adapter.name).toBe('xAI Grok');
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

    it('has capabilities (text, vision, tools; no image/embeddings/speech)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: true,
        embeddings: false,
        speech: false,
        tools: true,
      });
    });

    it('has privacy with trainingOnData true', () => {
      expect(adapter.privacy?.trainingOnData).toBe(true);
    });
  });

  describe('listModels', () => {
    it('returns Grok models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const grok4 = models.find((m) => m.id === 'grok-4');
      expect(grok4).toBeDefined();
      expect(grok4?.kind).toBe('text');

      const grok4mini = models.find((m) => m.id === 'grok-4-mini');
      expect(grok4mini).toBeDefined();

      const vision = models.find((m) => m.id === 'grok-2-vision-1212');
      expect(vision).toBeDefined();
      expect(vision?.capabilities.vision).toBe(true);

      const nonVision = models.find((m) => m.id === 'grok-2-1212');
      expect(nonVision?.capabilities.vision).toBe(false);
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
      const result = await adapter.validateCredentials({ apiKey: 'xai-test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'xai-test' }, 'grok-4');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'xai-test' },
        'grok-4',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'xai-test' }, 'grok-4-mini');
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
