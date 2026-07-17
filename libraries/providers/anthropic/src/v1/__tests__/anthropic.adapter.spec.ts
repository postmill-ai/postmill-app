import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'claude-opus-4' })),
  })),
}));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn(function() { return {}; }),
}));

import { AnthropicAdapter } from '../ai.adapter';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter();
  });

  describe('metadata', () => {
    it('has identifier "anthropic"', () => {
      expect(adapter.identifier).toBe('anthropic');
    });

    it('has name "Anthropic Claude"', () => {
      expect(adapter.name).toBe('Anthropic Claude');
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

    it('has capabilities (text, vision, tools only)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: false,
        vision: true,
        embeddings: false,
        speech: false,
        tools: true,
      });
    });

    it('has privacy info', () => {
      expect(adapter.privacy).toBeDefined();
      expect(adapter.privacy?.description).toContain('Anthropic');
    });
  });

  describe('listModels', () => {
    // 2.5: current live IDs — the never-existed/retired ids were removed.
    const LIVE_IDS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
    const DEAD_IDS = ['claude-4-20250514', 'claude-3-opus-20240229', 'claude-3-5-sonnet-20241022'];

    it('returns current live Claude models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const opus = models.find((m) => m.id === 'claude-opus-4-8');
      expect(opus).toBeDefined();
      expect(opus?.kind).toBe('text');
      expect(opus?.capabilities.text).toBe(true);

      const sonnet = models.find((m) => m.id === 'claude-sonnet-5');
      expect(sonnet).toBeDefined();
    });

    it('no longer carries the never-existed / retired model ids', async () => {
      const ids = (await adapter.listModels({})).map((m) => m.id);
      for (const dead of DEAD_IDS) expect(ids).not.toContain(dead);
    });

    it('marks a LIVE model as reasoning:true (high-reasoning auto-pick target)', async () => {
      const models = await adapter.listModels({});
      const reasoning = models.filter((m) => m.reasoning);
      expect(reasoning.length).toBeGreaterThan(0);
      for (const m of reasoning) expect(LIVE_IDS).toContain(m.id);
    });

    it('returns models even with empty credentials', async () => {
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

    it('returns ok: false on network error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
      const result = await adapter.validateCredentials({ apiKey: 'sk-ant-test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      fetchSpy.mockRestore();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel({ apiKey: 'sk-ant-test' }, 'claude-sonnet-4-20250514');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('returns a LangChain model', () => {
      const model = adapter.createLangchainModel({ apiKey: 'sk-ant-test' }, 'claude-sonnet-4-20250514', { temperature: 0.5 });
      expect(model).toBeDefined();
    });

    it('handles missing optional parameters', () => {
      const model = adapter.createLangchainModel({ apiKey: 'sk-ant-test' }, 'claude-3-haiku-20240307');
      expect(model).toBeDefined();
    });
  });

  describe('createImageModel', () => {
    it('returns undefined (not supported)', () => {
      const model = adapter.createImageModel();
      expect(model).toBeUndefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns undefined (not supported)', () => {
      const model = adapter.createEmbeddingModel();
      expect(model).toBeUndefined();
    });
  });

  describe('createSpeechModel', () => {
    it('returns undefined (not supported)', () => {
      const model = adapter.createSpeechModel();
      expect(model).toBeUndefined();
    });
  });
});
