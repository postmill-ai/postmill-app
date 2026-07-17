import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collectCompositionMediaUrls,
  isRenderMediaUrlAllowed,
  assertCompositionMediaSafe,
} from './chromium-frame-capture.service';

// SSRF guard (2.1): private-IP / metadata clip media must fail host-side validation BEFORE
// the headless browser (which runs --no-sandbox) can fetch it.

describe('composition media SSRF guard', () => {
  const prev = process.env.NEXT_PUBLIC_BACKEND_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example.com';
    delete process.env.SSRF_ALLOWED_PRIVATE_CIDRS;
  });
  afterEach(() => {
    if (prev == null) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = prev;
  });

  const comp = (src: string): any => ({
    width: 1080,
    height: 1920,
    fps: 30,
    tracks: [{ type: 'image', clips: [{ src }] }],
  });

  it('collects visual media URLs (clip.src, sticker frames, bg image) and skips audio', () => {
    const urls = collectCompositionMediaUrls({
      width: 1,
      height: 1,
      fps: 30,
      durationMs: 1000,
      bg: { type: 'image', src: 'https://cdn/bg.png' },
      tracks: [
        { type: 'image', clips: [{ src: 'https://cdn/a.png' }] },
        { type: 'sticker', clips: [{ frames: [{ url: 'https://cdn/f.png' }] }] },
        { type: 'audio', clips: [{ src: 'https://cdn/should-be-skipped.mp3' }] },
      ],
    } as any);
    expect(urls).toEqual([
      'https://cdn/bg.png',
      'https://cdn/a.png',
      'https://cdn/f.png',
    ]);
  });

  it('rejects a private-IP / metadata clip.src host-side', async () => {
    await expect(
      assertCompositionMediaSafe(comp('http://169.254.169.254/latest/meta-data/')),
    ).rejects.toThrow(/Unsafe media URL/);
    await expect(
      assertCompositionMediaSafe(comp('http://127.0.0.1:3000/internal')),
    ).rejects.toThrow(/Unsafe media URL/);
  });

  it('allows inert, relative, same-origin, and public HTTPS media', async () => {
    expect(await isRenderMediaUrlAllowed('data:image/png;base64,AAAA')).toBe(true);
    expect(await isRenderMediaUrlAllowed('/uploads/x.png')).toBe(true);
    expect(await isRenderMediaUrlAllowed('https://app.example.com/uploads/y.png')).toBe(true);
    expect(await isRenderMediaUrlAllowed('https://images.unsplash.com/photo.jpg')).toBe(true);
    // A composition of only-safe URLs passes.
    await expect(
      assertCompositionMediaSafe(comp('https://images.unsplash.com/photo.jpg')),
    ).resolves.toBeUndefined();
  });

  it('rejects a private-IP host', async () => {
    expect(await isRenderMediaUrlAllowed('http://10.0.0.5/x')).toBe(false);
  });
});
