import { describe, it, expect, vi } from 'vitest';
import { runClipTransformRequest, VIDEO_BG_REMOVAL_MODELS } from './clip-transform';
import { MODEL_ALLOWLIST } from '@postmill-ai/nestjs-libraries/media/replicate-studio/replicate-catalog.allowlist';

const makeStore = (clip: { src?: string } | undefined) => {
  const updateClipSilent = vi.fn().mockReturnValue(true);
  const pushHistory = vi.fn();
  const store = {
    getState: () => ({
      doc: {
        outputs: [
          { tracks: [{ id: 'track-1', clips: clip ? [{ id: 'clip-1', ...clip }] : [] }] },
        ],
      },
      updateClipSilent,
      pushHistory,
    }),
  };
  // The runner only touches getState/updateClipSilent/pushHistory — a partial
  // store stands in for the zustand api.
  return { store: store as never, updateClipSilent, pushHistory };
};

const translate = (_key: string, fallback: string) => fallback;
const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const baseOptions = () => ({
  target: { outputIndex: 0, trackId: 'track-1', clipId: 'clip-1' },
  endpoint: '/media/remove-video-background',
  translate,
  toaster: { show: vi.fn() },
  isMounted: () => true,
});

describe('VIDEO_BG_REMOVAL_MODELS', () => {
  it('stays on the backend video-background allowlist (the API 400s anything else)', () => {
    const allowlist = MODEL_ALLOWLIST['video-background'] || [];
    expect(allowlist).toContain(VIDEO_BG_REMOVAL_MODELS.white);
    expect(allowlist).toContain(VIDEO_BG_REMOVAL_MODELS.green);
  });
});

describe('runClipTransformRequest', () => {
  it('POSTs the body (incl. the model choice) and swaps the clip src when the API returns an artifact path', async () => {
    const { store, updateClipSilent, pushHistory } = makeStore({ src: 'https://x/clip.mp4' });
    const fetch = vi.fn().mockResolvedValue(okJson({ id: '/uploads/nobg.mp4' }));
    const { toaster } = baseOptions();

    await runClipTransformRequest({
      ...baseOptions(),
      toaster,
      store,
      fetch,
      body: { videoUrl: 'https://x/clip.mp4', model: VIDEO_BG_REMOVAL_MODELS.white },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/media/remove-video-background',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ videoUrl: 'https://x/clip.mp4', model: 'lucataco/rembg-video' }),
      }),
    );
    expect(updateClipSilent).toHaveBeenCalledWith(0, 'track-1', 'clip-1', {
      src: '/uploads/nobg.mp4',
      fileId: undefined,
    });
    expect(pushHistory).toHaveBeenCalled();
    expect(toaster.show).not.toHaveBeenCalled();
  });

  it('polls /media/jobs/:id and swaps the clip src on completion', async () => {
    const { store, updateClipSilent, pushHistory } = makeStore({ src: 'https://x/clip.mp4' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(okJson({ id: 'job-1' }))
      .mockResolvedValueOnce(okJson({ status: 'completed', artifactUrl: '/uploads/done.mp4' }));

    await runClipTransformRequest({
      ...baseOptions(),
      store,
      fetch,
      body: { videoUrl: 'https://x/clip.mp4' },
    });

    expect(fetch).toHaveBeenNthCalledWith(2, '/media/jobs/job-1');
    expect(updateClipSilent).toHaveBeenCalledWith(0, 'track-1', 'clip-1', {
      src: '/uploads/done.mp4',
      fileId: undefined,
    });
    expect(pushHistory).toHaveBeenCalled();
  });

  it('toasts and leaves the clip alone when the POST fails', async () => {
    const { store, updateClipSilent } = makeStore({ src: 'https://x/clip.mp4' });
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    const toaster = { show: vi.fn() };

    await runClipTransformRequest({
      ...baseOptions(),
      store,
      fetch,
      toaster,
      body: { videoUrl: 'https://x/clip.mp4' },
    });

    expect(toaster.show).toHaveBeenCalledWith('Transform failed', 'warning');
    expect(updateClipSilent).not.toHaveBeenCalled();
  });

  it('refuses to run when the clip has no source', async () => {
    const { store } = makeStore({ src: undefined });
    const fetch = vi.fn();
    const toaster = { show: vi.fn() };

    await runClipTransformRequest({
      ...baseOptions(),
      store,
      fetch,
      toaster,
      body: { videoUrl: '' },
    });

    expect(toaster.show).toHaveBeenCalledWith('Selected clip has no source', 'warning');
    expect(fetch).not.toHaveBeenCalled();
  });
});
