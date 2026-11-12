import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import sharp from 'sharp';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

import { FileService, nameMatchingMime } from './file.service';

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<script>alert(1)</script><rect width="24" height="24" fill="#f00"/></svg>'
);

function svgResponse(contentType: string) {
  return new Response(SVG, { status: 200, headers: { 'content-type': contentType } });
}

function makeService(assertQuota = vi.fn().mockResolvedValue(undefined)) {
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
    assertWithinProviderQuota: assertQuota,
  };
  const service = new FileService(fileRepo as any, storage as any);
  return { service, writeBuffer, saveGeneratedMedia, assertQuota };
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

  it('checks quota once, against the converted PNG bytes, and writes nothing when they exceed it', async () => {
    mockSafeFetch.mockResolvedValue(svgResponse('image/svg+xml'));
    // Remaining quota sits between the SVG size and the (much larger) PNG size.
    const remaining = SVG.length * 4;
    const assertQuota = vi.fn().mockImplementation(async (_a, _o, bytes: number) => {
      if (bytes > remaining) throw new HttpException('Storage quota exceeded', 413);
    });
    const { service, writeBuffer, saveGeneratedMedia } = makeService(assertQuota);

    const err = await service
      .importFromUrl('org-1', {
        url: 'https://cdn.example/licensed.svg',
        name: 'vecteezy-1.jpg',
        rasterizeSvg: true,
      })
      .catch((e) => e);

    expect((err as HttpException).getStatus()).toBe(413);
    expect(assertQuota).toHaveBeenCalledTimes(1);
    expect(assertQuota.mock.calls[0][2]).toBeGreaterThan(remaining);
    expect(writeBuffer).not.toHaveBeenCalled();
    expect(saveGeneratedMedia).not.toHaveBeenCalled();
  });

  it('renames the stored file to match the converted PNG', async () => {
    mockSafeFetch.mockResolvedValue(svgResponse('image/svg+xml'));
    const { service, saveGeneratedMedia, assertQuota } = makeService();

    await service.importFromUrl('org-1', {
      url: 'https://cdn.example/licensed.svg',
      name: 'vecteezy-1.jpg',
      rasterizeSvg: true,
    });

    expect(assertQuota).toHaveBeenCalledTimes(1);
    expect(saveGeneratedMedia.mock.calls[0][1].name).toBe('vecteezy-1.png');
  });

  it('nameMatchingMime swaps only a disagreeing known media extension', () => {
    expect(nameMatchingMime('a.jpg', 'image/png')).toBe('a.png');
    expect(nameMatchingMime('a.svg', 'image/png')).toBe('a.png');
    expect(nameMatchingMime('a.jpeg', 'image/jpeg')).toBe('a.jpeg');
    expect(nameMatchingMime('a.png', 'image/png')).toBe('a.png');
    expect(nameMatchingMime('Report v1.2', 'image/png')).toBe('Report v1.2');
    expect(nameMatchingMime('track', 'audio/mpeg')).toBe('track');
    expect(nameMatchingMime('clip.m4a', 'audio/mp4')).toBe('clip.m4a');
  });

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
