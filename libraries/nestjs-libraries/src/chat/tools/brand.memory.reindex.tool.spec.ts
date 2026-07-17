import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandMemoryReindexTool } from './brand.memory.reindex.tool';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('BrandMemoryReindexTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  let ragService: {
    indexTopPerformingPosts: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  let tool: BrandMemoryReindexTool;

  beforeEach(() => {
    ragService = {
      indexTopPerformingPosts: vi.fn().mockResolvedValue({ indexed: 3 }),
      getStatus: vi.fn().mockResolvedValue({ indexedItems: 7 }),
    };
    tool = new BrandMemoryReindexTool(ragService as unknown as RagService);
  });

  it('reindexes top posts and returns indexed item count', async () => {
    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(ragService.indexTopPerformingPosts).toHaveBeenCalledWith(org.id);
    expect(ragService.getStatus).toHaveBeenCalledWith(org.id);
    expect(result).toEqual({ indexedItems: 7 });
  });

  it('requires mcp:posts:write scope', async () => {
    await expect(
      executeTool(tool, {
        inputData: {},
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('Write access denied: mcp:posts:write scope required');
  });

  it('denies write access in headless mode', async () => {
    await expect(
      executeTool(tool, {
        inputData: {},
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('Write access denied: headless runs are read-only');
  });
});
