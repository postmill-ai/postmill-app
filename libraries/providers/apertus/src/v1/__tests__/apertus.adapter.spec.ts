import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'swiss-ai/apertus-8b-instruct' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { apertusAiModule } from '../ai.adapter';
import { metadata } from '../metadata';

// SSRF-safe fetch stub: rejects by default so listModels exercises the
// static-catalog fallback instead of the network.
const makeCtx = (fetchImpl?: () => Promise<any>) =>
  ({ fetch: vi.fn(fetchImpl || (() => Promise.reject(new Error('no network')))) }) as any;

describe('apertusAiModule', () => {
  let capability: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = apertusAiModule.create(makeCtx());
  });

  describe('manifest & metadata', () => {
    it('declares a v1 active ai manifest for provider "apertus"', () => {
      expect(apertusAiModule.manifest).toMatchObject({
        domain: 'ai',
        providerId: 'apertus',
        version: 'v1',
        displayName: 'Apertus',
        status: 'active',
      });
    });

    it('metadata id matches the manifest providerId', () => {
      expect(metadata.id).toBe(apertusAiModule.manifest.providerId);
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
      expect(baseURL?.placeholder).toBe('https://api.publicai.co/v1');
    });

    it('is text-only with tools disabled (Apertus has no standard tool calling)', () => {
      expect(capability.capabilities).toEqual({
        text: true,
        image: false,
        vision: false,
        embeddings: false,
        speech: false,
        tools: false,
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

      const small = models.find((m: any) => m.id === 'swiss-ai/apertus-8b-instruct');
      expect(small).toBeDefined();
      expect(small?.kind).toBe('text');

      const large = models.find((m: any) => m.id === 'swiss-ai/apertus-70b-instruct');
      expect(large).toBeDefined();
      expect(large?.capabilities.tools).toBe(false);
    });

    it('does not throw on empty credentials', async () => {
      const models = await capability.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for empty apiKey', async () => {
      const result = await apertusAiModule.validateCredentials!({ ...makeCtx(), credentials: {} } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('maps a 401 to "Invalid API key"', async () => {
      const ctx = makeCtx(() => Promise.resolve({ ok: false, status: 401 }));
      const result = await apertusAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-bad' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('returns ok: false on transport failure', async () => {
      const ctx = makeCtx(() => Promise.reject(new Error('ECONNREFUSED')));
      const result = await apertusAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-test' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('model factories', () => {
    it('createLanguageModel returns a model', () => {
      const model = capability.createLanguageModel({ apiKey: 'sk-test' }, 'swiss-ai/apertus-8b-instruct');
      expect(model).toBeDefined();
    });

    it('createLangchainModel returns a model', () => {
      const model = capability.createLangchainModel({ apiKey: 'sk-test' }, 'swiss-ai/apertus-70b-instruct', { temperature: 0.8, topP: 0.9 });
      expect(model).toBeDefined();
    });
  });
});
