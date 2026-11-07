import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

const redis = new Map<string, string>();
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(async (key: string) => redis.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redis.has(key)) return null;
      redis.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      redis.delete(key);
      return 1;
    }),
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
  isInngestEnabled: vi.fn(() => true),
}));

import { BadRequestException } from '@nestjs/common';
import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { DesignBulkCreateService, DESIGN_BULK_CREATE_OPERATION } from './design-bulk-create.service';

const makeDoc = (): any => ({
  version: 11,
  mode: 'image',
  outputs: [{
    id: 'out-1', formatId: 'square', name: 'Square', width: 100, height: 100,
    children: [{
      id: 'text-1', type: 'text', text: 'Hello {{name}}', x: 0, y: 0, width: 50, height: 20,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    }, {
      id: 'existing-image', type: 'image', src: 'https://cdn.example.test/existing.png',
      fileId: 'existing-file', x: 0, y: 0, width: 20, height: 20,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    }],
    pages: [{
      id: 'page-2',
      children: [{
        id: 'image-1', type: 'image', src: '{{image}}', x: 0, y: 0, width: 50, height: 50,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }],
  }],
});

const makeService = () => {
  let status = 'pending';
  let fileNumber = 0;
  let renderNumber = 0;
  const job: any = {
    id: 'job-1', organizationId: 'org-1', operation: DESIGN_BULK_CREATE_OPERATION,
    status, inputJson: null,
  };
  const renderService = { renderPage: vi.fn(async () => Buffer.from(`png-${++renderNumber}`)) };
  const lifecycle = { createPendingJob: vi.fn(async () => ({ id: 'job-1', status: 'pending' })) };
  const aiSettings = {
    getMediaJobById: vi.fn(async () => job.organizationId === 'org-1' ? job : null),
    getMediaJobByIdUnscoped: vi.fn(async () => ({ ...job, status })),
    updateMediaJob: vi.fn(async (_org: string, _id: string, update: any) => {
      status = update.status ?? status;
      Object.assign(job, update);
    }),
  };
  const designService = { createDesign: vi.fn(async (_org: string, _user: string, data: any) => ({ id: `design-${data.doc.outputs[0].children[0].text}`, ...data })) };
  const designerDocService = { validate: vi.fn((doc) => doc) };
  const fileService = {
    getFolder: vi.fn(async () => ({ id: 'folder-1' })),
    createFolder: vi.fn(async () => ({ id: 'batch-folder' })),
    saveGeneratedMedia: vi.fn(async (_org: string, data: any) => ({ id: `file-${++fileNumber}`, ...data })),
  };
  const writes: { bytes: Buffer; mime: string }[] = [];
  const storageService = {
    getLocalAdapterForOrg: vi.fn(async () => ({
      writeBuffer: vi.fn(async (bytes: Buffer, mime: string) => {
        writes.push({ bytes, mime });
        return `/uploads/org/artifact-${writes.length}`;
      }),
    })),
  };
  const aiMediaService = {
    saveUrlToFile: vi.fn(async (_org: string, url: string) => {
      const name = new URL(url).pathname.split('/').pop()!.split('.')[0];
      return { id: `remote-${name}`, path: `/uploads/org/remote-${name}.png` };
    }),
  };
  const service = new DesignBulkCreateService(
    renderService as any, lifecycle as any, aiSettings as any, designService as any,
    designerDocService as any, fileService as any, storageService as any, aiMediaService as any,
  );
  return { service, renderService, lifecycle, aiSettings, designService, designerDocService, fileService, storageService, aiMediaService, writes };
};

const seedPayload = (rows = [
  { name: 'Ada', image: 'https://cdn.example.test/a.png' },
  { name: 'Grace', image: 'https://cdn.example.test/b.png' },
]) => {
  redis.set('design-bulk:payload:job-1', JSON.stringify({
    organizationId: 'org-1', userId: 'user-1', nameBase: 'Campaign', doc: makeDoc(), rows,
  }));
};

beforeEach(() => {
  redis.clear();
  vi.clearAllMocks();
});

describe('DesignBulkCreateService enqueue and status', () => {
  it('validates and enqueues an org-owned static batch', async () => {
    const { service, lifecycle, designerDocService, fileService } = makeService();
    const rows = [{ name: 'Ada' }];
    const result = await service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(), rows, nameBase: 'Launch', folderId: 'folder-1',
    });

    expect(result).toEqual({ id: 'job-1', status: 'pending' });
    expect(designerDocService.validate).toHaveBeenCalled();
    expect(fileService.getFolder).toHaveBeenCalledWith('org-1', 'folder-1');
    expect(lifecycle.createPendingJob).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', userId: 'user-1', operation: DESIGN_BULK_CREATE_OPERATION,
    }));
    expect(JSON.parse(redis.get('design-bulk:payload:job-1')!).rows).toEqual(rows);
    expect(inngest.send).toHaveBeenCalledWith(expect.objectContaining({
      name: 'media/design-export', data: { jobId: 'job-1' },
    }));
  });

  it('creates a dedicated batch folder when none was selected', async () => {
    const { service, fileService } = makeService();
    await service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(), rows: [{ name: 'Ada' }], nameBase: 'Launch',
    });

    expect(fileService.createFolder).toHaveBeenCalledWith('org-1', { name: 'Launch (job-1)' });
    expect(JSON.parse(redis.get('design-bulk:payload:job-1')!).folderId).toBe('batch-folder');
  });

  it('rejects video documents, empty batches and non-string cell values', async () => {
    const { service } = makeService();
    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: { ...makeDoc(), mode: 'video' }, rows: [{}],
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.enqueueBulkCreate('org-1', 'user-1', { doc: makeDoc(), rows: [] }))
      .rejects.toThrow(/at least one/);
    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(), rows: [{ name: 42 } as any],
    })).rejects.toThrow(/strings/);
  });

  it('returns only the matching operation and org, and tolerates malformed result state', async () => {
    const { service, aiSettings } = makeService();
    expect(await service.getJob('org-1', 'job-1')).toMatchObject({ id: 'job-1', results: undefined });
    expect(await service.getJob('other-org', 'job-1')).toBeNull();
    aiSettings.getMediaJobById.mockResolvedValueOnce({ id: 'other', organizationId: 'org-1', operation: 'other' });
    expect(await service.getJob('org-1', 'job-1')).toBeNull();
    aiSettings.getMediaJobById.mockResolvedValueOnce({
      id: 'job-1', organizationId: 'org-1', operation: DESIGN_BULK_CREATE_OPERATION, inputJson: '{bad',
    });
    await expect(service.getJob('org-1', 'job-1')).resolves.toMatchObject({ results: undefined });
    await expect(service.getJob('org-1', 'job-1')).resolves.not.toHaveProperty('inputJson');
    await expect(service.getJob('org-1', 'job-1')).resolves.not.toHaveProperty('userId');
  });
});

