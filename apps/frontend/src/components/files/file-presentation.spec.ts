import { describe, expect, it } from 'vitest';
import type { FileItem } from './file-manager';
import {
  formatVideoDuration,
  getDesignLabel,
  getFileMediaKind,
  getFilePresentation,
  isDesignFile,
} from './file-presentation';

const file = (overrides: Partial<FileItem> = {}): FileItem => ({
  id: 'f1',
  name: 'asset.bin',
  originalName: null,
  path: '/uploads/asset.bin',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 100,
  type: 'document',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('file presentation', () => {
  it.each([
    [{ type: 'video', path: '/clip.bin', name: 'clip.bin' }, 'video'],
    [{ type: 'video/quicktime', path: '/clip.bin', name: 'clip.bin' }, 'video'],
    [{ type: 'document', path: '/clip.mov?download=1', name: 'clip.mov' }, 'video'],
    [{ type: 'document', path: '/storage/clip.bin', name: 'clip.bin', originalName: 'clip.webm' }, 'video'],
    [{ type: 'document', path: '/image.webp', name: 'image.webp' }, 'image'],
    [{ type: 'document', path: '/sound.bin', name: 'sound.bin', metadata: { mimeType: 'audio/mpeg' } }, 'audio'],
    [{ type: 'document', path: '/file.pdf', name: 'file.pdf' }, null],
  ] as const)('detects real media from categories, MIME types, and extensions', (input, expected) => {
    expect(getFileMediaKind(file(input))).toBe(expected);
  });

  it('treats corrected bare categories as authoritative over MIME types and extensions', () => {
    const audio = file({
      type: 'audio',
      path: '/voiceover.webm',
      name: 'voiceover.webm',
      metadata: { mimeType: 'video/webm' },
    });
    expect(getFilePresentation(audio)).toMatchObject({
      mediaKind: 'audio',
      hasVideoDuration: false,
      preview: { kind: 'audio', src: '/voiceover.webm' },
    });

    const image = file({
      type: 'image',
      path: '/slide.jpg',
      name: 'slide.jpg',
      originalName: 'slide.webm',
      metadata: { mimeType: 'video/mp4' },
    });
    expect(getFilePresentation(image)).toMatchObject({
      mediaKind: 'image',
      hasVideoDuration: false,
      preview: { kind: 'image', src: '/slide.jpg' },
    });
  });

  it('uses metadata.mime before conflicting legacy extensions', () => {
    const audio = file({
      path: '/voiceover.webm',
      name: 'voiceover.webm',
      metadata: { mime: 'audio/webm' },
    });
    expect(getFileMediaKind(audio)).toBe('audio');
    expect(getFilePresentation(audio).hasVideoDuration).toBe(false);
  });

  it.each([
    [{ path: '/legacy.webm', name: 'legacy.webm' }, 'video'],
    [{ type: 'unknown', path: '/legacy.jpg', name: 'legacy.jpg' }, 'image'],
    [{ path: '/legacy.mp3', name: 'legacy.mp3' }, 'audio'],
  ] as const)('keeps extension fallback for document and unknown rows', (input, expected) => {
    expect(getFileMediaKind(file(input))).toBe(expected);
  });

  it('recognizes pdesign before its generic document category', () => {
    const design = file({ name: 'snapshot.pdesign', path: '/uploads/snapshot.pdesign' });
    expect(isDesignFile(design)).toBe(true);
    expect(getFileMediaKind(design)).toBeNull();
    expect(getFilePresentation(design).canOpenInDesigner).toBe(true);
  });

  it.each([
    [{ kind: 'design' as const, mode: 'image' as const }, 'Image design'],
    [{ kind: 'design' as const, mode: 'video' as const }, 'Video design'],
    [{ kind: 'template' as const, mode: 'image' as const }, 'Image template'],
    [{ kind: 'template' as const, mode: 'video' as const }, 'Video template'],
    [{ mode: 'image' as const }, 'Image design file'],
    [{ mode: 'video' as const }, 'Video design file'],
    [{}, 'Design file'],
  ])('derives design identity and mode labels', (metadata, expected) => {
    const design = file({ name: 'snapshot.pdesign', path: '/snapshot.pdesign', metadata });
    expect(getDesignLabel(design).fallback).toBe(expected);
  });

  it('uses thumbnails for designs and never exposes the ZIP as a preview URL', () => {
    const withThumbnail = file({
      path: '/snapshot.pdesign',
      name: 'snapshot.pdesign',
      thumbnail: '/thumbnails/snapshot.png',
    });
    const withoutThumbnail = file({ path: '/snapshot.pdesign', name: 'snapshot.pdesign' });
    expect(getFilePresentation(withThumbnail).preview).toMatchObject({
      kind: 'image',
      src: '/thumbnails/snapshot.png',
    });
    expect(getFilePresentation(withoutThumbnail).preview).toMatchObject({ kind: 'fallback', src: null });
  });

  it('only uses raw paths for renderable media', () => {
    expect(getFilePresentation(file({ path: '/doc.pdf', name: 'doc.pdf' })).preview.src).toBeNull();
    expect(getFilePresentation(file({ path: '/image.png', name: 'image.png' })).preview.src).toBe('/image.png');
    expect(getFilePresentation(file({ path: '/video.webm', name: 'video.webm' })).preview.src).toBe('/video.webm');
  });

  it('enables duration UI for real videos and video designs only', () => {
    expect(getFilePresentation(file({ type: 'video' })).hasVideoDuration).toBe(true);
    expect(getFilePresentation(file({
      path: '/snapshot.pdesign',
      name: 'snapshot.pdesign',
      metadata: { kind: 'template', mode: 'video' },
    })).hasVideoDuration).toBe(true);
    expect(getFilePresentation(file({
      path: '/snapshot.pdesign',
      name: 'snapshot.pdesign',
      metadata: { kind: 'design', mode: 'image' },
    })).hasVideoDuration).toBe(false);
  });
});

describe('formatVideoDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatVideoDuration(65_900)).toBe('1:05');
    expect(formatVideoDuration(3_661_000)).toBe('1:01:01');
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '1000'])(
    'rejects invalid duration %s',
    (value) => expect(formatVideoDuration(value)).toBeNull()
  );
});
