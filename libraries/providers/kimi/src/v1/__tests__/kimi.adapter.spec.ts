import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'kimi-k2-0905-preview' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { kimiAiModule } from '../ai.adapter';
import { metadata } from '../metadata';

// SSRF-safe fetch stub: rejects by default so listModels exercises the
// static-catalog fallback instead of the network.
const makeCtx = (fetchImpl?: () => Promise<any>) =>
  ({ fetch: vi.fn(fetchImpl || (() => Promise.reject(new Error('no network')))) }) as any;

describe('kimiAiModule', () => {
  let capability: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = kimiAiModule.create(makeCtx());
  });

  describe('manifest & metadata', () => {
    it('declares a v1 active ai manifest for provider "kimi"', () => {
      expect(kimiAiModule.manifest).toMatchObject({
        domain: 'ai',
        providerId: 'kimi',
        version: 'v1',
        displayName: 'Moonshot Kimi',
        status: 'active',
      });
    });

    it('metadata id matches the manifest providerId', () => {
      expect(metadata.id).toBe(kimiAiModule.manifest.providerId);
      expect(metadata.kind).toBe('direct');
      expect(metadata.domains).toEqual(['ai']);
    });

    it('has credentialFields with required apiKey and optional baseURL', () => {
      const fields = capability.credentialFields;
      const apiKey = fields.find((f: any) => f.key === 'apiKey');
      const baseURL = fields.find((f: any) => f.key === 'baseURL');
      expect(apiKey?.required).toBe(true);
      expect(apiKey?.type).toBe('password');
      expect(baseURL?.required).toBe(false);
      expect(baseURL?.placeholder).toBe('https://api.moonshot.ai/v1');
    });

    it('has text/vision/tools capabilities (no image, embeddings, or speech)', () => {
      expect(capability.capabilities).toEqual({
        text: true,
        image: false,
        vision: true,
        embeddings: false,
        speech: false,
        tools: true,
      });
    });

    it('is a direct provider', () => {
      expect(capability.type).toBe('direct');
    });
  });

  describe('listModels', () => {
    it('falls back to the curated catalog when the live fetch fails', async () => {
      const models = await capability.listModels({ apiKey: 'sk-test' });
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const k2 = models.find((m: any) => m.id === 'kimi-k2-0905-preview');
      expect(k2).toBeDefined();
      expect(k2?.kind).toBe('text');

      const thinking = models.find((m: any) => m.id === 'kimi-k2-thinking');
      expect(thinking?.reasoning).toBe(true);

      const legacy = models.find((m: any) => m.id === 'moonshot-v1-128k');
      expect(legacy).toBeDefined();
    });

    it('does not throw on empty credentials', async () => {
      const models = await capability.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for empty apiKey', async () => {
      const result = await kimiAiModule.validateCredentials!({ ...makeCtx(), credentials: {} } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('maps a 401 to "Invalid API key"', async () => {
      const ctx = makeCtx(() => Promise.resolve({ ok: false, status: 401 }));
      const result = await kimiAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-bad' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('returns ok: false on transport failure', async () => {
      const ctx = makeCtx(() => Promise.reject(new Error('ECONNREFUSED')));
      const result = await kimiAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-test' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('model factories', () => {
    it('createLanguageModel returns a model', () => {
      const model = capability.createLanguageModel({ apiKey: 'sk-test' }, 'kimi-k2-0905-preview');
      expect(model).toBeDefined();
    });

    it('createLangchainModel returns a model', () => {
      const model = capability.createLangchainModel({ apiKey: 'sk-test' }, 'kimi-k2-0905-preview', { temperature: 0.7 });
      expect(model).toBeDefined();
    });
  });
});
