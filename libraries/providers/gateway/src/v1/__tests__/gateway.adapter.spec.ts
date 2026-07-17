import { describe, it, expect, vi, beforeEach } from 'vitest';

const doGenerateMock = vi.fn().mockResolvedValue({});
const getAvailableModelsMock = vi.fn().mockResolvedValue({ models: [] });

vi.mock('@ai-sdk/gateway', () => ({
  createGateway: vi.fn(() => ({
    getAvailableModels: getAvailableModelsMock,
    languageModel: vi.fn(() => ({
      doGenerate: doGenerateMock,
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { GatewayAdapter } from '../ai.adapter';

describe('GatewayAdapter', () => {
  let adapter: GatewayAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GatewayAdapter();
  });

  describe('metadata', () => {
    it('has identifier "gateway"', () => {
      expect(adapter.identifier).toBe('gateway');
    });

    it('has name "Vercel AI"', () => {
      expect(adapter.name).toBe('Vercel AI');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields for apiKey (required) and baseURL (optional)', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      expect(keys).toContain('baseURL');

      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);

      // baseURL is optional — the AI Gateway SDK defaults the endpoint when omitted.
      const baseField = adapter.credentialFields.find((f) => f.key === 'baseURL');
      expect(baseField?.required).toBe(false);
    });

    it('has all capabilities enabled', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: true,
        vision: true,
        embeddings: true,
        speech: true,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns multi-provider gateway models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gpt4o = models.find((m) => m.id === 'openai/gpt-4o');
      expect(gpt4o).toBeDefined();
      expect(gpt4o?.kind).toBe('text');

      const claude = models.find((m) => m.id === 'anthropic/claude-sonnet-4-20250514');
      expect(claude).toBeDefined();

      const embedding = models.find((m) => m.id === 'openai/text-embedding-3-small');
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

    // 5.15: cheap authenticated metadata call, not a paid generation.
    it('validates via getAvailableModels without running paid inference (5.15)', async () => {
      const result = await adapter.validateCredentials({ apiKey: 'gw_test' });
      expect(result).toEqual({ ok: true });
      expect(getAvailableModelsMock).toHaveBeenCalled();
      expect(doGenerateMock).not.toHaveBeenCalled();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(
        { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' },
        'openai/gpt-4o',
      );
      expect(model).toBeDefined();
    });

    it('works with different model IDs', () => {
      const creds = { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' };
      const modelA = adapter.createLanguageModel(creds, 'openai/gpt-4o');
      const modelB = adapter.createLanguageModel(creds, 'anthropic/claude-sonnet-4-20250514');
      expect(modelA).toBeDefined();
      expect(modelB).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('creates a LangChain model for openai/ prefix', () => {
      const model = adapter.createLangchainModel(
        { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' },
        'openai/gpt-4o',
        { temperature: 0.7 },
      );
      expect(model).toBeDefined();
    });

    it('throws for non-openai model prefix', () => {
      expect(() =>
        adapter.createLangchainModel(
          { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' },
          'anthropic/claude-sonnet-4-20250514',
        ),
      ).toThrow(/Only OpenAI models routed through Gateway/);
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' },
        'openai/dall-e-3',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { apiKey: 'gw_test', baseURL: 'https://gateway.ai.cloudflare.com/v1/test' },
        'openai/text-embedding-3-small',
      );
      expect(model).toBeDefined();
    });
  });
});
