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

const { mockSafeFetch } = vi.hoisted(() => ({ mockSafeFetch: vi.fn() }));
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: mockSafeFetch,
}));

import { BadRequestException } from '@nestjs/common';
import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { DesignerDocService } from '../designer-doc/designer-doc.service';
import { DesignExportService } from '../design-export/design-export.service';
import { parsePostmillFile } from '../designer-doc/postmill-file';
import { computeMediaDraw } from '../designer-doc/media-geometry';
import { DesignBulkCreateService, DESIGN_BULK_CREATE_OPERATION } from './design-bulk-create.service';
import { IMAGE_SOURCE_MAX_BYTES } from '../image-source.limits';

const makeDoc = (): any => ({
  version: 11,
  mode: 'image',
  outputs: [{
    id: 'out-1', formatId: 'square', name: 'Square', width: 100, height: 100, background: '#ffffff',
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
        id: 'image-1', type: 'image', src: 'https://cdn.example.test/page-template.png',
        slot: { name: 'image', kind: 'image' },
        x: 0, y: 0, width: 50, height: 50,
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
  const designService = {
    createDesign: vi.fn(async (_org: string, _user: string, data: any) => {
      designerDocService.validate(data.doc);
      return { id: `design-${data.doc.outputs[0].children[0].text}`, ...data };
    }),
    deleteDesign: vi.fn(async () => undefined),
  };
  const designerDocService = new DesignerDocService();
  vi.spyOn(designerDocService, 'validate');
  const remoteFiles = new Map<string, any>();
  const existingFile = {
    id: 'existing-file', folderId: null, path: '/uploads/org/existing.png',
    name: 'existing.png', originalName: 'existing.png', fileSize: PNG_BYTES.length,
  };
  const fileService = {
    getFolder: vi.fn(async () => ({ id: 'folder-1' })),
    createFolder: vi.fn(async () => ({ id: 'batch-folder' })),
    deleteFolder: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    getFileById: vi.fn(async (_org: string, id: string) =>
      id === existingFile.id ? existingFile : remoteFiles.get(id) ?? null
    ),
    getFileByPath: vi.fn(async () => null),
    saveGeneratedMedia: vi.fn(async (_org: string, data: any) => ({ id: `file-${++fileNumber}`, ...data })),
    saveMediaInformation: vi.fn(async () => ({})),
  };
  const writes: { bytes: Buffer; mime: string }[] = [];
  const readFile = vi.fn(async (path: string) => {
    const remote = [...remoteFiles.values()].find((file) => file.path === path);
    return remote?.bytes || PNG_BYTES;
  });
  const localAdapter = {
    readFile,
    writeBuffer: vi.fn(async (bytes: Buffer, mime: string) => {
      writes.push({ bytes, mime });
      return `/uploads/org/artifact-${writes.length}`;
    }),
  };
  const storageService = {
    getLocalAdapterForOrg: vi.fn(async () => localAdapter),
    resolveAdapterForFolder: vi.fn(async () => ({ readFile })),
  };
  const aiMediaService = {
    saveUrlToFile: vi.fn(async (_org: string, url: string) => {
      const parsed = new URL(url);
      const name = parsed.searchParams.get('id') || parsed.pathname.split('/').pop()!.split('.')[0];
      const bytes = name.includes('landscape')
        ? LANDSCAPE_BYTES
        : name.includes('portrait')
          ? PORTRAIT_BYTES
          : PNG_BYTES;
      const file = {
        id: `remote-${name}`, folderId: null, path: `/uploads/org/remote-${name}.png`,
        name: `${name}.png`, originalName: `${name}.png`, fileSize: bytes.length, bytes,
      };
      remoteFiles.set(file.id, file);
      return { id: file.id, path: file.path };
    }),
  };
  const designExport = new DesignExportService(
    lifecycle as any,
    aiSettings as any,
    designService as any,
    designerDocService,
    fileService as any,
    storageService as any,
    { getCustomFonts: vi.fn(async () => []) } as any,
    { renderPreviewBuffer: vi.fn(async () => PNG_BYTES) } as any,
  );
  const service = new DesignBulkCreateService(
    renderService as any, lifecycle as any, aiSettings as any, designService as any,
    designerDocService as any, fileService as any, storageService as any, aiMediaService as any,
    designExport,
  );
  return {
    service, renderService, lifecycle, aiSettings, designService, designerDocService,
    fileService, storageService, aiMediaService, writes, localAdapter, readFile, designExport,
  };
};

const seedPayload = (rows = [
  { name: 'Ada', image: 'https://cdn.example.test/a.png' },
  { name: 'Grace', image: 'https://cdn.example.test/b.png' },
]) => {
  redis.set('design-bulk:payload:job-1', JSON.stringify({
    organizationId: 'org-1', userId: 'user-1', nameBase: 'Campaign',
    folderId: 'batch-folder', folderOwned: true, doc: makeDoc(), rows,
  }));
};

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const LANDSCAPE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHxkzoAsAAA8hD/E58b5bAAAAAElFTkSuQmCC',
  'base64',
);
const PORTRAIT_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAYAAACk7+45AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWNgYPj/H4JxMgAPIw/xT2/EuwAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(() => {
  redis.clear();
  vi.clearAllMocks();
  mockSafeFetch.mockReset();
  mockSafeFetch.mockImplementation(async () => new Response(PNG_BYTES));
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

  it('rejects an invalid transformed row before creating any job, folder, payload or event', async () => {
    const { service, lifecycle, fileService } = makeService();

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(), rows: [{ name: 'Ada', image: '=IMAGE("not a URL")' }],
    })).rejects.toThrow(/Row 1: outputs\.0\.pages\.0\.children\.0\.src.*image column "image", element "image-1"/);

    expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    expect(fileService.createFolder).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(redis.size).toBe(0);
  });

  it('names the symbol image column and element instead of walking outputs', async () => {
    const { service } = makeService();
    const doc = makeDoc();
    doc.symbols = [{
      id: 'symbol-1', name: 'Footer', width: 100, height: 100,
      children: [{
        id: 'symbol-image', type: 'image', src: '/uploads/original.png', slot: { name: 'symbolImage', kind: 'image' },
        x: 0, y: 20, width: 50, height: 50, rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }];

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc,
      rows: [{ symbolImage: 'not a URL' }],
    })).rejects.toThrow('image column "symbolImage", element "symbol-image"');
  });

  it('rejects row 3 remote image failures before every job, folder, event or output side effect', async () => {
    const {
      service, lifecycle, fileService, designService, renderService, storageService, aiMediaService, writes,
    } = makeService();
    const doc = makeDoc();
    doc.outputs[0].pages[0].children[0].slot.name = 'product_image';
    const rows = Array.from({ length: 5 }, (_, index) => ({
      name: `Product ${index + 1}`,
      product_image: `https://cdn.example.test/product-${index + 1}.png`,
    }));
    let active = 0;
    let maxActive = 0;
    mockSafeFetch.mockImplementation(async (url: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      try {
        if (url.endsWith('/product-3.png')) throw new Error('Blocked URL');
        return new Response(PNG_BYTES);
      } finally {
        active--;
      }
    });

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc, rows, nameBase: 'Launch',
    })).rejects.toThrow(
      'Row 3: rows[2].product_image (outputs.0.pages.0.children.0.src): Blocked URL'
    );

    expect(maxActive).toBe(1);
    expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    expect(fileService.createFolder).not.toHaveBeenCalled();
    expect(fileService.saveGeneratedMedia).not.toHaveBeenCalled();
    expect(designService.createDesign).not.toHaveBeenCalled();
    expect(renderService.renderPage).not.toHaveBeenCalled();
    expect(storageService.getLocalAdapterForOrg).not.toHaveBeenCalled();
    expect(aiMediaService.saveUrlToFile).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(redis.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('rejects HTML returned for a remote row image before enqueue', async () => {
    const { service, lifecycle, fileService } = makeService();
    mockSafeFetch.mockImplementation(async (url: string) =>
      new Response(url.endsWith('/bad.png') ? '<html>Not an image</html>' : PNG_BYTES)
    );

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(),
      rows: [{ name: 'Ada', image: 'https://cdn.example.test/bad.png' }],
    })).rejects.toThrow(
      'Row 1: rows[0].image (outputs.0.pages.0.children.0.src): The image response did not contain a supported PNG, JPEG, or WebP image.'
    );

    expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    expect(fileService.createFolder).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(redis.size).toBe(0);
  });

  it('rejects a declared oversize image before reading its body or creating side effects', async () => {
    const { service, lifecycle, fileService } = makeService();
    const response = new Response(PNG_BYTES, {
      headers: { 'content-length': String(IMAGE_SOURCE_MAX_BYTES + 1) },
    });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    mockSafeFetch.mockImplementation(async (url: string) =>
      url.endsWith('/too-large.png') ? response : new Response(PNG_BYTES)
    );

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(),
      rows: [{ name: 'Ada', image: 'https://cdn.example.test/too-large.png' }],
    })).rejects.toThrow(/Row 1: rows\[0\]\.image .*20 MB/);

    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    expect(fileService.createFolder).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(redis.size).toBe(0);
  });

  it('cancels an unknown-length image stream at the byte cap without enqueue side effects', async () => {
    const { service, lifecycle, fileService } = makeService();
    const cancel = vi.fn();
    let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) controller.enqueue(PNG_BYTES);
        else if (pulls === 2) controller.enqueue(Buffer.alloc(IMAGE_SOURCE_MAX_BYTES));
      },
      cancel,
    }));
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    mockSafeFetch.mockImplementation(async (url: string) =>
      url.endsWith('/chunked.png') ? response : new Response(PNG_BYTES)
    );

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(),
      rows: [{ name: 'Ada', image: 'https://cdn.example.test/chunked.png' }],
    })).rejects.toThrow(/Row 1: rows\[0\]\.image .*20 MB/);

    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    expect(fileService.createFolder).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
    expect(redis.size).toBe(0);
  });

  it('retains only bounded source metadata while transforming 200 rows', async () => {
    const { service } = makeService();
    const preflight = vi.spyOn(service as any, '_preflightRemoteImages');
    const rows = Array.from({ length: 200 }, (_, index) => ({
      name: `Product ${index + 1} ${'x'.repeat(9900)}`,
      image: `https://cdn.example.test/product-${index + 1}.png`,
    }));

    await service.enqueueBulkCreate('org-1', 'user-1', { doc: makeDoc(), rows });

    expect(preflight).toHaveBeenCalledOnce();
    const [sources] = preflight.mock.calls[0];
    expect(Array.isArray(sources)).toBe(true);
    expect(sources).toHaveLength(200);
    expect(JSON.stringify(sources).length).toBeLessThan(100000);
    expect(sources[0]).toEqual({
      row: 1,
      url: 'https://cdn.example.test/product-1.png',
      documentPath: 'outputs.0.pages.0.children.0.src',
      column: 'image',
    });
  });

  it('does not raster-preflight an unchanged remote SVG template icon', async () => {
    const { service } = makeService();
    const doc = makeDoc();
    doc.outputs[0].children.push({
      id: 'icon-1', type: 'icon', src: 'https://api.iconify.design/mdi/rocket.svg', fill: '#000000',
      x: 20, y: 20, width: 20, height: 20,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    mockSafeFetch.mockImplementation(async (url: string) =>
      new Response(url.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>' : PNG_BYTES)
    );

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc, rows: [{ name: 'Ada' }],
    })).resolves.toEqual({ id: 'job-1', status: 'pending' });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('accepts spreadsheet image formulas and Drive links through the real validator', async () => {
    const { service } = makeService();
    const rows = [{
      name: 'Ada',
      image: '=IMAGE("https://drive.google.com/file/d/product-image-1/view?usp=sharing")',
    }];

    await expect(service.enqueueBulkCreate('org-1', 'user-1', {
      doc: makeDoc(), rows, nameBase: 'Launch',
    })).resolves.toEqual({ id: 'job-1', status: 'pending' });
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
  it('creates editable designs, imports row images and writes self-contained archives and source files into the ZIP', async () => {
    const { service, designService, aiMediaService, fileService, aiSettings, writes, readFile } = makeService();
    seedPayload();

    await service.processBulkCreate('job-1');

    expect(designService.createDesign).toHaveBeenCalledTimes(2);
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].children[0].text).toBe('Hello Ada');
    expect(designService.createDesign.mock.calls[1][2].doc.outputs[0].children[0].text).toBe('Hello Grace');
    expect(aiMediaService.saveUrlToFile).toHaveBeenCalledTimes(2);
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].pages[0].children[0]).toMatchObject({
      src: '/uploads/org/remote-a.png', fileId: 'remote-a', naturalWidth: 1, naturalHeight: 1,
      fitMode: 'cover',
    });
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(9);
    expect(fileService.saveMediaInformation).toHaveBeenCalledTimes(2);
    const zipWrite = [...writes].reverse().find((write) => write.mime === 'application/zip')!;
    const entries = unzipSync(zipWrite.bytes);
    expect(Object.keys(entries)).toHaveLength(9);
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      'results.json',
      'row-002-output-1-page-2.png',
      'editable/row-001.pdesign',
      'editable/row-002.pdesign',
      'source/template.pdesign',
      'source/data.csv',
    ]));
    const results = JSON.parse(strFromU8(entries['results.json']));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ designId: 'design-Hello Ada', editableFileId: 'file-3' });
    expect(results[0].fileIds).toHaveLength(2);
    expect(results[1]).toMatchObject({ designId: 'design-Hello Grace', editableFileId: 'file-6' });

    for (const [index, remoteId] of ['remote-a', 'remote-b'].entries()) {
      const parsed = parsePostmillFile(entries[`editable/row-${String(index + 1).padStart(3, '0')}.pdesign`]);
      const doc = new DesignerDocService().validate(parsed.doc);
      expect(parsed.manifest.name).toBe(`Campaign ${index + 1}`);
      expect((doc.outputs[0] as any).children[0]).toMatchObject({
        type: 'text', text: `Hello ${index === 0 ? 'Ada' : 'Grace'}`,
      });
      expect(parsed.manifest.assets).toHaveProperty(remoteId);
      expect(parsed.manifest.assets).toHaveProperty('existing-file');
      expect(parsed.assets.get(parsed.manifest.assets![remoteId].path)).toBeDefined();
    }
    const template = parsePostmillFile(entries['source/template.pdesign']);
    const templateDoc = new DesignerDocService().validate(template.doc);
    expect((templateDoc.outputs[0] as any).children[0].text).toBe('Hello {{name}}');
    expect(template.manifest.assets).toHaveProperty('existing-file');
    expect(strFromU8(entries['source/data.csv'])).toBe(
      '"name","image"\r\n"Ada","https://cdn.example.test/a.png"\r\n"Grace","https://cdn.example.test/b.png"'
    );
    expect(readFile.mock.calls.filter(([path]) => path === '/uploads/org/existing.png').length).toBe(1);
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'completed', artifactUrl: '/uploads/org/artifact-9',
    }));
    expect(redis.has('design-bulk:payload:job-1')).toBe(false);
  });

  it('resolves an existing uploads replacement and bundles its real image bytes and dimensions', async () => {
    const { service, designService, fileService, readFile, aiMediaService, writes } = makeService();
    const localFile = {
      id: 'local-portrait', folderId: 'folder-assets', path: '/uploads/org/local-portrait.png',
      name: 'local-portrait.png', originalName: 'local-portrait.png', fileSize: PORTRAIT_BYTES.length,
    };
    fileService.getFileByPath.mockResolvedValue(localFile);
    fileService.getFileById.mockImplementation(async (_org: string, id: string) =>
      id === localFile.id ? localFile : null
    );
    readFile.mockResolvedValue(PORTRAIT_BYTES);
    seedPayload([{ name: 'Local', image: localFile.path }]);

    await service.processBulkCreate('job-1');

    expect(fileService.getFileByPath).toHaveBeenCalledWith('org-1', localFile.path);
    expect(aiMediaService.saveUrlToFile).not.toHaveBeenCalled();
    expect(designService.createDesign.mock.calls[0][2].doc.outputs[0].pages[0].children[0]).toMatchObject({
      src: localFile.path, fileId: localFile.id, naturalWidth: 2, naturalHeight: 4, fitMode: 'cover',
    });
    const zipWrite = [...writes].reverse().find((write) => write.mime === 'application/zip')!;
    const entries = unzipSync(zipWrite.bytes);
    const archive = parsePostmillFile(entries['editable/row-001.pdesign']);
    expect(archive.manifest.assets).toHaveProperty(localFile.id);
    expect(Buffer.from(archive.assets.get(`assets/${localFile.id}.png`)!)).toEqual(PORTRAIT_BYTES);
  });

  it('uses real portrait and landscape metadata to cover-crop replacement pixels without distortion', async () => {
    const { service, designService } = makeService();
    const doc = makeDoc();
    Object.assign(doc.outputs[0].pages[0].children[0], {
      crop: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10,
    });
    redis.set('design-bulk:payload:job-1', JSON.stringify({
      organizationId: 'org-1', userId: 'user-1', nameBase: 'Campaign', folderId: 'batch-folder',
      folderOwned: true, doc,
      rows: [
        { name: 'Wide', image: 'https://cdn.example.test/landscape.png' },
        { name: 'Tall', image: 'https://cdn.example.test/portrait.png' },
      ],
    }));

    await service.processBulkCreate('job-1');

    const replacements = designService.createDesign.mock.calls.map(([, , data]) =>
      data.doc.outputs[0].pages[0].children[0]
    );
    expect(replacements).toMatchObject([
      { naturalWidth: 4, naturalHeight: 2, fitMode: 'cover' },
      { naturalWidth: 2, naturalHeight: 4, fitMode: 'cover' },
    ]);
    for (const element of replacements) {
      expect(element.crop).toBeUndefined();
      const draw = computeMediaDraw({
        sourceWidth: element.naturalWidth,
        sourceHeight: element.naturalHeight,
        targetWidth: element.width,
        targetHeight: element.height,
        fitMode: element.fitMode,
      });
      expect(draw.source.width / draw.source.height).toBeCloseTo(1);
      expect(draw.destination).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    }
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
      {
        src: '/uploads/org/remote-symbol.png', fileId: 'remote-symbol',
        naturalWidth: 1, naturalHeight: 1, fitMode: 'cover',
      },
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

  it('processes a five-row catalog with spreadsheet formulas through real document validation', async () => {
    const { service, designService, aiMediaService, renderService, aiSettings, writes } = makeService();
    seedPayload(Array.from({ length: 5 }, (_, index) => ({
      name: `Product ${index + 1}`,
      image: `=IMAGE("https://drive.google.com/file/d/product-${index + 1}/view?usp=sharing")`,
    })));

    await service.processBulkCreate('job-1');

    expect(designService.createDesign).toHaveBeenCalledTimes(5);
    expect(aiMediaService.saveUrlToFile).toHaveBeenCalledTimes(5);
    expect(aiMediaService.saveUrlToFile.mock.calls[0][1])
      .toBe('https://drive.google.com/uc?export=download&id=product-1');
    expect(renderService.renderPage).toHaveBeenCalledTimes(10);
    const completed = aiSettings.updateMediaJob.mock.calls.find(([, , update]) => update.status === 'completed')?.[2];
    expect(JSON.parse(completed.inputJson)).toHaveLength(5);
    expect(JSON.parse(completed.inputJson).every((result: any) => result.designId && !result.error)).toBe(true);
    expect(writes.some((write) => write.mime === 'application/zip')).toBe(true);
  });

  it('rolls back every created design and file when a remote image fails after preflight', async () => {
    const { service, designService, aiMediaService, aiSettings, fileService } = makeService();
    aiMediaService.saveUrlToFile
      .mockResolvedValueOnce({ id: 'remote-a', path: '/uploads/org/remote-a.png' })
      .mockRejectedValueOnce(new Error('Blocked URL'));
    seedPayload();

    await service.processBulkCreate('job-1');

    expect(designService.createDesign).toHaveBeenCalledTimes(1);
    expect(designService.deleteDesign).toHaveBeenCalledWith('org-1', 'design-Hello Ada');
    expect(aiMediaService.saveUrlToFile).toHaveBeenCalledTimes(2);
    for (const id of ['file-1', 'file-2', 'file-3', 'remote-a']) {
      expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', id);
    }
    expect(fileService.saveGeneratedMedia.mock.calls.some(([, data]) => data.name === 'Campaign.zip')).toBe(false);
    expect(fileService.deleteFolder).toHaveBeenCalledWith('org-1', 'batch-folder');
    expect(aiSettings.updateMediaJob.mock.calls.some(([, , update]) => update.status === 'completed')).toBe(false);
    const failed = aiSettings.updateMediaJob.mock.calls.find(([, , update]) => update.status === 'failed')?.[2];
    expect(failed.error).toBe('Row 2: Blocked URL');
    const results = JSON.parse(failed.inputJson);
    expect(results).toHaveLength(2);
    expect(results.every((result: any) =>
      !result.designId && !result.editableFileId && result.fileIds.length === 0
    )).toBe(true);
    expect(results[1].error).toBe('Blocked URL');
  });

  it('enforces the batch cap before saving an oversized editable archive', async () => {
    const { service, designExport, aiSettings, fileService } = makeService();
    seedPayload([{ name: 'Only', image: 'https://cdn.example.test/a.png' }]);
    vi.spyOn(designExport, 'buildBundleForDoc').mockResolvedValueOnce({
      bytes: { length: 128 * 1024 * 1024 + 1 },
    } as any);

    await service.processBulkCreate('job-1');

    const failed = aiSettings.updateMediaJob.mock.calls.find(([, , update]) => update.status === 'failed')?.[2];
    expect(failed.error).toBe('Row 1: Bulk Create output exceeds the 128 MB batch limit.');
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(2);
    expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', 'file-1');
    expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', 'file-2');
  });

  it('escapes normalized source CSV cells for a rerun', async () => {
    const { service, writes } = makeService();
    seedPayload([{ name: 'Ada, "A"\nLine', image: 'https://cdn.example.test/a.png' }]);

    await service.processBulkCreate('job-1');

    const zipWrite = [...writes].reverse().find((write) => write.mime === 'application/zip')!;
    const entries = unzipSync(zipWrite.bytes);
    expect(strFromU8(entries['source/data.csv'])).toBe(
      '"name","image"\r\n"Ada, ""A""\nLine","https://cdn.example.test/a.png"'
    );
  });

  it('rolls back editable and source artifacts when final ZIP persistence fails', async () => {
    const { service, fileService, aiSettings } = makeService();
    let generated = 0;
    fileService.saveGeneratedMedia.mockImplementation(async (_org: string, data: any) => {
      if (data.name === 'Campaign.zip') throw new Error('ZIP write failed');
      return { id: `file-${++generated}`, ...data };
    });
    seedPayload([{ name: 'Only', image: 'https://cdn.example.test/a.png' }]);

    await service.processBulkCreate('job-1');

    for (const id of ['file-1', 'file-2', 'file-3', 'file-4', 'file-5']) {
      expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', id);
    }
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'failed', error: 'ZIP write failed',
    }));
    const failed = aiSettings.updateMediaJob.mock.calls.find(([, , update]) => update.status === 'failed')?.[2];
    expect(JSON.parse(failed.inputJson)[0].editableFileId).toBeUndefined();
  });

  it('tracks an imported row image for rollback when metadata reading fails', async () => {
    const { service, fileService, localAdapter, aiSettings } = makeService();
    localAdapter.readFile.mockRejectedValueOnce(new Error('metadata read failed'));
    seedPayload([{ name: 'Only', image: 'https://cdn.example.test/a.png' }]);

    await service.processBulkCreate('job-1');

    expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', 'remote-a');
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', expect.objectContaining({
      status: 'failed', error: 'Row 1: metadata read failed',
    }));
  });

  it('keeps the editable archive when thumbnail metadata is unavailable', async () => {
    const { service, fileService, aiSettings } = makeService();
    fileService.saveMediaInformation.mockRejectedValue(new Error('thumbnail failed'));
    seedPayload([{ name: 'Only', image: 'https://cdn.example.test/a.png' }]);

    await service.processBulkCreate('job-1');

    expect(aiSettings.updateMediaJob.mock.calls.some(([, , update]) => update.status === 'completed')).toBe(true);
    expect(fileService.deleteFile).not.toHaveBeenCalled();
  });

  it('cleans generated previews but preserves a caller-selected folder on rollback', async () => {
    const { service, designService, fileService } = makeService();
    designService.createDesign
      .mockResolvedValueOnce({ id: 'design-1', previewFileId: 'preview-1' })
      .mockRejectedValueOnce(new Error('render failed'));
    seedPayload();
    const payload = JSON.parse(redis.get('design-bulk:payload:job-1')!);
    payload.folderId = 'folder-1';
    payload.folderOwned = false;
    redis.set('design-bulk:payload:job-1', JSON.stringify(payload));

    await service.processBulkCreate('job-1');

    expect(designService.deleteDesign).toHaveBeenCalledWith('org-1', 'design-1');
    expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', 'preview-1');
    expect(fileService.deleteFolder).not.toHaveBeenCalled();
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
      status: 'failed', error: 'Row 1: Invalid row',
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
