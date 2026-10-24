import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesignPreviewService } from './design-preview.service';

const imageDoc: any = {
  mode: 'image',
  outputs: [
    { id: 'out-1', formatId: 'square', name: 'Square', width: 1080, height: 1080, children: [{ type: 'text' }] },
  ],
};

const videoDoc: any = {
  mode: 'video',
  outputs: [
    {
      id: 'out-1',
      formatId: 'reel',
      name: 'Reel',
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 5000,
      tracks: [
        {
          id: 'tr-1',
          type: 'text',
          clips: [
            {
              id: 'clip-1',
              startMs: 0,
              endMs: 2000,
              text: 'Hello',
              x: 10,
              y: 20,
              width: 300,
              height: 80,
            },
          ],
        },
      ],
    },
  ],
};

// A video doc whose t=0 content is a video clip — the case that used to
// render as a pure black fallback base.
const videoClipDoc: any = {
  mode: 'video',
  outputs: [
    {
      id: 'out-1',
      formatId: 'reel',
      name: 'Reel',
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 5000,
      tracks: [
        {
          id: 'tr-vid',
          type: 'video',
          clips: [
            {
              id: 'clip-vid',
              startMs: 0,
              endMs: 5000,
              src: '/uploads/org-1/vid.mp4',
              fileId: 'file-vid-1',
            },
          ],
        },
      ],
    },
  ],
};

// Same as videoClipDoc but the clip predates fileId — only a src URL.
const videoClipSrcOnlyDoc: any = {
  mode: 'video',
  outputs: [
    {
      id: 'out-1',
      formatId: 'reel',
      name: 'Reel',
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 5000,
      tracks: [
        {
          id: 'tr-vid',
          type: 'video',
          clips: [
            {
              id: 'clip-vid',
              startMs: 0,
              endMs: 5000,
              src: '/uploads/org-1/vid.mp4',
            },
          ],
        },
      ],
    },
  ],
};

