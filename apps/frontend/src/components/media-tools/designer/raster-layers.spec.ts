import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitCanvas, disposeAllBuffers } from './raster-layers';

const canvasWithBlob = (blob: Blob | null) => ({
  toBlob: (callback: BlobCallback) => callback(blob),
}) as unknown as HTMLCanvasElement;

const uploadResponse = (ok = true, body: Record<string, unknown> = {
  id: 'working-file',
  path: '/uploads/working.png',
}) => new Response(JSON.stringify(body), {
  status: ok ? 201 : 400,
  headers: { 'Content-Type': 'application/json' },
});

describe('commitCanvas working assets', () => {
  afterEach(() => {
    disposeAllBuffers();
    vi.restoreAllMocks();
  });

  it.each([
    { size: 32, endpoint: '/files/upload-simple' },
    { size: 10 * 1024 * 1024 + 1, endpoint: '/files/upload-server' },
  ])('marks the $endpoint upload as an internal design asset', async ({ size, endpoint }) => {
    const fetch = vi.fn().mockResolvedValue(uploadResponse());
    const blob = new Blob([new Uint8Array(size)], { type: 'image/png' });

    await expect(commitCanvas(canvasWithBlob(blob), 'layer-1', fetch)).resolves.toEqual({
      src: '/uploads/working.png',
      fileId: 'working-file',
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('internal')).toBe('design-asset');
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('paint-layer-1.png');
  });

  it('does not upload when canvas encoding fails', async () => {
    const fetch = vi.fn();
    await expect(commitCanvas(canvasWithBlob(null), 'layer-1', fetch)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null without adopting a rejected upload', async () => {
    const fetch = vi.fn().mockResolvedValue(uploadResponse(false));
    const blob = new Blob(['paint'], { type: 'image/png' });
    await expect(commitCanvas(canvasWithBlob(blob), 'layer-1', fetch)).resolves.toBeNull();
  });

  it('returns null when the upload response has no usable source', async () => {
    const fetch = vi.fn().mockResolvedValue(uploadResponse(true, { id: 'working-file' }));
    const blob = new Blob(['paint'], { type: 'image/png' });
    await expect(commitCanvas(canvasWithBlob(blob), 'layer-1', fetch)).resolves.toBeNull();
  });
});
