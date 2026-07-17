import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { FilesSearchTool } from './files.search.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('FilesSearchTool', () => {
  const org = makeOrganization();
  const user = makeUser();
  const access = { mode: 'user' };

  const makeFile = (id: string, overrides: Record<string, any> = {}) => ({
    id,
    name: `file-${id}.png`,
    path: `/uploads/file-${id}.png`,
    type: 'image',
    tags: null,
    ...overrides,
  });

  it('searches files by query and caps results', async () => {
    const fileService = {
      searchFiles: vi.fn().mockResolvedValue(
        Array.from({ length: 60 }, (_, i) => makeFile(`search-${i}`))
      ),
      getFiles: vi.fn(),
      getFolderTree: vi.fn(),
    };
    const tool = new FilesSearchTool(fileService as any);

    const result = await executeTool(tool, {
      inputData: { query: 'logo', folderId: 'folder-1' },
      organization: org,
      user,
      access,
    });

    expect(fileService.searchFiles).toHaveBeenCalledWith(org.id, 'logo', 'folder-1');
    expect(fileService.getFiles).not.toHaveBeenCalled();
    expect(result.output).toHaveLength(50);
    expect(result.output[0]).toEqual({
      id: 'search-0',
      name: 'file-search-0.png',
      path: '/uploads/file-search-0.png',
      type: 'image',
      tags: null,
    });
    expect(result.folders).toBeUndefined();
  });

  it('lists files without a query and includes folder tree when requested', async () => {
    const fileService = {
      searchFiles: vi.fn(),
      getFiles: vi.fn().mockResolvedValue({
        pages: 1,
        results: [makeFile('a'), makeFile('b', { type: 'video' })],
      }),
      getFolderTree: vi.fn().mockResolvedValue([
        { id: 'folder-1', name: 'Assets', children: [] },
      ]),
    };
    const tool = new FilesSearchTool(fileService as any);

    const result = await executeTool(tool, {
      inputData: { type: 'image', page: 2, includeFolderTree: true },
      organization: org,
      user,
      access,
    });

    expect(fileService.getFiles).toHaveBeenCalledWith(
      org.id,
      2,
      undefined,
      undefined,
      'image',
      undefined,
      undefined,
      undefined,
      50
    );
    expect(fileService.searchFiles).not.toHaveBeenCalled();
    expect(result.output).toHaveLength(2);
    expect(result.folders).toEqual([{ id: 'folder-1', name: 'Assets', children: [] }]);
  });

  it('denies read without access context', async () => {
    const tool = new FilesSearchTool({} as any);

    await expect(
      executeTool(tool, {
        inputData: { query: 'x' },
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied');
  });

  it('denies mcp read without mcp:read scope', async () => {
    const tool = new FilesSearchTool({} as any);

    await expect(
      executeTool(tool, {
        inputData: { query: 'x' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('Read access denied: mcp:read scope required');
  });
});
