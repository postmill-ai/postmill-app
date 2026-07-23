import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'default' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { openaiCompatibleAiModule } from '../ai.adapter';
import { metadata } from '../metadata';

// SSRF-safe fetch stub: rejects by default so listModels exercises the
// static-catalog fallback instead of the network.
const makeCtx = (fetchImpl?: () => Promise<any>) =>
  ({ fetch: vi.fn(fetchImpl || (() => Promise.reject(new Error('no network')))) }) as any;

describe('openaiCompatibleAiModule', () => {
  let capability: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = openaiCompatibleAiModule.create(makeCtx());
  });

  describe('manifest & metadata', () => {
    it('declares a v1 active ai manifest for provider "openai-compatible"', () => {
      expect(openaiCompatibleAiModule.manifest).toMatchObject({
        domain: 'ai',
        providerId: 'openai-compatible',
        version: 'v1',
        displayName: 'OpenAI Compatible',
        status: 'active',
      });
    });

    it('metadata id matches the manifest providerId', () => {
      expect(metadata.id).toBe(openaiCompatibleAiModule.manifest.providerId);
      expect(metadata.kind).toBe('hub');
      expect(metadata.domains).toEqual(['ai']);
    });

    it('requires both apiKey and baseURL (no canonical endpoint)', () => {
      const fields = capability.credentialFields;
      const apiKey = fields.find((f: any) => f.key === 'apiKey');
      const baseURL = fields.find((f: any) => f.key === 'baseURL');
      expect(apiKey?.required).toBe(true);
      expect(apiKey?.type).toBe('password');
      expect(baseURL?.required).toBe(true);
      expect(baseURL?.placeholder).toBe('https://api.example.com/v1');
    });

    it('has text/tools capabilities only (generic endpoints vary)', () => {
      expect(capability.capabilities).toEqual({
        text: true,
        image: false,
        vision: false,
        embeddings: false,
        speech: false,
        tools: true,
      });
    });

    it('is a hub provider', () => {
      expect(capability.type).toBe('hub');
    });
  });

  describe('listModels', () => {
    it('falls back to the placeholder entry when the live fetch fails', async () => {
      const models = await capability.listModels({ apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' });
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('default');
      expect(models[0].kind).toBe('text');
    });

    it('does not throw on empty credentials', async () => {
      const models = await capability.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for empty apiKey', async () => {
      const result = await openaiCompatibleAiModule.validateCredentials!({ ...makeCtx(), credentials: {} } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('returns error when baseURL is missing (required for this provider)', async () => {
      const ctx = makeCtx(() => Promise.resolve({ ok: true, status: 200 }));
      const result = await openaiCompatibleAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-test' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Base URL is required to validate credentials');
    });

    it('maps a 401 to "Invalid API key"', async () => {
      const ctx = makeCtx(() => Promise.resolve({ ok: false, status: 401 }));
      const result = await openaiCompatibleAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-bad', baseURL: 'https://api.example.com/v1' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('returns ok: false on transport failure', async () => {
      const ctx = makeCtx(() => Promise.reject(new Error('ECONNREFUSED')));
      const result = await openaiCompatibleAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('model factories', () => {
    it('createLanguageModel returns a model', () => {
      const model = capability.createLanguageModel({ apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' }, 'my-model');
      expect(model).toBeDefined();
    });

    it('createLangchainModel returns a model', () => {
      const model = capability.createLangchainModel({ apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' }, 'my-model', { temperature: 0.7 });
      expect(model).toBeDefined();
    });
  });
});
