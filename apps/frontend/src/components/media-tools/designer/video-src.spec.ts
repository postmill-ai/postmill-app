import { describe, it, expect, afterEach } from 'vitest';
import {
  isVideoSrc,
  markVideoSrcErrored,
  videoSrcErrored,
  clearVideoSrcErrors,
  resetVideoSrcErrors,
} from './video-src';

describe('isVideoSrc', () => {
  it('matches the video extensions, case-insensitively', () => {
    expect(isVideoSrc('https://cdn.example.com/a.mp4')).toBe(true);
    expect(isVideoSrc('/uploads/b.WEBM')).toBe(true);
    expect(isVideoSrc('c.mov')).toBe(true);
    expect(isVideoSrc('d.mkv')).toBe(true);
    expect(isVideoSrc('e.avi')).toBe(true);
    expect(isVideoSrc('f.m4v')).toBe(true);
  });

  it('tolerates a query string — a signed URL is still a video', () => {
    // Regression: `/uploads/clip.mp4?x=1` mis-sniffed as an image and the clip
    // never played.
    expect(isVideoSrc('/uploads/clip.mp4?x=1')).toBe(true);
    expect(isVideoSrc('https://cdn.example.com/a.webm?sig=abc&exp=123')).toBe(true);
  });

  it('rejects images, extension-less and empty sources', () => {
    expect(isVideoSrc('https://cdn.example.com/a.png')).toBe(false);
    expect(isVideoSrc('https://cdn.example.com/a.mp4.jpg')).toBe(false);
    expect(isVideoSrc('https://cdn.example.com/video')).toBe(false);
    expect(isVideoSrc('')).toBe(false);
    expect(isVideoSrc(undefined)).toBe(false);
  });
});

describe('errored video clips', () => {
  afterEach(() => resetVideoSrcErrors());

  it('reports a clip only after its element errored', () => {
    const clip = { id: 'c1', src: 'https://example.com/a.mp4' };
    expect(videoSrcErrored(clip)).toBe(false);
    markVideoSrcErrored(clip.id, clip.src);
    expect(videoSrcErrored(clip)).toBe(true);
  });

  it('a src swap (regenerate) clears the error automatically', () => {
    markVideoSrcErrored('c1', 'https://example.com/old.mp4');
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/new.mp4' })).toBe(false);
  });

  it('clearVideoSrcErrors drops every src recorded for the clip', () => {
    markVideoSrcErrored('c1', 'https://example.com/a.mp4');
    markVideoSrcErrored('c1', 'https://example.com/b.mp4');
    markVideoSrcErrored('c2', 'https://example.com/c.mp4');
    clearVideoSrcErrors('c1');
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/a.mp4' })).toBe(false);
    expect(videoSrcErrored({ id: 'c1', src: 'https://example.com/b.mp4' })).toBe(false);
    expect(videoSrcErrored({ id: 'c2', src: 'https://example.com/c.mp4' })).toBe(true);
  });

  it('a clip id that prefixes another cannot clear it', () => {
    markVideoSrcErrored('c1-x', 'https://example.com/a.mp4');
    clearVideoSrcErrors('c1');
    expect(videoSrcErrored({ id: 'c1-x', src: 'https://example.com/a.mp4' })).toBe(true);
  });
});
