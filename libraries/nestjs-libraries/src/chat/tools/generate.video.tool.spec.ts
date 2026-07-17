import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateVideoTool } from './generate.video.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('GenerateVideoTool', () => {
  const org = makeOrganization();
  const user = makeUser();
  let aiDefaults: {
    textToVideo: ReturnType<typeof vi.fn>;
    imageToVideo: ReturnType<typeof vi.fn>;
  };
  let tool: GenerateVideoTool;

  beforeEach(() => {
    aiDefaults = {
      textToVideo: vi.fn().mockResolvedValue('artifact-1'),
      imageToVideo: vi.fn().mockResolvedValue('artifact-2'),
    };
    tool = new GenerateVideoTool(aiDefaults as any, {} as any);
  });

  it('generates a video from text in user mode', async () => {
    const res = await executeTool(tool, {
      inputData: { prompt: 'a sunset' },
      organization: org,
      user,
      access: { mode: 'user' },
    });
    expect(aiDefaults.textToVideo).toHaveBeenCalledWith(org.id, 'a sunset');
    expect(res).toEqual({ id: 'artifact-1' });
  });

  it('denies write in headless mode before any spend', async () => {
    await expect(
      executeTool(tool, {
        inputData: { prompt: 'a sunset' },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('headless runs are read-only');
    expect(aiDefaults.textToVideo).not.toHaveBeenCalled();
  });

  it('denies an mcp:read token', async () => {
    await expect(
      executeTool(tool, {
        inputData: { prompt: 'a sunset' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
    expect(aiDefaults.textToVideo).not.toHaveBeenCalled();
  });
});
