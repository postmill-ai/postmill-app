import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgImportService } from './org-import.service';
import { readOrgDomainRows } from './org-import-archive';

vi.mock('./org-import-archive', async (importOriginal) => ({
  ...(await importOriginal()),
  readOrgDomainRows: vi.fn(),
}));

const readRows = vi.mocked(readOrgDomainRows);

const mapsFor = () => {
  const ids: Record<string, Map<string, string>> = {};
  for (const model of ['Design', 'DesignVersion', 'DesignTemplate', 'File', 'FileFolder']) {
    ids[model] = new Map([['source-id', 'mapped-id']]);
  }
  return {
    organizationId: 'destination-org',
    defaultLocalProviderId: null,
    ids,
    roles: new Map(),
    systemRoles: new Map(),
    permissions: new Map(),
    users: new Map(),
    files: new Map(),
    paths: new Map(),
    strictFontMapping: false,
    videoFileIds: [],
    ownerId: 'owner-id',
    ownerEmail: 'owner@example.test',
  };
};

const service = (): any => {
  const instance = Object.create(OrgImportService.prototype) as any;
  instance._repository = { createManyModel: vi.fn().mockResolvedValue(undefined) };
  instance._designerDoc = {
    stripIds: vi.fn((doc) => doc),
    assignIdsAndNormalize: vi.fn((doc) => ({ ...doc, normalized: true })),
  };
  return instance;
};

describe('OrgImportService DesignerDoc version guard', () => {
  beforeEach(() => {
    readRows.mockReset();
  });

  it.each(['Design', 'DesignVersion', 'DesignTemplate'])(
    'rejects newer %s documents before normalization or insertion',
    async (model) => {
      const instance = service();
      readRows.mockResolvedValue([{ id: 'source-id', doc: { version: 15, mode: 'video', outputs: [] } }]);

      await expect(instance._importModel({} as never, model, {} as never, mapsFor() as never, new Map()))
        .rejects.toThrow('DesignerDoc v15 is newer than this deployment supports (v14)');
      expect(instance._designerDoc.assignIdsAndNormalize).not.toHaveBeenCalled();
      expect(instance._repository.createManyModel).not.toHaveBeenCalled();
    }
  );

  it('applies the same guard to serialized archive documents', async () => {
    const instance = service();
    readRows.mockResolvedValue([{
      id: 'source-id',
      doc: JSON.stringify({ version: 15, mode: 'video', outputs: [] }),
    }]);

    await expect(instance._importModel({} as never, 'Design', {} as never, mapsFor() as never, new Map()))
      .rejects.toThrow('Upgrade Postmill before importing this archive');
    expect(instance._repository.createManyModel).not.toHaveBeenCalled();
  });

  it('imports a same-version document normally', async () => {
    const instance = service();
    readRows.mockResolvedValue([{ id: 'source-id', doc: { version: 14, mode: 'video', outputs: [] } }]);

    await instance._importModel({} as never, 'Design', {} as never, mapsFor() as never, new Map());

    expect(instance._designerDoc.assignIdsAndNormalize).toHaveBeenCalledOnce();
    expect(instance._repository.createManyModel).toHaveBeenCalledOnce();
  });
});
