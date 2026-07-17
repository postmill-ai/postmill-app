import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { UploadFromUrlTool } from '../upload.from.url.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

describe('UploadFromUrlTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an oversized declared content-length without buffering the body', async () => {
    const arrayBuffer = vi.fn();
    const response = {
      ok: true,
      headers: new Headers({
        'content-length': String(600 * 1024 * 1024), // 600 MB > 512 MB cap
      }),
      arrayBuffer,
    };
    // vitest.setup routes undici.fetch (and thus safeFetch) to globalThis.fetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const storageService = { getLocalAdapterForOrg: vi.fn() };
    const fileService = { saveFile: vi.fn() };
    const tool = new UploadFromUrlTool(fileService as any, storageService as any);

    const result = await executeTool(tool, {
      inputData: { url: 'https://example.com/huge.mp4' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toEqual({ error: 'File exceeds the 512 MB upload limit' });
    // Rejected before reading the body or touching storage.
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(storageService.getLocalAdapterForOrg).not.toHaveBeenCalled();
    expect(fileService.saveFile).not.toHaveBeenCalled();
  });

  it('throws via parseOrg when the org context has no id (fail-closed) and never fetches or stores', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const storageService = { getLocalAdapterForOrg: vi.fn() };
    const fileService = { saveFile: vi.fn() };
    const tool = new UploadFromUrlTool(fileService as any, storageService as any);

    await expect(
      executeTool(tool, {
        inputData: { url: 'https://example.com/pic.png' },
        organization: { name: 'No Id Org' }, // missing id
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('Organization context missing id');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageService.getLocalAdapterForOrg).not.toHaveBeenCalled();
    expect(fileService.saveFile).not.toHaveBeenCalled();
  });
});
