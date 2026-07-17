import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args),
}));

import { GenerateImageTool } from './generate.image.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('GenerateImageTool', () => {
  const org = makeOrganization();
  const user = makeUser();
  let aiDefaults: { textToImage: ReturnType<typeof vi.fn> };
  let fileService: { saveFile: ReturnType<typeof vi.fn> };
  let storageService: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let tool: GenerateImageTool;

  beforeEach(() => {
    safeFetchMock.mockReset();
    aiDefaults = { textToImage: vi.fn().mockResolvedValue('https://cdn/img.png') };
    fileService = { saveFile: vi.fn().mockResolvedValue({ id: 'file-1', path: '/uploads/x.png' }) };
    storageService = {
      getLocalAdapterForOrg: vi
        .fn()
        .mockResolvedValue({ writeBuffer: vi.fn().mockResolvedValue('/uploads/x.png') }),
    };
    tool = new GenerateImageTool(aiDefaults as any, fileService as any, storageService as any);
  });

  const okResponse = () => ({
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  it('generates and saves an image in user mode', async () => {
    safeFetchMock.mockResolvedValue(okResponse());
    const res = await executeTool(tool, {
      inputData: { prompt: 'a cat' },
      organization: org,
      user,
      access: { mode: 'user' },
    });
    expect(aiDefaults.textToImage).toHaveBeenCalledWith(org.id, 'a cat');
    expect(res).toEqual({ id: 'file-1', path: '/uploads/x.png' });
  });

  it('denies write in headless mode before any spend', async () => {
    await expect(
      executeTool(tool, {
        inputData: { prompt: 'a cat' },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('headless runs are read-only');
    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
  });

  it('denies an mcp:read token', async () => {
    await expect(
      executeTool(tool, {
        inputData: { prompt: 'a cat' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared content-length before buffering', async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (k: string) =>
          k === 'content-length' ? String(600 * 1024 * 1024) : k === 'content-type' ? 'image/png' : null,
      },
      arrayBuffer: async () => {
        throw new Error('should not buffer');
      },
    });
    await expect(
      executeTool(tool, {
        inputData: { prompt: 'a cat' },
        organization: org,
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('exceeds the 512 MB limit');
  });
});
