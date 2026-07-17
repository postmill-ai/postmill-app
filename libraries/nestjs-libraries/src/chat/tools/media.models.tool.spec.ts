import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ListMediaModelsTool } from './media.models.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('ListMediaModelsTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('returns models for a provider and operation', async () => {
    const service = {
      listModels: vi.fn().mockResolvedValue([
        { id: 'gen3-alpha', label: 'Gen-3 Alpha' },
        { id: 'gen3-alpha-turbo', label: 'Gen-3 Alpha Turbo' },
      ]),
    };
    const tool = new ListMediaModelsTool(service as any);

    const result = await executeTool(tool, {
      inputData: { provider: 'runway', operation: 'video' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(service.listModels).toHaveBeenCalledWith(org.id, 'runway', 'video');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'gen3-alpha', label: 'Gen-3 Alpha' });
  });

  it('denies read without access context', async () => {
    const tool = new ListMediaModelsTool({ listModels: vi.fn() } as any);

    await expect(
      executeTool(tool, {
        inputData: { provider: 'runway', operation: 'video' },
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied: no access context');
  });
});
