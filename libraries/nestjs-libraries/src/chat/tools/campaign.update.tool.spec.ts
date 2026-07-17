import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CampaignUpdateTool } from './campaign.update.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

describe('CampaignUpdateTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('updates a campaign and returns id/name', async () => {
    const campaignsService = {
      update: vi.fn().mockResolvedValue({ id: 'c1', name: 'Renamed' }),
    };
    const tool = new CampaignUpdateTool(campaignsService as any);

    const result = await executeTool(tool, {
      inputData: {
        id: 'c1',
        name: 'Renamed',
        archived: true,
        endDate: '2026-02-28T00:00:00.000Z',
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(campaignsService.update).toHaveBeenCalledWith(
      'c1',
      org.id,
      expect.objectContaining({
        name: 'Renamed',
        archived: true,
        endDate: new Date('2026-02-28T00:00:00.000Z'),
      })
    );
    expect(result).toEqual({ id: 'c1', name: 'Renamed' });
  });

  it('denies write without the required scope', async () => {
    const tool = new CampaignUpdateTool({ update: vi.fn() } as any);

    await expect(
      executeTool(tool, {
        inputData: { id: 'c1', name: 'Renamed' },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('headless runs are read-only');
  });

  it('propagates service errors', async () => {
    const campaignsService = {
      update: vi.fn().mockRejectedValue(new Error('update failed')),
    };
    const tool = new CampaignUpdateTool(campaignsService as any);

    await expect(
      executeTool(tool, {
        inputData: { id: 'c1', name: 'Renamed' },
        organization: org,
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('update failed');
  });
});
