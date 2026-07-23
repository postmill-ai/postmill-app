import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'nvidia/nemotron-3-super-120b-a12b' })),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { nvidiaAiModule } from '../ai.adapter';
import { metadata } from '../metadata';

// SSRF-safe fetch stub: rejects by default so listModels exercises the
// static-catalog fallback instead of the network.
const makeCtx = (fetchImpl?: () => Promise<any>) =>
  ({ fetch: vi.fn(fetchImpl || (() => Promise.reject(new Error('no network')))) }) as any;

describe('nvidiaAiModule', () => {
  let capability: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = nvidiaAiModule.create(makeCtx());
  });

  describe('manifest & metadata', () => {
    it('declares a v1 active ai manifest for provider "nvidia"', () => {
      expect(nvidiaAiModule.manifest).toMatchObject({
        domain: 'ai',
        providerId: 'nvidia',
        version: 'v1',
        displayName: 'NVIDIA Nemotron',
        status: 'active',
      });
    });

    it('metadata id matches the manifest providerId', () => {
      expect(metadata.id).toBe(nvidiaAiModule.manifest.providerId);
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
      expect(baseURL?.placeholder).toBe('https://integrate.api.nvidia.com/v1');
    });

    it('has text/tools capabilities (no image, vision, embeddings, or speech)', () => {
      expect(capability.capabilities).toEqual({
        text: true,
        image: false,
        vision: false,
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

      const super120b = models.find((m: any) => m.id === 'nvidia/nemotron-3-super-120b-a12b');
      expect(super120b).toBeDefined();
      expect(super120b?.kind).toBe('text');
      expect(super120b?.reasoning).toBe(true);

      const instruct = models.find((m: any) => m.id === 'nvidia/llama-3.1-nemotron-70b-instruct');
      expect(instruct).toBeDefined();
      expect(instruct?.reasoning).toBeUndefined();
    });

    it('does not throw on empty credentials', async () => {
      const models = await capability.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for empty apiKey', async () => {
      const result = await nvidiaAiModule.validateCredentials!({ ...makeCtx(), credentials: {} } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('maps a 401 to "Invalid API key"', async () => {
      const ctx = makeCtx(() => Promise.resolve({ ok: false, status: 401 }));
      const result = await nvidiaAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-bad' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('returns ok: false on transport failure', async () => {
      const ctx = makeCtx(() => Promise.reject(new Error('ECONNREFUSED')));
      const result = await nvidiaAiModule.validateCredentials!({ ...ctx, credentials: { apiKey: 'sk-test' } } as any);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('model factories', () => {
    it('createLanguageModel returns a model', () => {
      const model = capability.createLanguageModel({ apiKey: 'sk-test' }, 'nvidia/nemotron-3-super-120b-a12b');
      expect(model).toBeDefined();
    });

    it('createLangchainModel returns a model', () => {
      const model = capability.createLangchainModel({ apiKey: 'sk-test' }, 'nvidia/llama-3.3-nemotron-super-49b-v1.5', { temperature: 0.6 });
      expect(model).toBeDefined();
    });
  });
});
