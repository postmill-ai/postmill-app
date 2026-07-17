import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { MediaJobStatusTool } from './media.job.status.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('MediaJobStatusTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('lists jobs for a provider', async () => {
    const mediaStudio = {
      listJobs: vi.fn().mockResolvedValue([
        {
          id: 'job-1',
          operation: 'video',
          status: 'completed',
          fileId: 'file-1',
          error: null,
          artifactUrl: '/uploads/video.mp4',
          createdAt: new Date(),
        },
        {
          id: 'job-2',
          operation: 'video',
          status: 'pending',
          fileId: null,
          error: null,
          artifactUrl: null,
          createdAt: new Date(),
        },
      ]),
    };
    const lifecycle = { getJob: vi.fn() };
    const tool = new MediaJobStatusTool(mediaStudio as any, lifecycle as any);

    const result = await executeTool(tool, {
      inputData: { provider: 'runway' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(mediaStudio.listJobs).toHaveBeenCalledWith(org.id, 'runway');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'job-1',
      operation: 'video',
      status: 'completed',
      fileId: 'file-1',
      error: null,
    });
    expect(result[1]).toEqual({
      id: 'job-2',
      operation: 'video',
      status: 'pending',
      fileId: null,
      error: null,
    });
  });

  it('looks up a single job by id', async () => {
    const mediaStudio = { listJobs: vi.fn() };
    const lifecycle = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job-3',
        operation: 'image',
        status: 'failed',
        error: 'Provider error',
        organizationId: org.id,
      }),
    };
    const tool = new MediaJobStatusTool(mediaStudio as any, lifecycle as any);

    const result = await executeTool(tool, {
      inputData: { jobId: 'job-3' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(lifecycle.getJob).toHaveBeenCalledWith('job-3', org.id);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      {
        id: 'job-3',
        operation: 'image',
        status: 'failed',
        fileId: null,
        error: 'Provider error',
      },
    ]);
  });

  it('does not leak another tenant job (foreign organizationId → not found)', async () => {
    const lifecycle = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job-foreign',
        operation: 'image',
        status: 'failed',
        error: 'Provider error',
        organizationId: 'org-someone-else',
      }),
    };
    const tool = new MediaJobStatusTool({ listJobs: vi.fn() } as any, lifecycle as any);

    const result = await executeTool(tool, {
      inputData: { jobId: 'job-foreign' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toEqual({ error: 'Job job-foreign not found' });
  });

  it('returns the same not-found error for a missing and a foreign job (no oracle)', async () => {
    const missing = new MediaJobStatusTool(
      { listJobs: vi.fn() } as any,
      { getJob: vi.fn().mockResolvedValue(null) } as any
    );
    const result = await executeTool(missing, {
      inputData: { jobId: 'job-x' },
      organization: org,
      user,
      access: { mode: 'user' },
    });
    expect(result).toEqual({ error: 'Job job-x not found' });
  });

  it('returns an error when neither provider nor jobId is given', async () => {
    const tool = new MediaJobStatusTool(
      { listJobs: vi.fn() } as any,
      { getJob: vi.fn() } as any
    );

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toEqual({ error: 'Provide either provider or jobId' });
  });

  it('denies read without access context', async () => {
    const tool = new MediaJobStatusTool(
      { listJobs: vi.fn() } as any,
      { getJob: vi.fn() } as any
    );

    await expect(
      executeTool(tool, {
        inputData: { provider: 'runway' },
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied: no access context');
  });
});
