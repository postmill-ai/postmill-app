import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ enabled: true, send: vi.fn() }));

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => h.send(...args) },
  isInngestEnabled: () => h.enabled,
}));

const redisMock = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redisMock,
}));

import { DesignExportService, DESIGN_EXPORT_MAX_ASSET_BYTES } from './design-export.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { parsePostmillFile, POSTMILL_FORMAT_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// Minimal TTF magic for the sniffer.
const TTF_BYTES = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x80, 0x00, 0x03, 0x00, 0x10]);

const docWithMedia = () =>
  ({
    version: DESIGNER_DOC_VERSION,
    mode: 'image',
    outputs: [
      {
        id: 'out-1',
        formatId: 'square',
        name: 'Square',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children: [
          {
            id: 'el-1',
            type: 'image',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            fileId: 'file-1',
            src: '/uploads/org-1/aaaa.png',
          },
          {
            id: 'el-2',
            type: 'text',
            x: 0,
            y: 0,
            width: 300,
            height: 60,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Hello',
            fontFamily: 'Acme',
          },
        ],
      },
    ],
  }) as any;

const makeService = (over: {
  design?: any;
  template?: any;
  files?: Record<string, any>;
  customFonts?: any[];
  job?: any;
  payload?: any;
  claimed?: boolean;
} = {}) => {
  const lifecycle = { createPendingJob: vi.fn(async (p: any) => ({ id: 'job-1', status: 'pending', ...p })) };
  const aiSettings = {
    getMediaJobById: vi.fn(async (_org: string, id: string) => (id === 'job-1' ? over.job ?? null : null)),
    getMediaJobByIdUnscoped: vi.fn(async (id: string) => (id === 'job-1' ? over.job ?? null : null)),
    updateMediaJob: vi.fn(async () => undefined),
  };
  const designService = {
    getDesign: vi.fn(async () => over.design ?? null),
    getTemplate: vi.fn(async () => over.template ?? null),
  };
  const fileService = {
    getFileById: vi.fn(async (_org: string, id: string) => over.files?.[id] ?? null),
    saveGeneratedMedia: vi.fn(async (_org: string, data: any) => ({ id: 'artifact-file-1', ...data })),
    saveMediaInformation: vi.fn(async () => ({})),
  };
  const assetAdapter = { readFile: vi.fn(async () => PNG_BYTES) };
  const localAdapter = {
    readFile: vi.fn(async () => TTF_BYTES),
    writeBuffer: vi.fn(async () => 'https://host.test/uploads/org-1/artifact.zip'),
  };
  const storageService = {
    resolveAdapterForFolder: vi.fn(async () => assetAdapter),
    getLocalAdapterForOrg: vi.fn(async () => localAdapter),
  };
  const brandsService = {
    getCustomFonts: vi.fn(async () => over.customFonts ?? []),
  };

  const service = new DesignExportService(
    lifecycle as any,
    aiSettings as any,
    designService as any,
    new DesignerDocService(),
    fileService as any,
    storageService as any,
    brandsService as any
  );

  return { service, lifecycle, aiSettings, designService, fileService, assetAdapter, localAdapter, brandsService, storageService };
};

const pendingExportJob = {
  id: 'job-1',
  organizationId: 'org-1',
  provider: 'design-export',
  status: 'pending',
};

describe('DesignExportService.enqueueExport', () => {
  beforeEach(() => {
    h.enabled = true;
    h.send.mockReset();
    redisMock.get.mockReset().mockResolvedValue(null);
    redisMock.set.mockClear();
  });

  it('creates an uncosted design-export job, stashes the payload, and dispatches a deterministic event', async () => {
    const { service, lifecycle } = makeService({ design: { id: 'd1', name: 'Hero', doc: docWithMedia() } });

    const res = await service.enqueueExport('org-1', 'user-1', { kind: 'design', id: 'd1' });

    expect(res.id).toBe('job-1');
    expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        provider: 'design-export',
        costUsd: 0,
        creditType: 'none', // NO_CREDIT — exports never consume credits
      })
    );
    expect(redisMock.set).toHaveBeenCalledWith(
      'design-export:payload:job-1',
      expect.stringContaining('"sourceId":"d1"'),
      'EX',
      expect.any(Number)
    );
    const bucket = Math.floor(Date.now() / 60000);
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/design-export',
      data: { jobId: 'job-1' },
      id: `design-export-job-1-${bucket}`,
    });
  });

  it('404s at enqueue time for a design the org cannot see', async () => {
    const { service } = makeService({ design: null });
    await expect(
      service.enqueueExport('org-1', 'user-1', { kind: 'design', id: 'nope' })
    ).rejects.toThrow('Design not found');
  });
});

