import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { RunGeneratorTool } from '../run.generator.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

async function* streamOf(...events: any[]) {
  for (const event of events) yield event;
}

describe('RunGeneratorTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('denies a headless run when isPicture is true (image generation = spend/write)', async () => {
    const agentGraphService = { start: vi.fn() };
    const ragService = { searchBrandMemory: vi.fn() };
    const tool = new RunGeneratorTool(agentGraphService as any, ragService as any);

    await expect(
      executeTool(tool, {
        inputData: {
          research: 'write something great about launches',
          isPicture: true,
          format: 'one_short',
          tone: 'personal',
        },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow(/Write access denied/);

    // Never reached the generator — no spend.
    expect(agentGraphService.start).not.toHaveBeenCalled();
  });

  it('proceeds on a headless text-only run (isPicture absent → read-only ok)', async () => {
    const ragService = { searchBrandMemory: vi.fn().mockResolvedValue([]) };
    const agentGraphService = {
      start: vi
        .fn()
        .mockReturnValue(
          streamOf({ data: { output: { content: [{ content: 'hello world' }] } } })
        ),
    };
    const tool = new RunGeneratorTool(agentGraphService as any, ragService as any);

    const result = await executeTool(tool, {
      inputData: {
        research: 'write something great about launches',
        format: 'one_short',
        tone: 'personal',
      },
      organization: org,
      user,
      access: { mode: 'headless' },
    });

    expect(agentGraphService.start).toHaveBeenCalledWith(
      org.id,
      expect.objectContaining({ isPicture: false })
    );
    expect(result).toEqual({ content: ['hello world'], pictureFileIds: [] });
  });
});
