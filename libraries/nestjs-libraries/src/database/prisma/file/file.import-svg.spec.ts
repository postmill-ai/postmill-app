import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import sharp from 'sharp';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import { FileService } from './file.service';

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<script>alert(1)</script><rect width="24" height="24" fill="#f00"/></svg>'
);

function svgResponse(contentType: string) {
  return new Response(SVG, { status: 200, headers: { 'content-type': contentType } });
}

function makeService() {
  const writeBuffer = vi.fn().mockResolvedValue('/uploads/org-1/licensed.png');
  const saveGeneratedMedia = vi.fn().mockImplementation(async (_org, data) => ({ id: 'file-1', ...data }));
  const fileRepo = {
    saveGeneratedMedia,
    getFolderById: vi.fn().mockResolvedValue(null),
  };
  const storage = {
    resolveAdapterForFolderWithConfigId: vi.fn().mockResolvedValue({
      adapter: { writeBuffer },
      configId: null,
    }),
    assertWithinProviderQuota: vi.fn().mockResolvedValue(undefined),
  };
  const service = new FileService(fileRepo as any, storage as any);
  return { service, writeBuffer, saveGeneratedMedia };
}

beforeEach(() => mockSafeFetch.mockReset());

describe('FileService.importFromUrl — SVG licensed downloads', () => {
  it.each(['image/svg+xml', 'application/octet-stream'])(
    'rasterizes an SVG download (served as %s) to PNG when rasterizeSvg is set',
    async (contentType) => {
      mockSafeFetch.mockResolvedValue(svgResponse(contentType));
      const { service, writeBuffer, saveGeneratedMedia } = makeService();

      await service.importFromUrl('org-1', {
        url: 'https://cdn.magnific.example/licensed.svg',
        name: 'magnific-1.png',
        source: 'magnific',
        type: 'icon',
        rasterizeSvg: true,
      });

      const [stored, mime] = writeBuffer.mock.calls[0];
      expect(mime).toBe('image/png');
      const meta = await sharp(stored as Buffer).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(2048);
      expect((stored as Buffer).includes('<script>')).toBe(false);
      expect(saveGeneratedMedia.mock.calls[0][1]).toMatchObject({ type: 'image' });
    }
  );

  it('still rejects SVG with 415 for ordinary imports', async () => {
    mockSafeFetch.mockResolvedValue(svgResponse('image/svg+xml'));
    const { service, writeBuffer } = makeService();

    const err = await service
      .importFromUrl('org-1', { url: 'https://example.com/a.svg', name: 'a.svg' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(415);
    expect(writeBuffer).not.toHaveBeenCalled();
  });
});