describe('DesignExportService.processExport', () => {
  beforeEach(() => {
    h.enabled = true;
    h.send.mockReset();
    redisMock.set.mockClear();
    redisMock.set.mockResolvedValue('OK');
  });

  const primePayload = (payload: any) => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === 'design-export:payload:job-1' ? JSON.stringify(payload) : null
    );
  };

  it('no-ops for a job that is not pending', async () => {
    const { service, aiSettings } = makeService({ job: { ...pendingExportJob, status: 'completed' } });
    await service.processExport('job-1');
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalled();
  });

  it('fails cleanly when the payload TTL expired', async () => {
    const { service, aiSettings } = makeService({ job: pendingExportJob });
    redisMock.get.mockResolvedValue(null);

    await service.processExport('job-1');

    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith('org-1', 'job-1', {
      status: 'failed',
      error: 'Export payload expired — please re-export the design',
    });
  });

  it('no-ops when another runner holds the claim', async () => {
    const { service, aiSettings } = makeService({ job: pendingExportJob });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });
    // Claim SET NX loses (returns null).
    redisMock.set.mockImplementation(async (key: string) =>
      key === 'design-export:claim:job-1' ? null : 'OK'
    );

    await service.processExport('job-1');

    expect(aiSettings.updateMediaJob).not.toHaveBeenCalled();
  });

  it('bundles assets + fonts and completes with the artifact path', async () => {
    const { service, aiSettings, localAdapter, fileService } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Hero', doc: docWithMedia() },
      files: {
        'file-1': {
          id: 'file-1',
          folderId: null,
          path: 'https://host.test/uploads/org-1/aaaa.png',
          originalName: 'hero.png',
          name: 'hero.png',
          fileSize: PNG_BYTES.length,
        },
      },
      customFonts: [
        {
          family: 'Acme',
          fileId: 'font-file',
          path: 'https://host.test/uploads/org-1/acme.ttf',
          weights: [700],
          italic: true,
        },
        { family: 'Unused', fileId: 'f2', path: 'x', weights: [400] },
      ],
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    // Artifact written + registered + job completed with its path.
    expect(localAdapter.writeBuffer).toHaveBeenCalledTimes(1);
    const artifact: Buffer = localAdapter.writeBuffer.mock.calls[0][0];
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ name: 'Hero.pdesign', type: 'document', fileSize: artifact.length })
    );
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', {
      status: 'completed',
      artifactUrl: 'https://host.test/uploads/org-1/artifact.zip',
      error: null,
    });

    // The bundle parses back: manifest matches contents, doc verbatim.
    const parsed = parsePostmillFile(artifact);
    expect(parsed.manifest.formatVersion).toBe(POSTMILL_FORMAT_VERSION);
    expect(parsed.manifest.assets).toEqual({
      'file-1': {
        path: 'assets/file-1.png',
        mime: 'image/png',
        originalName: 'hero.png',
        size: PNG_BYTES.length,
      },
    });
    expect(parsed.manifest.fonts).toEqual([
      { family: 'Acme', weight: 700, italic: true, path: 'assets/fonts/Acme-700i.ttf' },
    ]);
    expect(Buffer.from(parsed.assets.get('assets/file-1.png')!)).toEqual(PNG_BYTES);
    expect(Buffer.from(parsed.assets.get('assets/fonts/Acme-700i.ttf')!)).toEqual(TTF_BYTES);
    expect((parsed.doc as any).outputs[0].children[0].fileId).toBe('file-1'); // verbatim on export
  });

  it('fails the job with a clear message when assets exceed the 1 GB ceiling', async () => {
    const { service, aiSettings, localAdapter } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Huge', doc: docWithMedia() },
      files: {
        'file-1': {
          id: 'file-1',
          folderId: null,
          path: 'p',
          originalName: 'big.mp4',
          name: 'big.mp4',
          fileSize: DESIGN_EXPORT_MAX_ASSET_BYTES + 1,
        },
      },
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    expect(localAdapter.writeBuffer).not.toHaveBeenCalled();
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith('org-1', 'job-1', {
      status: 'failed',
      error: expect.stringMatching(/over the 1 GB export ceiling/),
    });
  });

  it('skips referenced files that no longer resolve instead of failing', async () => {
    const { service, aiSettings, localAdapter } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Hero', doc: docWithMedia() },
      files: {}, // file-1 gone
      customFonts: [],
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    const artifact: Buffer = localAdapter.writeBuffer.mock.calls[0][0];
    const parsed = parsePostmillFile(artifact);
    expect(parsed.manifest.assets).toBeUndefined();
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith(
      'org-1',
      'job-1',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('exports a template source', async () => {
    const { service, designService, aiSettings } = makeService({
      job: pendingExportJob,
      template: { id: 't1', name: 'Tpl', doc: docWithMedia() },
      files: {},
    });
    primePayload({ organizationId: 'org-1', kind: 'template', sourceId: 't1' });

    await service.processExport('job-1');

    expect(designService.getTemplate).toHaveBeenCalledWith('org-1', 't1');
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith(
      'org-1',
      'job-1',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('copies the design preview as the artifact thumbnail and links the metadata to the source', async () => {
    const { service, aiSettings, localAdapter, fileService } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Hero', doc: docWithMedia(), previewFileId: 'preview-1' },
      files: {
        'file-1': {
          id: 'file-1',
          folderId: null,
          path: 'https://host.test/uploads/org-1/aaaa.png',
          originalName: 'hero.png',
          name: 'hero.png',
          fileSize: PNG_BYTES.length,
        },
        'preview-1': {
          id: 'preview-1',
          folderId: null,
          path: 'https://host.test/uploads/org-1/preview.png',
          name: 'preview.png',
          fileSize: PNG_BYTES.length,
        },
      },
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    // Zip artifact + preview copy.
    expect(localAdapter.writeBuffer).toHaveBeenCalledTimes(2);
    expect(localAdapter.writeBuffer.mock.calls[1][1]).toBe('image/png');
    const copiedPath = localAdapter.writeBuffer.mock.results[1].value
      ? await localAdapter.writeBuffer.mock.results[1].value
      : undefined;
    expect(fileService.saveMediaInformation).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ id: 'artifact-file-1', thumbnail: copiedPath })
    );
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        metadata: { source: 'design-export', mime: 'application/zip', kind: 'design', designId: 'd1' },
      })
    );
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith(
      'org-1',
      'job-1',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('completes without a thumbnail when the source has no preview file', async () => {
    const { service, aiSettings, localAdapter, fileService } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Hero', doc: docWithMedia() },
      files: {},
      customFonts: [],
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    expect(localAdapter.writeBuffer).toHaveBeenCalledTimes(1);
    expect(fileService.saveMediaInformation).not.toHaveBeenCalled();
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith(
      'org-1',
      'job-1',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('still completes when the preview bytes cannot be read', async () => {
    const { service, aiSettings, localAdapter, fileService } = makeService({
      job: pendingExportJob,
      design: { id: 'd1', name: 'Hero', doc: docWithMedia(), previewFileId: 'preview-1' },
      files: {
        'preview-1': {
          id: 'preview-1',
          folderId: null,
          path: 'https://host.test/uploads/org-1/preview.png',
          name: 'preview.png',
          fileSize: PNG_BYTES.length,
        },
      },
      customFonts: [],
    });
    localAdapter.readFile.mockImplementation(async (p: string) => {
      if (p.includes('preview')) throw new Error('object gone');
      return PNG_BYTES;
    });
    primePayload({ organizationId: 'org-1', kind: 'design', sourceId: 'd1' });

    await service.processExport('job-1');

    expect(fileService.saveMediaInformation).not.toHaveBeenCalled();
    expect(aiSettings.updateMediaJob).toHaveBeenLastCalledWith(
      'org-1',
      'job-1',
      expect.objectContaining({ status: 'completed' })
    );
  });
});

describe('DesignExportService.getJob', () => {
  it('never returns another org\'s job or a non-export job', async () => {
    const { service } = makeService({ job: pendingExportJob });
    expect(await service.getJob('org-1', 'job-1')).toMatchObject({ id: 'job-1' });
    expect(await service.getJob('org-2', 'job-1')).toBeNull();

    const other = makeService({ job: { ...pendingExportJob, provider: 'chromium-ffmpeg' } });
    expect(await other.service.getJob('org-1', 'job-1')).toBeNull();
  });
});
