import { describe, it, expect } from 'vitest';
import { ancestorsOf, resolveFolderPath, type FolderItem } from './folder.utils';

const folder = (
  id: string,
  name: string,
  parentId: string | null,
  children: FolderItem[] = []
): FolderItem => ({
  id,
  name,
  color: null,
  parentId,
  children,
  _count: { files: 0, children: children.length },
});

const TREE: FolderItem[] = [
  folder('d1', 'Brand assets', null, [
    folder('d1a', 'Logos', 'd1', [folder('d1a1', 'Dark', 'd1a')]),
  ]),
  folder('d2', 'Campaigns', null),
];

describe('ancestorsOf', () => {
  it('returns the root→leaf chain for a nested folder', () => {
    expect(ancestorsOf(TREE, 'd1a1').map(f => f.name)).toEqual([
      'Brand assets',
      'Logos',
      'Dark',
    ]);
  });

  it('returns just the folder itself at the top level', () => {
    expect(ancestorsOf(TREE, 'd2').map(f => f.name)).toEqual(['Campaigns']);
  });

  it('is empty at the root and for an unknown id', () => {
    expect(ancestorsOf(TREE, null)).toEqual([]);
    expect(ancestorsOf(TREE, 'gone')).toEqual([]);
  });
});

describe('resolveFolderPath', () => {
  it('resolves name segments to the deepest folder id', () => {
    expect(resolveFolderPath(TREE, ['Brand assets', 'Logos', 'Dark'])).toBe('d1a1');
    expect(resolveFolderPath(TREE, ['Brand assets'])).toBe('d1');
  });

  it('is null for the root and for a path that no longer exists', () => {
    expect(resolveFolderPath(TREE, [])).toBeNull();
    expect(resolveFolderPath(TREE, ['Brand assets', 'Renamed'])).toBeNull();
    // A name that exists deeper but not at this level does not match.
    expect(resolveFolderPath(TREE, ['Logos'])).toBeNull();
  });

  it('round-trips with ancestorsOf', () => {
    const path = ancestorsOf(TREE, 'd1a').map(f => f.name);
    expect(resolveFolderPath(TREE, path)).toBe('d1a');
  });
});
