import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'deepseek-chat' })),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { DeepSeekAdapter } from '../ai.adapter';

describe('DeepSeekAdapter', () => {
  let adapter: DeepSeekAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DeepSeekAdapter();
  });

  describe('metadata', () => {
    it('has identifier "deepseek"', () => {
      expect(adapter.identifier).toBe('deepseek');
    });

    it('has name "DeepSeek"', () => {
      expect(adapter.name).toBe('DeepSeek');
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

    it('has privacy with trainingOnData true', () => {
      expect(adapter.privacy?.trainingOnData).toBe(true);
    });
  });

  describe('listModels', () => {
    it('returns DeepSeek V3 and R1 models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(2);

      const chat = models.find((m) => m.id === 'deepseek-chat');
      expect(chat).toBeDefined();
      expect(chat?.kind).toBe('text');
      expect(chat?.label).toBe('DeepSeek-V3');

      const reasoner = models.find((m) => m.id === 'deepseek-reasoner');
      expect(reasoner).toBeDefined();
      expect(reasoner?.kind).toBe('text');
      expect(reasoner?.label).toBe('DeepSeek-R1');
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
      const result = await adapter.validateCredentials({ apiKey: 'sk-test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model for chat', () => {
      const model = adapter.createLanguageModel({ apiKey: 'sk-test' }, 'deepseek-chat');
      expect(model).toBeDefined();
    });

    it('returns a language model for reasoner', () => {
      const model = adapter.createLanguageModel({ apiKey: 'sk-test' }, 'deepseek-reasoner');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'sk-test' },
        'deepseek-chat',
        { temperature: 0.7, maxTokens: 1024 },
      );
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'sk-test' }, 'deepseek-reasoner');
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
