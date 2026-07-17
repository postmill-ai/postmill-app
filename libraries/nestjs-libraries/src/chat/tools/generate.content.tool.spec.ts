import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateContentTool } from './generate.content.tool';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';

describe('GenerateContentTool', () => {
  let aiDefaults: {
    lowReasoningText: ReturnType<typeof vi.fn>;
    highReasoningText: ReturnType<typeof vi.fn>;
  };
  let ragService: {
    searchBrandMemory: ReturnType<typeof vi.fn>;
  };
  let tool: GenerateContentTool;

  beforeEach(() => {
    aiDefaults = {
      lowReasoningText: vi.fn().mockResolvedValue('Low reasoning caption'),
      highReasoningText: vi.fn().mockResolvedValue('High reasoning caption'),
    };
    ragService = {
      searchBrandMemory: vi.fn().mockResolvedValue([]),
    };
    tool = new GenerateContentTool(
      aiDefaults as unknown as AiDefaultsService,
      ragService as unknown as RagService,
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

  it('generates low-reasoning text by default', async () => {
    const t = tool.run();
    const res = await t.execute(
      { prompt: 'Write a caption about cats' },
      makeContext() as any
    );

    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith(
      'org-1',
      'Write a caption about cats'
    );
    expect(aiDefaults.highReasoningText).not.toHaveBeenCalled();
    expect(res).toEqual({ content: 'Low reasoning caption' });
  });

  it('generates high-reasoning text when requested', async () => {
    const t = tool.run();
    const res = await t.execute(
      { prompt: 'Write a long-form post', reasoning: 'high' },
      makeContext() as any
    );

    expect(aiDefaults.highReasoningText).toHaveBeenCalledWith(
      'org-1',
      'Write a long-form post'
    );
    expect(aiDefaults.lowReasoningText).not.toHaveBeenCalled();
    expect(res).toEqual({ content: 'High reasoning caption' });
  });

  it('allows read access in headless mode', async () => {
    const t = tool.run();
    const res = await t.execute(
      { prompt: 'Headline' },
      makeContext({ mode: 'headless' }) as any
    );

    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith('org-1', 'Headline');
    expect(res).toEqual({ content: 'Low reasoning caption' });
  });

  it('allows read access for mcp with mcp:read scope', async () => {
    const t = tool.run();
    const res = await t.execute(
      { prompt: 'Headline' },
      makeContext({ mode: 'mcp', scopes: ['mcp:read'] }) as any
    );

    expect(res).toEqual({ content: 'Low reasoning caption' });
  });

  it('denies read access when access context is missing', async () => {
    const t = tool.run();
    await expect(
      t.execute(
        { prompt: 'x' },
        { requestContext: { get: () => undefined } } as any
      )
    ).rejects.toThrow('Read access denied: no access context');
  });

  it('denies read access for mcp without mcp:read scope', async () => {
    const t = tool.run();
    await expect(
      t.execute(
        { prompt: 'x' },
        makeContext({ mode: 'mcp', scopes: ['mcp:posts:write'] }) as any
      )
    ).rejects.toThrow('Read access denied: mcp:read scope required');
  });

  it('throws when organization context is missing', async () => {
    const t = tool.run();
    await expect(
      t.execute(
        { prompt: 'x' },
        {
          requestContext: {
            get: (key: string) => {
              if (key === 'access') return JSON.stringify({ mode: 'user' });
              return undefined;
            },
          },
        } as any
      )
    ).rejects.toThrow('Organization context missing');
  });

  it('searches brand memory and prepends exemplars when results exist', async () => {
    ragService.searchBrandMemory.mockResolvedValue([
      { text: 'Our best post ever.', sourceType: 'brand_memory', sourceId: 'post-1', score: 0.9 },
      { text: 'Another hit.', sourceType: 'brand_memory', sourceId: 'post-2', score: 0.8 },
    ]);

    const t = tool.run();
    const res = await t.execute(
      { prompt: 'Write a caption about cats' },
      makeContext() as any
    );

    expect(ragService.searchBrandMemory).toHaveBeenCalledWith('org-1', 'Write a caption about cats', 5);
    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith(
      'org-1',
      expect.stringContaining('Here are some past top-performing posts to echo:')
    );
    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith(
      'org-1',
      expect.stringContaining('Our best post ever.')
    );
    expect(res).toEqual({ content: 'Low reasoning caption' });
  });

  it('falls back to original prompt when brand memory is empty', async () => {
    ragService.searchBrandMemory.mockResolvedValue([]);

    const t = tool.run();
    await t.execute({ prompt: 'Write a caption about cats' }, makeContext() as any);

    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith('org-1', 'Write a caption about cats');
  });

  it('falls back to original prompt when brand memory search fails', async () => {
    ragService.searchBrandMemory.mockRejectedValue(new Error('RAG disabled'));

    const t = tool.run();
    await t.execute({ prompt: 'Write a caption about cats' }, makeContext() as any);

    expect(aiDefaults.lowReasoningText).toHaveBeenCalledWith('org-1', 'Write a caption about cats');
  });
});
