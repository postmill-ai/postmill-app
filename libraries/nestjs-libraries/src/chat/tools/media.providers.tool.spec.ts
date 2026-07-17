import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ListMediaProvidersTool } from './media.providers.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('ListMediaProvidersTool', () => {
  const org = makeOrganization();
  const user = makeUser();

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
    const tool = new ListMediaProvidersTool(service as any);

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
    });
  });

  it('denies read without access context', async () => {
    const tool = new ListMediaProvidersTool({ getProviders: vi.fn() } as any);

    await expect(
      executeTool(tool, { inputData: {}, organization: org, user })
    ).rejects.toThrow('Read access denied: no access context');
  });

  it('denies mcp read without mcp:read scope', async () => {
    const tool = new ListMediaProvidersTool({ getProviders: vi.fn() } as any);

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
