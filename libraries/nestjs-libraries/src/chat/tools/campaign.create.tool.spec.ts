import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CampaignCreateTool } from './campaign.create.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

describe('CampaignCreateTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('creates a campaign and returns id/name', async () => {
    const campaignsService = {
      create: vi.fn().mockResolvedValue({ id: 'c1', name: 'Launch' }),
    };
    const tool = new CampaignCreateTool(campaignsService as any);

    const result = await executeTool(tool, {
      inputData: {
        name: 'Launch',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
        tags: ['paid'],
        goals: [{ metric: 'views', target: 1000 }],
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(campaignsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org.id,
        createdById: user.id,
        name: 'Launch',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-01-31T00:00:00.000Z'),
        tags: ['paid'],
        goals: [{ metric: 'views', target: 1000 }],
      })
    );
    expect(result).toEqual({ id: 'c1', name: 'Launch' });
  });

  it('denies write without the required scope', async () => {
    const tool = new CampaignCreateTool({ create: vi.fn() } as any);

    await expect(
      executeTool(tool, {
        inputData: { name: 'Launch' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
  });

  it('propagates service errors', async () => {
    const campaignsService = {
      create: vi.fn().mockRejectedValue(new Error('create failed')),
    };
    const tool = new CampaignCreateTool(campaignsService as any);

    await expect(
      executeTool(tool, {
        inputData: { name: 'Launch' },
        organization: org,
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('create failed');
  });
});
