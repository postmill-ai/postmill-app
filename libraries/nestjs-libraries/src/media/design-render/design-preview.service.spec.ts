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

describe('DesignPreviewService', () => {
  let renderService: { renderPage: ReturnType<typeof vi.fn> };
  let storageService: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let fileService: { saveFile: ReturnType<typeof vi.fn> };
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
    };
    service = new DesignPreviewService(
      renderService as any,
      storageService as any,
      fileService as any
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
