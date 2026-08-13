import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileRepository } from './file.repository';

const update = vi.fn();

const makeRepo = () =>
  new FileRepository(
    { model: { file: { update } } } as never,
    { model: { fileFolder: {} } } as never
  );

beforeEach(() => vi.clearAllMocks());

describe('FileRepository.renameFile', () => {
  it('writes the display name (originalName), which is what the UI renders', () => {
    // Grid and list both render `originalName || name`, and uploads always set
    // originalName — writing `name` alone was invisible to the user.
    makeRepo().renameFile('org-1', 'file-1', 'Quarterly deck.png');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-1' },
      data: { originalName: 'Quarterly deck.png' },
    });
  });

  it('leaves `name` untouched so the extension and search index survive', () => {
    makeRepo().renameFile('org-1', 'file-1', 'renamed');

    const { data } = update.mock.calls[0][0];
    expect(data).not.toHaveProperty('name');
  });

  it('scopes the update to the organization', () => {
    makeRepo().renameFile('org-2', 'file-9', 'x');

    expect(update.mock.calls[0][0].where).toEqual({
      id: 'file-9',
      organizationId: 'org-2',
    });
  });
});
