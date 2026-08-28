import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ListMediaProvidersTool } from './media.providers.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('ListMediaProvidersTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  const noDefaults = {
    getMediaDefaults: vi.fn().mockResolvedValue({ categories: [] }),
  };

  it('returns configured and enabled providers', async () => {
    const service = {
      getProviders: vi.fn().mockResolvedValue([
        {
          identifier: 'runway',
          name: 'Runway',
          capabilities: { video: true },
          enabled: true,
          isConfigured: true,
        },
        {
          identifier: 'luma',
          name: 'Luma',
          capabilities: { video: true },
          enabled: true,
          isConfigured: false,
        },
        {
          identifier: 'openai',
          name: 'OpenAI',
          capabilities: { image: true, audio: true },
          enabled: false,
          isConfigured: true,
        },
      ]),
    };
    const tool = new ListMediaProvidersTool(service as any, noDefaults as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      identifier: 'runway',
      name: 'Runway',
      capabilities: { video: true },
      defaults: [],
    });
  });

  it('attaches the org defaults for the provider and survives a defaults-service failure', async () => {
    const service = {
      getProviders: vi.fn().mockResolvedValue([
        {
          identifier: 'openrouter',
          name: 'OpenRouter',
          capabilities: { image: true },
          enabled: true,
          isConfigured: true,
        },
      ]),
    };
    const defaults = {
      getMediaDefaults: vi.fn().mockResolvedValue({
        categories: [
          { category: 'text-to-image', providerId: 'openrouter', model: 'google/gemini-2.5-flash-image' },
          { category: 'image-to-image', providerId: 'openrouter', model: 'google/gemini-2.5-flash-image' },
          { category: 'text-to-video', providerId: 'runway', model: 'gen4' },
          { category: 'text-to-speech', source: null },
        ],
      }),
    };
    const tool = new ListMediaProvidersTool(service as any, defaults as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result[0].defaults).toEqual([
      { category: 'text-to-image', model: 'google/gemini-2.5-flash-image' },
      { category: 'image-to-image', model: 'google/gemini-2.5-flash-image' },
    ]);

    const failing = { getMediaDefaults: vi.fn().mockRejectedValue(new Error('redis down')) };
    const tool2 = new ListMediaProvidersTool(service as any, failing as any);
    const result2 = await executeTool(tool2, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });
    expect(result2[0].defaults).toEqual([]);
  });

  it('denies read without access context', async () => {
    const tool = new ListMediaProvidersTool({ getProviders: vi.fn() } as any, noDefaults as any);

    await expect(
      executeTool(tool, { inputData: {}, organization: org, user })
    ).rejects.toThrow('Read access denied: no access context');
  });

  it('denies mcp read without mcp:read scope', async () => {
    const tool = new ListMediaProvidersTool({ getProviders: vi.fn() } as any, noDefaults as any);

    await expect(
      executeTool(tool, {
        inputData: {},
        organization: org,
        user,
        access: { mode: 'mcp', scopes: [] },
      })
    ).rejects.toThrow('Read access denied: mcp:read scope required');
  });
});
