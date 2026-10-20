import { describe, it, expect } from 'vitest';
import {
  UNFILED_FOLDER_KEY,
  collectTemplateFolders,
  filterTemplatesByFolder,
  findTemplateFolder,
  isFolderNotEmptyError,
  unfiledTemplates,
  type TemplateFolder,
} from './template-folders';

interface Template {
  id: string;
  isSystem?: boolean;
  folderId?: string | null;
}

const tmpl = (
  id: string,
  opts: { isSystem?: boolean; folderId?: string | null } = {}
): Template => ({ id, ...opts });

const folder = (
  id: string,
  children: TemplateFolder[] = [],
  templates = 0
): TemplateFolder => ({
  id,
  name: id,
  parentId: null,
  children,
  _count: { templates, children: children.length },
});

describe('filterTemplatesByFolder', () => {
  const templates = [
    tmpl('sys-1', { isSystem: true }),
    tmpl('org-root', {}),
    tmpl('org-a', { folderId: 'f-a' }),
    tmpl('org-b', { folderId: 'f-b' }),
  ];

  it('null (All templates) passes everything through, filed or not', () => {
    expect(filterTemplatesByFolder(templates, null).map((t) => t.id)).toEqual([
      'sys-1',
      'org-root',
      'org-a',
      'org-b',
    ]);
  });

  it('a folder id keeps only org templates filed there — never system templates', () => {
    expect(filterTemplatesByFolder(templates, 'f-a').map((t) => t.id)).toEqual(['org-a']);
    expect(filterTemplatesByFolder(templates, 'f-b').map((t) => t.id)).toEqual(['org-b']);
    expect(filterTemplatesByFolder(templates, 'f-empty')).toEqual([]);
  });

  it('UNFILED keeps org templates with no folder, excluding system templates', () => {
    expect(filterTemplatesByFolder(templates, UNFILED_FOLDER_KEY).map((t) => t.id)).toEqual([
      'org-root',
    ]);
  });
});

describe('unfiledTemplates', () => {
  it('counts folder-less org templates only', () => {
    const templates = [
      tmpl('sys-1', { isSystem: true }),
      tmpl('org-root', {}),
      tmpl('org-null', { folderId: null }),
      tmpl('org-a', { folderId: 'f-a' }),
    ];
    expect(unfiledTemplates(templates).map((t) => t.id)).toEqual(['org-root', 'org-null']);
  });
});

describe('findTemplateFolder', () => {
  const tree = [folder('a', [folder('a-1'), folder('a-2', [folder('a-2-1')])]), folder('b')];

  it('finds folders at any depth', () => {
    expect(findTemplateFolder(tree, 'a')?.id).toBe('a');
    expect(findTemplateFolder(tree, 'a-2-1')?.id).toBe('a-2-1');
  });

  it('returns null for a missing id', () => {
    expect(findTemplateFolder(tree, 'gone')).toBeNull();
    expect(findTemplateFolder([], 'a')).toBeNull();
  });
});

describe('collectTemplateFolders', () => {
  it('flattens depth-first with depth tags and template counts', () => {
    const tree = [folder('a', [folder('a-1', [], 2), folder('a-2', [folder('a-2-1', [], 5)], 1)], 3), folder('b', [], 4)];
    expect(collectTemplateFolders(tree)).toEqual([
      { id: 'a', name: 'a', depth: 0, templateCount: 3 },
      { id: 'a-1', name: 'a-1', depth: 1, templateCount: 2 },
      { id: 'a-2', name: 'a-2', depth: 1, templateCount: 1 },
      { id: 'a-2-1', name: 'a-2-1', depth: 2, templateCount: 5 },
      { id: 'b', name: 'b', depth: 0, templateCount: 4 },
    ]);
  });

  it('tolerates a missing _count', () => {
    const bare: TemplateFolder = { id: 'x', name: 'x', parentId: null, children: [] };
    expect(collectTemplateFolders([bare])).toEqual([
      { id: 'x', name: 'x', depth: 0, templateCount: 0 },
    ]);
  });
});

describe('isFolderNotEmptyError', () => {
  it('matches the backend 400 contract', () => {
    expect(isFolderNotEmptyError(400, 'Folder is not empty')).toBe(true);
  });

  it('rejects other statuses and messages', () => {
    expect(isFolderNotEmptyError(404, 'Folder is not empty')).toBe(false);
    expect(isFolderNotEmptyError(400, 'Validation failed')).toBe(false);
    expect(isFolderNotEmptyError(500, '')).toBe(false);
  });
});
