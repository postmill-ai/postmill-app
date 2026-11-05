import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    languageModel: vi.fn(() => ({ modelId: 'demonroute-model' })),
    chat: vi.fn(() => ({ modelId: 'demonroute-model' })),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(function() { return {}; }),
}));

import { demonrouteAiModule } from '../ai.adapter';
import { metadata } from '../metadata';

const makeCtx = (fetchImpl?: () => Promise<any>) => ({
  fetch: vi.fn(fetchImpl || (() => Promise.reject(new Error('no network')))),
}) as any;

describe('Demon Route AI adapter', () => {
  let capability: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capability = demonrouteAiModule.create(makeCtx());
  });

  it('declares an active hub with live model discovery metadata', () => {
    expect(demonrouteAiModule.manifest).toMatchObject({
      domain: 'ai',
      providerId: 'demonroute',
      version: 'v1',
      status: 'active',
      displayName: 'Demon Route',
    });
    expect(metadata).toMatchObject({ id: 'demonroute', kind: 'hub', hasModelList: true });
    expect(capability.type).toBe('hub');
    expect(capability.credentialFields.find((field: any) => field.key === 'apiKey')).toMatchObject({
      required: true,
      type: 'password',
    });
  });

  it('falls back to a known open-weight model when live discovery is unavailable', async () => {
    const models = await capability.listModels({ apiKey: 'test-key' });
    expect(models.map((model: any) => model.id)).toContain('NousResearch/Hermes-3-Llama-3.1-8B');
  });

  it('merges models returned by the OpenAI-compatible live endpoint', async () => {
    capability = demonrouteAiModule.create(makeCtx(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: [{ id: 'TheDrummer/Cydonia-24B-v4.2.0' }],
      }),
    })));
    const models = await capability.listModels({ apiKey: 'test-key' });
    expect(models.map((model: any) => model.id)).toContain('TheDrummer/Cydonia-24B-v4.2.0');
  });

  it('validates credentials through the injected fetch', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const result = await demonrouteAiModule.validateCredentials!({
      fetch,
      credentials: { apiKey: 'test-key' },
    } as any);
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.demonroute.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
  });

  it('maps invalid and missing credentials without exposing the key', async () => {
    const missing = await demonrouteAiModule.validateCredentials!({
      ...makeCtx(),
      credentials: {},
    } as any);
    expect(missing).toEqual({ ok: false, error: 'API key is required' });

    const invalid = await demonrouteAiModule.validateCredentials!({
      ...makeCtx(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('') })),
      credentials: { apiKey: 'secret-key' },
    } as any);
    expect(invalid).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('creates both language-model clients', () => {
    expect(capability.createLanguageModel({ apiKey: 'test-key' }, 'open-weight-model')).toBeDefined();
    expect(capability.createLangchainModel({ apiKey: 'test-key' }, 'open-weight-model')).toBeDefined();
  });
});