describe('DesignBulkCreateService processing', () => {
  it('creates editable designs, imports row images and writes every page into a real ZIP', async () => {
    const { service, designService, aiMediaService, fileService, aiSettings, writes } = makeService();
    seedPayload();

    await service.processBulkCreate('job-1');

    expect(designService.createDesign).toHaveBeenCalledTimes(2);
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].children[0].text).toBe('Hello Ada');
    expect(designService.createDesign.mock.calls[1][2].doc.outputs[0].children[0].text).toBe('Hello Grace');
    expect(aiMediaService.saveUrlToFile).toHaveBeenCalledTimes(2);
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].pages[0].children[0]).toMatchObject({
      src: '/uploads/org/remote-a.png', fileId: 'remote-a',
    });
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(5);
    const zipWrite = writes.find((write) => write.mime === 'application/zip')!;
    const entries = unzipSync(zipWrite.bytes);
    expect(Object.keys(entries)).toHaveLength(5);
    expect(Object.keys(entries)).toContain('results.json');
    expect(Object.keys(entries)).toContain('row-002-output-1-page-2.png');
    const results = JSON.parse(strFromU8(entries['results.json']));
    expect(results).toHaveLength(2);
    expect(results[0].fileIds).toHaveLength(2);
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'completed', artifactUrl: '/uploads/org/artifact-5',
    }));
    expect(redis.has('design-bulk:payload:job-1')).toBe(false);
  });

  it('creates editable symbol variations and persists their row-owned images', async () => {
    const { service, designService } = makeService();
    const doc = makeDoc();
    doc.symbols = [{
      id: 'symbol-1', name: 'Footer', width: 100, height: 100,
      children: [{
        id: 'symbol-text', type: 'text', text: 'Old', slot: { name: 'headline', kind: 'text' },
        x: 0, y: 0, width: 50, height: 20, rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'symbol-image', type: 'image', src: '{{symbolImage}}', slot: { name: 'symbolImage', kind: 'image' },
        x: 0, y: 20, width: 50, height: 50, rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'symbol-shape', type: 'shape', shape: 'rect', fill: '#000000', slot: { name: 'accent', kind: 'color' },
        x: 0, y: 70, width: 50, height: 20, rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }];
    redis.set('design-bulk:payload:job-1', JSON.stringify({
      organizationId: 'org-1', userId: 'user-1', nameBase: 'Campaign', doc,
      rows: [{
        name: 'Ada', image: 'https://cdn.example.test/page.png', headline: 'New footer',
        symbolImage: 'https://cdn.example.test/symbol.png', accent: '#ff0000',
      }],
    }));

    await service.processBulkCreate('job-1');

    expect(designService.createDesign.mock.calls[0][2].doc.symbols[0].children).toMatchObject([
      { text: 'New footer' },
      { src: '/uploads/org/remote-symbol.png', fileId: 'remote-symbol' },
      { fill: '#ff0000' },
    ]);
  });

  it('imports a repeated remote image only once for the whole batch', async () => {
    const { service, aiMediaService, designService } = makeService();
    seedPayload([
      { name: 'Ada', image: 'https://cdn.example.test/shared.png' },
      { name: 'Grace', image: 'https://cdn.example.test/shared.png' },
    ]);

    await service.processBulkCreate('job-1');

    expect(aiMediaService.saveUrlToFile).toHaveBeenCalledTimes(1);
    expect(designService.createDesign).toHaveBeenCalledTimes(2);
  });

  it('isolates a failed row and still completes the successful rows', async () => {
    const { service, designService, aiSettings, writes } = makeService();
    designService.createDesign
      .mockRejectedValueOnce(new Error('Bad first row'))
      .mockResolvedValueOnce({ id: 'design-2' } as any);
    seedPayload();

    await service.processBulkCreate('job-1');

    const completed = aiSettings.updateMediaJob.mock.calls.find(([, , update]) => update.status === 'completed')?.[2];
    const results = JSON.parse(completed.inputJson);
    expect(results[0].error).toBe('Bad first row');
    expect(results[1].designId).toBe('design-2');
    expect(writes.some((write) => write.mime === 'application/zip')).toBe(true);
  });

  it('heartbeats the job row and leaves existing template image URLs untouched', async () => {
    const { service, aiSettings, designService } = makeService();
    seedPayload();

    await service.processBulkCreate('job-1');

    expect(aiSettings.updateMediaJob.mock.calls.filter(([, , update]) => update.status === 'processing'))
      .toHaveLength(3);
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].children[1]).toMatchObject({
      src: 'https://cdn.example.test/existing.png', fileId: 'existing-file',
    });
  });

  it('stops on a terminal sweep status and never resurrects the job as completed', async () => {
    const { service, aiSettings, designService } = makeService();
    seedPayload();
    aiSettings.getMediaJobByIdUnscoped
      .mockReturnValueOnce(Promise.resolve({ id: 'job-1', organizationId: 'org-1', operation: DESIGN_BULK_CREATE_OPERATION, status: 'pending' }))
      .mockImplementation(async () => ({ id: 'job-1', organizationId: 'org-1', operation: DESIGN_BULK_CREATE_OPERATION, status: 'failed' }));

    await service.processBulkCreate('job-1');

    expect(designService.createDesign).toHaveBeenCalledTimes(1);
    expect(aiSettings.updateMediaJob.mock.calls.some(([, , update]) => update.status === 'completed')).toBe(false);
  });

  it('fails an all-failed batch without creating a ZIP', async () => {
    const { service, designService, aiSettings, writes } = makeService();
    designService.createDesign.mockRejectedValue(new Error('Invalid row'));
    seedPayload([{ name: 'Only', image: 'https://cdn.example.test/a.png' }]);

    await service.processBulkCreate('job-1');

    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'failed', error: 'Invalid row',
      inputJson: JSON.stringify([{ row: 1, fileIds: [], error: 'Invalid row' }]),
    }));
    expect(writes.some((write) => write.mime === 'application/zip')).toBe(false);
  });

  it('does not rerun a claimed or completed job', async () => {
    const { service, renderService } = makeService();
    seedPayload();
    redis.set('design-bulk:claim:job-1', '1');
    await service.processBulkCreate('job-1');
    expect(renderService.renderPage).not.toHaveBeenCalled();

    redis.clear();
    await service.processBulkCreate('job-1');
    expect(renderService.renderPage).not.toHaveBeenCalled();
  });

  it('marks an expired payload failed', async () => {
    const { service, aiSettings } = makeService();
    await service.processBulkCreate('job-1');
    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'failed', error: expect.stringMatching(/expired/),
    }));
  });
});
