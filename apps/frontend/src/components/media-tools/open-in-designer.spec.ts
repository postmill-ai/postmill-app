import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openInDesigner } from './open-in-designer';

const TIMELINE_KEY = 'designer:timeline-handoff';

describe('openInDesigner', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('routes a HeyGen avatar render onto the video timeline (avatar → video)', () => {
    const navigate = vi.fn();
    openInDesigner(
      { operation: 'avatar', artifactUrl: 'https://cdn.example/v.mp4', fileId: 'f1' },
      navigate
    );
    expect(navigate).toHaveBeenCalledWith('/media/designer?timeline=1');
    const handoff = JSON.parse(window.sessionStorage.getItem(TIMELINE_KEY)!);
    expect(handoff).toMatchObject({ type: 'video', url: 'https://cdn.example/v.mp4', fileId: 'f1' });
  });

  it('uses a short-lived local handoff for a new tab without putting the artifact URL in the query', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInDesigner({
      operation: 'video',
      artifactUrl: 'https://cdn.example/v.mp4?signature=secret',
      fileId: 'f1',
      fileType: 'video',
    });

    const url = new URL(open.mock.calls[0][0] as string, 'https://app.example');
    const handoffId = url.searchParams.get('handoff');
    expect(handoffId).toMatch(/^[0-9a-f-]{36}$/);
    expect(url.searchParams.has('mediaUrl')).toBe(false);
    expect(url.toString()).not.toContain('signature');
    const handoff = JSON.parse(window.localStorage.getItem(`${TIMELINE_KEY}:${handoffId}`)!);
    expect(handoff).toMatchObject({
      type: 'video',
      url: 'https://cdn.example/v.mp4?signature=secret',
      fileId: 'f1',
    });
    expect(handoff.expiresAt).toBeGreaterThan(Date.now());
    expect(window.sessionStorage.getItem(TIMELINE_KEY)).toBeNull();
  });

  it('sends audio to the timeline as audio', () => {
    const navigate = vi.fn();
    openInDesigner({ operation: 'audio', artifactUrl: 'https://cdn.example/a.mp3' }, navigate);
    const handoff = JSON.parse(window.sessionStorage.getItem(TIMELINE_KEY)!);
    expect(handoff.type).toBe('audio');
  });

  it('routes an image and its dimensions to the static canvas (no timeline handoff)', () => {
    const navigate = vi.fn();
    openInDesigner(
      {
        operation: 'image',
        artifactUrl: 'https://cdn.example/i.png',
        metadata: { dimensions: { width: 1024, height: 768 } },
      },
      navigate
    );
    const url = new URL(navigate.mock.calls[0][0], 'https://app.example');
    expect(url.pathname).toBe('/media/designer');
    expect(url.searchParams.get('w')).toBe('1024');
    expect(url.searchParams.get('h')).toBe('768');
    expect(window.sessionStorage.getItem(TIMELINE_KEY)).toBeNull();
  });

  it('ignores non-media operations and missing artifacts', () => {
    const navigate = vi.fn();
    openInDesigner({ operation: 'stt', artifactUrl: 'https://cdn.example/t.txt' }, navigate);
    openInDesigner({ operation: 'video', artifactUrl: null }, navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes an image artifact from a video-operation job to the static canvas', () => {
    // Reel.Farm slideshows complete a 'video' job with a slide JPG; the stored
    // File is classified 'image'. Sending it to the video timeline would create
    // a clip that can't decode.
    const navigate = vi.fn();
    openInDesigner(
      { operation: 'video', artifactUrl: 'https://cdn.example/slide.jpg', fileType: 'image' },
      navigate
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining('/media/designer?url=')
    );
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('type=photo'));
    expect(window.sessionStorage.getItem(TIMELINE_KEY)).toBeNull();
  });

  it('persists safe duration and dimensions for the timeline handoff', () => {
    const navigate = vi.fn();
    openInDesigner(
      {
        operation: 'video',
        artifactUrl: 'https://cdn.example/v.mp4',
        fileId: 'f1',
        fileType: 'video',
        metadata: { dimensions: { width: 720, height: 1280 }, durationMs: 7320 },
      },
      navigate
    );

    expect(JSON.parse(window.sessionStorage.getItem(TIMELINE_KEY)!)).toEqual({
      type: 'video',
      url: 'https://cdn.example/v.mp4',
      fileId: 'f1',
      width: 720,
      height: 1280,
      durationMs: 7320,
    });
  });

  it('keeps duration and dimensions in the query fallback without unsafe values', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const navigate = vi.fn();
    openInDesigner(
      {
        operation: 'video',
        artifactUrl: 'https://cdn.example/v.mp4',
        metadata: { dimensions: { width: 720, height: -10 }, durationMs: 7320 },
      },
      navigate
    );

    const url = new URL(navigate.mock.calls[0][0], 'https://app.example');
    expect(url.searchParams.get('mediaWidth')).toBe('720');
    expect(url.searchParams.has('mediaHeight')).toBe(false);
    expect(url.searchParams.get('mediaDurationMs')).toBe('7320');
  });
});
