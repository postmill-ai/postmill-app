import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandMemorySearchTool } from './brand.memory.search.tool';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('BrandMemorySearchTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  let ragService: { searchBrandMemory: ReturnType<typeof vi.fn> };
  let tool: BrandMemorySearchTool;

  beforeEach(() => {
    ragService = {
      searchBrandMemory: vi.fn().mockResolvedValue([
        { text: 'best post', sourceType: 'brand_memory', sourceId: 'post-1', score: 0.95 },
      ]),
    };
    tool = new BrandMemorySearchTool(ragService as unknown as RagService);
  });

  it('searches brand memory and returns trimmed results', async () => {
    const result = await executeTool(tool, {
      inputData: { query: 'cats', limit: 3 },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(ragService.searchBrandMemory).toHaveBeenCalledWith(org.id, 'cats', 3);
    expect(result).toEqual({
      results: [{ text: 'best post', sourceType: 'brand_memory', sourceId: 'post-1', score: 0.95 }],
    });
  });

  it('denies read access when access context is missing', async () => {
    await expect(
      executeTool(tool, {
        inputData: { query: 'cats' },
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied: no access context');
  });
});
