import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSearchTool } from './rag.search.tool';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('RagSearchTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  let ragService: { search: ReturnType<typeof vi.fn> };
  let tool: RagSearchTool;

  beforeEach(() => {
    ragService = {
      search: vi.fn().mockResolvedValue([
        { text: 'snippet-1', sourceType: 'post', sourceId: 'post-1', score: 0.9 },
      ]),
    };
    tool = new RagSearchTool(ragService as unknown as RagService);
  });

  it('searches RAG and returns trimmed results', async () => {
    const result = await executeTool(tool, {
      inputData: { query: 'cats', limit: 3 },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(ragService.search).toHaveBeenCalledWith({
      organizationId: org.id,
      query: 'cats',
      limit: 3,
    });
    expect(result).toEqual({
      results: [{ text: 'snippet-1', sourceType: 'post', sourceId: 'post-1', score: 0.9 }],
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
