import { describe, it, expect } from 'vitest';
import {
  UNFILED_FOLDER_KEY,
  filterTemplatesByFolder,
  findTemplateFolder,
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
