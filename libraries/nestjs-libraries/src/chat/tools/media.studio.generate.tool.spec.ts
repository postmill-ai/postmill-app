import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { MediaStudioGenerateTool } from './media.studio.generate.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('MediaStudioGenerateTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('submits a generation job when provider is configured', async () => {
    const mediaStudio = {
      generate: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
    };
    const providerSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        credentials: { apiKey: 'secret' },
      }),
    };
    const tool = new MediaStudioGenerateTool(
      mediaStudio as any,
      providerSettings as any
    );

    const result = await executeTool(tool, {
      inputData: {
        provider: 'runway',
        operation: 'video',
        model: 'gen3-alpha',
        input: { prompt: 'a cat walking', duration: 5 },
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(providerSettings.getConfigForProvider).toHaveBeenCalledWith(org.id, 'runway');
    expect(mediaStudio.generate).toHaveBeenCalledWith(org.id, user.id, 'runway', {
      operation: 'video',
      model: 'gen3-alpha',
      input: { prompt: 'a cat walking', duration: 5 },
      mediaInputs: undefined,
      folderId: undefined,
    });
    expect(result).toEqual({
      jobId: 'job-123',
      status: 'submitted',
      note: 'poll with mediaJobStatus',
    });
  });

  it('returns an actionable error when provider is not configured', async () => {
    const mediaStudio = { generate: vi.fn() };
    const providerSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue(null),
    };
    const tool = new MediaStudioGenerateTool(
      mediaStudio as any,
      providerSettings as any
    );

    const result = await executeTool(tool, {
      inputData: {
        provider: 'runway',
        operation: 'video',
        input: { prompt: 'a cat walking' },
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(mediaStudio.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: 'runway is not configured. Add credentials in Settings → Media.',
    });
  });

  it('returns a draft (needsConfirmation) without creating a job in a UI session', async () => {
    const mediaStudio = { generate: vi.fn() };
    const providerSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        credentials: { apiKey: 'secret' },
      }),
    };
    const tool = new MediaStudioGenerateTool(
      mediaStudio as any,
      providerSettings as any
    );

    const result = await executeTool(tool, {
      inputData: {
        provider: 'runway',
        operation: 'video',
        model: 'gen3-alpha',
        input: { prompt: 'a cat walking', duration: 5 },
      },
      organization: org,
      user,
      access: { mode: 'user' },
      ui: true,
    });

    expect(result).toEqual({
      needsConfirmation: true,
      draft: {
        provider: 'runway',
        operation: 'video',
        model: 'gen3-alpha',
        input: { prompt: 'a cat walking', duration: 5 },
        mediaInputs: undefined,
        folderId: undefined,
      },
    });
    // No media job is started for an unconfirmed UI session — no unconfirmed spend.
    expect(mediaStudio.generate).not.toHaveBeenCalled();
  });

  it('still drafts in a UI session even when a model-supplied confirmed flag is passed', async () => {
    // Non-forgeable gate: `confirmed` is not an accepted input, so an LLM can't
    // self-approve spend. A UI session ALWAYS drafts; the human approves out-of-band
    // via the REST studio-generate route.
    const mediaStudio = {
      generate: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
    };
    const providerSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        credentials: { apiKey: 'secret' },
      }),
    };
    const tool = new MediaStudioGenerateTool(
      mediaStudio as any,
      providerSettings as any
    );

    const result = await executeTool(tool, {
      inputData: {
        provider: 'runway',
        operation: 'video',
        input: { prompt: 'a cat walking' },
        confirmed: true,
      },
      organization: org,
      user,
      access: { mode: 'user' },
      ui: true,
    });

    expect(result.needsConfirmation).toBe(true);
    expect(mediaStudio.generate).not.toHaveBeenCalled();
  });

  it('starts the job directly for a non-UI (MCP) session', async () => {
    const mediaStudio = {
      generate: vi.fn().mockResolvedValue({ jobId: 'job-456' }),
    };
    const providerSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        credentials: { apiKey: 'secret' },
      }),
    };
    const tool = new MediaStudioGenerateTool(
      mediaStudio as any,
      providerSettings as any
    );

    const result = await executeTool(tool, {
      inputData: {
        provider: 'runway',
        operation: 'video',
        input: { prompt: 'a cat walking' },
      },
      organization: org,
      user,
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      ui: false,
    });

    expect(mediaStudio.generate).toHaveBeenCalled();
    expect(result).toMatchObject({ jobId: 'job-456', status: 'submitted' });
  });

  it('denies write without access context', async () => {
    const tool = new MediaStudioGenerateTool(
      { generate: vi.fn() } as any,
      { getConfigForProvider: vi.fn() } as any
    );

    await expect(
      executeTool(tool, {
        inputData: { provider: 'runway', operation: 'video', input: {} },
        organization: org,
        user,
      })
    ).rejects.toThrow('Write access denied: no access context');
  });

  it('requires mcp:posts:write scope for mcp access', async () => {
    const tool = new MediaStudioGenerateTool(
      { generate: vi.fn() } as any,
      { getConfigForProvider: vi.fn() } as any
    );

    await expect(
      executeTool(tool, {
        inputData: { provider: 'runway', operation: 'video', input: {} },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('Write access denied: mcp:posts:write scope required');
  });
});
