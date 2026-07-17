import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunGeneratorTool } from './run.generator.tool';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';

describe('RunGeneratorTool', () => {
  let agentGraphService: {
    start: ReturnType<typeof vi.fn>;
  };
  let ragService: {
    searchBrandMemory: ReturnType<typeof vi.fn>;
  };
  let tool: RunGeneratorTool;

  beforeEach(() => {
    agentGraphService = {
      start: vi.fn(),
    };
    ragService = {
      searchBrandMemory: vi.fn(),
    };
    tool = new RunGeneratorTool(
      agentGraphService as unknown as AgentGraphService,
      ragService as unknown as RagService
    );
  });

  const makeContext = (access: Record<string, any> = { mode: 'user' }) => ({
    requestContext: {
      get: (key: string) => {
        if (key === 'organization') return JSON.stringify({ id: 'org-1' });
        if (key === 'user') return JSON.stringify({ id: 'user-1' });
        if (key === 'access') return JSON.stringify(access);
        return undefined;
      },
    },
  });

  it('streams events and returns content plus picture file ids', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield { event: 'on_chain_start', data: { input: {} } };
        // streamed values events carry state under data.chunk
        yield {
          event: 'on_chain_stream',
          data: {
            chunk: {
              content: [
                { content: 'First post', hook: 'H1', prompt: 'P1', image: undefined },
                {
                  content: 'Second post',
                  hook: 'H2',
                  prompt: 'P2',
                  image: { id: 'file-1' },
                },
              ],
            },
          },
        };
        // terminal event carries the final state under data.output
        yield {
          event: 'on_chain_end',
          data: {
            output: {
              content: [
                { content: 'Final post', hook: 'H3', prompt: 'P3', image: { id: 'file-2' } },
              ],
            },
          },
        };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Write about AI trends',
        format: 'one_long',
        tone: 'company',
      },
      makeContext() as any
    );

    expect(ragService.searchBrandMemory).toHaveBeenCalledWith(
      'org-1',
      'Write about AI trends',
      5
    );
    expect(agentGraphService.start).toHaveBeenCalledWith('org-1', {
      research: 'Write about AI trends',
      isPicture: false,
      format: 'one_long',
      tone: 'company',
    });
    expect(res).toEqual({
      content: ['Final post'],
      pictureFileIds: ['file-2'],
    });
  });

  it('defaults isPicture to true when provided', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield {
          event: 'on_chain_stream',
          data: {
            chunk: {
              content: [
                { content: 'Post with picture', image: { id: 'file-pic' } },
              ],
            },
          },
        };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Write about cats',
        isPicture: true,
        format: 'one_short',
        tone: 'personal',
      },
      makeContext() as any
    );

    expect(agentGraphService.start).toHaveBeenCalledWith('org-1', {
      research: 'Write about cats',
      isPicture: true,
      format: 'one_short',
      tone: 'personal',
    });
    expect(res).toEqual({
      content: ['Post with picture'],
      pictureFileIds: ['file-pic'],
    });
  });

  it('returns empty content when the stream yields no state', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield { event: 'on_chain_start', data: {} };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Short brief',
        format: 'thread_short',
        tone: 'company',
      },
      makeContext() as any
    );

    expect(res).toEqual({ content: [] });
  });

  it('returns empty content when final state has no content items', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield { event: 'on_chain_end', data: { output: { content: [] } } };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Another brief',
        format: 'one_short',
        tone: 'personal',
      },
      makeContext() as any
    );

    expect(res).toEqual({ content: [] });
  });

  it('denies read access when access context is missing', async () => {
    const t = tool.run();
    await expect(
      t.execute(
        {
          research: 'Write about AI',
          format: 'one_long',
          tone: 'company',
        },
        { requestContext: { get: () => undefined } } as any
      )
    ).rejects.toThrow('Read access denied: no access context');
  });

  it('allows read access for mcp with mcp:read scope', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield {
          event: 'on_chain_stream',
          data: {
            chunk: { content: [{ content: 'MCP post', image: undefined }] },
          },
        };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Write about dogs',
        format: 'one_short',
        tone: 'personal',
      },
      makeContext({ mode: 'mcp', scopes: ['mcp:read'] }) as any
    );

    expect(res).toEqual({ content: ['MCP post'], pictureFileIds: [] });
  });

  it('prepends brand-memory exemplars to research when RAG returns results', async () => {
    ragService.searchBrandMemory.mockResolvedValue([
      { text: 'Past post one', sourceType: 'brand_memory', sourceId: 'p1', score: 0.9 },
      { text: 'Past post two\nwith newline', sourceType: 'brand_memory', sourceId: 'p2', score: 0.8 },
    ]);
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield {
          event: 'on_chain_stream',
          data: {
            chunk: { content: [{ content: 'Grounded post', image: undefined }] },
          },
        };
      })()
    );

    const t = tool.run();
    await t.execute(
      {
        research: 'Write about AI trends',
        format: 'one_long',
        tone: 'company',
      },
      makeContext() as any
    );

    expect(ragService.searchBrandMemory).toHaveBeenCalledWith(
      'org-1',
      'Write about AI trends',
      5
    );
    expect(agentGraphService.start).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        research:
          'Here are some past top-performing posts to echo in style:\n- Past post one\n- Past post two with newline\n\nWrite about AI trends',
      })
    );
  });

  it('falls back to original research when RAG throws', async () => {
    ragService.searchBrandMemory.mockRejectedValue(new Error('RAG disabled'));
    agentGraphService.start.mockReturnValue(
      (async function* () {
        yield {
          event: 'on_chain_stream',
          data: {
            chunk: { content: [{ content: 'Fallback post', image: undefined }] },
          },
        };
      })()
    );

    const t = tool.run();
    const res = await t.execute(
      {
        research: 'Write about AI trends',
        format: 'one_long',
        tone: 'company',
      },
      makeContext() as any
    );

    expect(agentGraphService.start).toHaveBeenCalledWith('org-1', {
      research: 'Write about AI trends',
      isPicture: false,
      format: 'one_long',
      tone: 'company',
    });
    expect(res).toEqual({ content: ['Fallback post'], pictureFileIds: [] });
  });
});