describe('DesignPreviewService', () => {
  let renderService: { renderPage: ReturnType<typeof vi.fn> };
  let storageService: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let fileService: {
    saveFile: ReturnType<typeof vi.fn>;
    getByIds: ReturnType<typeof vi.fn>;
    getFileByPath: ReturnType<typeof vi.fn>;
  };
  let videoThumbnailService: { generateForFile: ReturnType<typeof vi.fn> };
  let adapter: { writeBuffer: ReturnType<typeof vi.fn>; removeFile: ReturnType<typeof vi.fn> };
  let service: DesignPreviewService;

  beforeEach(() => {
    renderService = { renderPage: vi.fn().mockResolvedValue(Buffer.from('png')) };
    adapter = {
      writeBuffer: vi.fn().mockResolvedValue('/uploads/preview-1.png'),
      removeFile: vi.fn().mockResolvedValue(undefined),
    };
    storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue(adapter),
    };
    fileService = {
      saveFile: vi.fn().mockResolvedValue({ id: 'file-1', path: '/uploads/preview-1.png' }),
      getByIds: vi.fn().mockResolvedValue([]),
      getFileByPath: vi.fn().mockResolvedValue(null),
    };
    videoThumbnailService = {
      generateForFile: vi.fn().mockResolvedValue(null),
    };
    service = new DesignPreviewService(
      renderService as any,
      storageService as any,
      fileService as any,
      videoThumbnailService as any
    );
  });

  describe('renderPreviewBuffer', () => {
    it('renders an image doc as-is, output 0 page 1', async () => {
      const out = await service.renderPreviewBuffer(imageDoc, { orgId: 'org-1' });

      expect(out).toEqual(Buffer.from('png'));
      expect(renderService.renderPage).toHaveBeenCalledWith(imageDoc, 0, { orgId: 'org-1' });
    });

    it('projects a video doc through the poster before rendering', async () => {
      await service.renderPreviewBuffer(videoDoc, { orgId: 'org-1' });

      const [renderDoc, outputIndex] = renderService.renderPage.mock.calls[0];
      expect(outputIndex).toBe(0);
      // The projected output is a synthetic IMAGE output: no tracks, the t=0
      // clip as a text element.
      const output = renderDoc.outputs[0];
      expect(output.tracks).toBeUndefined();
      expect(Array.isArray(output.children)).toBe(true);
      expect(output.children).toHaveLength(1);
      expect(output.children[0]).toMatchObject({ type: 'text', text: 'Hello' });
      // The source doc is not mutated.
      expect(videoDoc.outputs[0].tracks).toHaveLength(1);
    });

    it('rejects when the underlying render rejects', async () => {
      renderService.renderPage.mockRejectedValue(new Error('video output'));

      await expect(service.renderPreviewBuffer(videoDoc)).rejects.toThrow('video output');
    });

    it('draws a video clip from its File thumbnail poster', async () => {
      fileService.getByIds.mockResolvedValue([
        { id: 'file-vid-1', thumbnail: '/uploads/org-1/thumb-1.jpg' },
      ]);

      await service.renderPreviewBuffer(videoClipDoc, { orgId: 'org-1' });

      const [renderDoc] = renderService.renderPage.mock.calls[0];
      const children = renderDoc.outputs[0].children;
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({
        type: 'image',
        src: '/uploads/org-1/thumb-1.jpg',
        fitMode: 'cover',
        width: 1080,
        height: 1920,
      });
      // A stored thumbnail needs no extraction.
      expect(videoThumbnailService.generateForFile).not.toHaveBeenCalled();
    });

    it('self-heals a missing thumbnail via on-demand extraction (local only)', async () => {
      fileService.getByIds.mockResolvedValue([{ id: 'file-vid-1', thumbnail: null }]);
      videoThumbnailService.generateForFile.mockResolvedValue('/uploads/org-1/thumb-new.jpg');

      await service.renderPreviewBuffer(videoClipDoc, { orgId: 'org-1' });

      expect(videoThumbnailService.generateForFile).toHaveBeenCalledWith(
        'org-1',
        'file-vid-1',
        { localOnly: true }
      );
      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children[0]).toMatchObject({
        type: 'image',
        src: '/uploads/org-1/thumb-new.jpg',
      });
    });

    it('skips the clip (never fails the preview) when extraction yields nothing', async () => {
      fileService.getByIds.mockResolvedValue([{ id: 'file-vid-1', thumbnail: null }]);
      videoThumbnailService.generateForFile.mockResolvedValue(null);

      await service.renderPreviewBuffer(videoClipDoc, { orgId: 'org-1' });

      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children).toHaveLength(0);
      expect(renderService.renderPage).toHaveBeenCalledTimes(1);
    });

    it('renders without posters when poster resolution itself fails', async () => {
      fileService.getByIds.mockRejectedValue(new Error('db down'));

      await service.renderPreviewBuffer(videoClipDoc, { orgId: 'org-1' });

      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children).toHaveLength(0);
      expect(videoThumbnailService.generateForFile).not.toHaveBeenCalled();
    });

    it('skips poster resolution entirely without an orgId', async () => {
      await service.renderPreviewBuffer(videoClipDoc);

      expect(fileService.getByIds).not.toHaveBeenCalled();
      expect(videoThumbnailService.generateForFile).not.toHaveBeenCalled();
      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children).toHaveLength(0);
    });

    it('resolves a fileId-less clip by its src path (stored thumbnail)', async () => {
      fileService.getFileByPath.mockResolvedValue({
        id: 'file-vid-1',
        thumbnail: '/uploads/org-1/thumb-1.jpg',
      });

      await service.renderPreviewBuffer(videoClipSrcOnlyDoc, { orgId: 'org-1' });

      expect(fileService.getFileByPath).toHaveBeenCalledWith('org-1', '/uploads/org-1/vid.mp4');
      expect(fileService.getByIds).not.toHaveBeenCalled();
      expect(videoThumbnailService.generateForFile).not.toHaveBeenCalled();
      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children[0]).toMatchObject({
        type: 'image',
        src: '/uploads/org-1/thumb-1.jpg',
      });
    });

    it('self-heals a fileId-less clip whose File row has no thumbnail yet', async () => {
      fileService.getFileByPath.mockResolvedValue({ id: 'file-vid-1', thumbnail: null });
      videoThumbnailService.generateForFile.mockResolvedValue('/uploads/org-1/thumb-new.jpg');

      await service.renderPreviewBuffer(videoClipSrcOnlyDoc, { orgId: 'org-1' });

      expect(videoThumbnailService.generateForFile).toHaveBeenCalledWith(
        'org-1',
        'file-vid-1',
        { localOnly: true }
      );
      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children[0]).toMatchObject({
        type: 'image',
        src: '/uploads/org-1/thumb-new.jpg',
      });
    });

    it('skips a fileId-less clip whose src matches no File row', async () => {
      fileService.getFileByPath.mockResolvedValue(null);

      await service.renderPreviewBuffer(videoClipSrcOnlyDoc, { orgId: 'org-1' });

      const [renderDoc] = renderService.renderPage.mock.calls[0];
      expect(renderDoc.outputs[0].children).toHaveLength(0);
    });
  });

  describe('uploadPreview', () => {
    it('writes the buffer and registers an internal design-preview file', async () => {
      const buffer = Buffer.from('png-bytes');

      const fileId = await service.uploadPreview('org-1', buffer);

      expect(fileId).toBe('file-1');
      expect(storageService.getLocalAdapterForOrg).toHaveBeenCalledWith('org-1', true);
      expect(adapter.writeBuffer).toHaveBeenCalledWith(buffer, 'image/png');
      expect(fileService.saveFile).toHaveBeenCalledWith(
        'org-1',
        expect.stringMatching(/^design-preview-\d+\.png$/),
        '/uploads/preview-1.png',
        expect.stringMatching(/^design-preview-\d+\.png$/),
        undefined,
        buffer.length,
        { internal: 'design-preview' }
      );
    });

    it('removes the stored object when the File row save fails', async () => {
      fileService.saveFile.mockRejectedValue(new Error('db down'));

      await expect(service.uploadPreview('org-1', Buffer.from('x'))).rejects.toThrow('db down');
      expect(adapter.removeFile).toHaveBeenCalledWith('/uploads/preview-1.png');
    });
  });
});
