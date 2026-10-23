import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractVideoFrame = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/media/video-frame', () => ({
  extractVideoFrame: (...args: any[]) => mockExtractVideoFrame(...args),
  VIDEO_FRAME_MAX_BYTES: 256 * 1024 * 1024,
}));

let inngestEnabled = false;
const mockInngestSend = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => mockInngestSend(...args) },
  isInngestEnabled: () => inngestEnabled,
}));

import { VideoThumbnailService } from './video-thumbnail.service';

const fakeFrame = Buffer.from('jpeg-bytes');

function makeService(over: {
  file?: any;
  adapterType?: string;
} = {}) {
  const adapter = {
    type: over.adapterType ?? 'LOCAL',
    readFile: vi.fn().mockResolvedValue(Buffer.from('video-bytes')),
    writeBuffer: vi.fn().mockResolvedValue('/uploads/org-1/thumb-1.jpg'),
  };
  const storageService = {
    resolveAdapterForFolder: vi.fn().mockResolvedValue(adapter),
  };
  const fileService = {
    getFileById: vi.fn().mockResolvedValue(
      over.file === undefined
        ? {
            id: 'file-1',
            type: 'video',
            path: '/uploads/org-1/vid.mp4',
            thumbnail: null,
            alt: 'a video',
            fileSize: 1024,
            folderId: null,
          }
        : over.file
    ),
    saveMediaInformation: vi.fn().mockResolvedValue({}),
    findVideosWithoutThumbnail: vi.fn().mockResolvedValue([]),
  };
  const service = new VideoThumbnailService(
    storageService as any,
    fileService as any
  );
  return { service, adapter, storageService, fileService };
}

describe('VideoThumbnailService.generateForFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestEnabled = false;
    mockExtractVideoFrame.mockResolvedValue(fakeFrame);
  });

  it('extracts a frame, stores it beside the video, and persists the thumbnail', async () => {
    const { service, adapter, fileService } = makeService();

    const out = await service.generateForFile('org-1', 'file-1');

    expect(out).toBe('/uploads/org-1/thumb-1.jpg');
    expect(adapter.readFile).toHaveBeenCalledWith('/uploads/org-1/vid.mp4');
    expect(mockExtractVideoFrame).toHaveBeenCalledWith(
      Buffer.from('video-bytes'),
      'mp4'
    );
    expect(adapter.writeBuffer).toHaveBeenCalledWith(fakeFrame, 'image/jpeg');
    expect(fileService.saveMediaInformation).toHaveBeenCalledWith('org-1', {
      id: 'file-1',
      thumbnail: '/uploads/org-1/thumb-1.jpg',
      alt: 'a video',
      thumbnailTimestamp: 0,
    });
  });

  it('is idempotent: an existing thumbnail is returned without work', async () => {
    const { service, adapter } = makeService({
      file: {
        id: 'file-1',
        type: 'video',
        path: '/uploads/org-1/vid.mp4',
        thumbnail: '/uploads/org-1/existing.jpg',
        alt: '',
        fileSize: 1024,
        folderId: null,
      },
    });

    const out = await service.generateForFile('org-1', 'file-1');

    expect(out).toBe('/uploads/org-1/existing.jpg');
    expect(adapter.readFile).not.toHaveBeenCalled();
  });

  it('returns null for a missing or non-video file', async () => {
    expect(await makeService({ file: null }).service.generateForFile('org-1', 'nope')).toBeNull();
    const imageFile = {
      id: 'file-2',
      type: 'image',
      path: '/uploads/org-1/img.png',
      thumbnail: null,
      alt: '',
      fileSize: 10,
      folderId: null,
    };
    expect(
      await makeService({ file: imageFile }).service.generateForFile('org-1', 'file-2')
    ).toBeNull();
    expect(mockExtractVideoFrame).not.toHaveBeenCalled();
  });

  it('accepts the legacy full-MIME type vocabulary', async () => {
    const { service } = makeService({
      file: {
        id: 'file-3',
        type: 'video/mp4',
        path: '/uploads/org-1/vid.mp4',
        thumbnail: null,
        alt: '',
        fileSize: 10,
        folderId: null,
      },
    });

    expect(await service.generateForFile('org-1', 'file-3')).toBe('/uploads/org-1/thumb-1.jpg');
  });

  it('localOnly skips files on a remote storage adapter', async () => {
    const { service, adapter } = makeService({ adapterType: 'S3' });

    const out = await service.generateForFile('org-1', 'file-1', { localOnly: true });

    expect(out).toBeNull();
    expect(adapter.readFile).not.toHaveBeenCalled();
  });

  it('reads through the owning adapter when not localOnly', async () => {
    const { service, adapter } = makeService({ adapterType: 'S3' });

    const out = await service.generateForFile('org-1', 'file-1');

    expect(out).toBe('/uploads/org-1/thumb-1.jpg');
    expect(adapter.readFile).toHaveBeenCalled();
  });

  it('skips oversized videos without reading them', async () => {
    const { service, adapter } = makeService({
      file: {
        id: 'file-4',
        type: 'video',
        path: '/uploads/org-1/huge.mp4',
        thumbnail: null,
        alt: '',
        fileSize: 512 * 1024 * 1024,
        folderId: null,
      },
    });

    expect(await service.generateForFile('org-1', 'file-4')).toBeNull();
    expect(adapter.readFile).not.toHaveBeenCalled();
  });

  it('never throws: a storage or ffmpeg failure returns null', async () => {
    const { service, adapter } = makeService();
    adapter.readFile.mockRejectedValue(new Error('disk gone'));
    expect(await service.generateForFile('org-1', 'file-1')).toBeNull();

    const { service: service2 } = makeService();
    mockExtractVideoFrame.mockResolvedValue(null);
    expect(await service2.generateForFile('org-1', 'file-1')).toBeNull();
  });
});

