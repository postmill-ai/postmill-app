import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CampaignTagTool } from './campaign.tag.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

describe('CampaignTagTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('tags an entity on a campaign', async () => {
    const tagService = {
      tagItem: vi.fn().mockResolvedValue({ success: true }),
      untagItem: vi.fn(),
    };
    const tool = new CampaignTagTool(tagService as any);

    const result = await executeTool(tool, {
      inputData: {
        campaignId: 'c1',
        action: 'tag',
        entityType: 'file',
        entityId: 'f1',
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(tagService.tagItem).toHaveBeenCalledWith(
      org.id,
      'c1',
      user.id,
      'file',
      'f1'
    );
    expect(tagService.untagItem).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('untags an entity from a campaign', async () => {
    const tagService = {
      tagItem: vi.fn(),
      untagItem: vi.fn().mockResolvedValue({ success: true }),
    };
    const tool = new CampaignTagTool(tagService as any);

    const result = await executeTool(tool, {
      inputData: {
        campaignId: 'c1',
        action: 'untag',
        entityType: 'channel',
        entityId: 'i1',
      },
      organization: org,
      user,
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(tagService.untagItem).toHaveBeenCalledWith(
      org.id,
      'c1',
      user.id,
      'channel',
      'i1'
    );
    expect(tagService.tagItem).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('denies write without the required scope', async () => {
    const tool = new CampaignTagTool({ tagItem: vi.fn(), untagItem: vi.fn() } as any);

    await expect(
      executeTool(tool, {
        inputData: {
          campaignId: 'c1',
          action: 'tag',
          entityType: 'file',
          entityId: 'f1',
        },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
  });

  it('propagates service errors', async () => {
    const tagService = {
      tagItem: vi.fn().mockRejectedValue(new Error('tag failed')),
      untagItem: vi.fn(),
    };
    const tool = new CampaignTagTool(tagService as any);

    await expect(
      executeTool(tool, {
        inputData: {
          campaignId: 'c1',
          action: 'tag',
          entityType: 'file',
          entityId: 'f1',
        },
        organization: org,
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('tag failed');
  });
});