describe('VideoThumbnailService.enqueueGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestEnabled = false;
  });

  it('sends nothing when Inngest is disabled', () => {
    const { service } = makeService();
    service.enqueueGenerate('org-1', 'file-1');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('sends the generate event when Inngest is enabled', () => {
    inngestEnabled = true;
    mockInngestSend.mockResolvedValue(undefined);
    const { service } = makeService();

    service.enqueueGenerate('org-1', 'file-1');

    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'media/video-thumbnail.generate',
      data: { organizationId: 'org-1', fileId: 'file-1' },
    });
  });

  it('swallows a send failure (fire-and-forget)', async () => {
    inngestEnabled = true;
    mockInngestSend.mockRejectedValue(new Error('inngest down'));
    const { service } = makeService();

    expect(() => service.enqueueGenerate('org-1', 'file-1')).not.toThrow();
    // Let the rejected promise settle — an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('VideoThumbnailService.backfillOrgThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestEnabled = false;
    mockExtractVideoFrame.mockResolvedValue(fakeFrame);
  });

  it('generates thumbnails for every backfill row and counts outcomes', async () => {
    const { service, fileService } = makeService();
    fileService.findVideosWithoutThumbnail.mockResolvedValue([
      { id: 'file-1' },
      { id: 'file-2' },
      { id: 'file-3' },
    ]);
    fileService.getFileById.mockImplementation(async (_org: string, id: string) => ({
      id,
      type: 'video',
      path: `/uploads/org-1/${id}.mp4`,
      thumbnail: id === 'file-2' ? '/already.jpg' : null,
      alt: '',
      fileSize: 100,
      folderId: null,
    }));

    const stats = await service.backfillOrgThumbnails('org-1');

    expect(stats).toEqual({ scanned: 3, generated: 3, failed: 0 });
  });

  it('counts failures without aborting the run', async () => {
    const { service, fileService } = makeService();
    fileService.findVideosWithoutThumbnail.mockResolvedValue([
      { id: 'file-1' },
      { id: 'file-2' },
    ]);
    mockExtractVideoFrame
      .mockResolvedValueOnce(fakeFrame)
      .mockResolvedValueOnce(null);

    const stats = await service.backfillOrgThumbnails('org-1');

    expect(stats).toEqual({ scanned: 2, generated: 1, failed: 1 });
  });
});
