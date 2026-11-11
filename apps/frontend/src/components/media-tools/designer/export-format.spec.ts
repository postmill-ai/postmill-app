import { describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  renderOutputWithFallback,
  renderWithFormatFallback,
} from './export-format';

const blob = (size: number): Blob => ({ size }) as Blob;

describe('renderWithFormatFallback', () => {
  it('keeps PNG selected while reducing scale', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('png', 0.92, 3, render);

    expect(result.usedFormat).toBe('png');
    expect(result.usedScale).toBe(2);
    expect(result.usedQuality).toBe(0.92);
    expect(render.mock.calls.map(([format]) => format)).toEqual(['png', 'png']);
    expect(render).toHaveBeenNthCalledWith(2, 'png', 0.92, 2);
  });

  it('reduces JPEG quality before reducing scale', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('jpeg', 0.92, 3, render);

    expect(result.usedFormat).toBe('jpeg');
    expect(result.usedQuality).toBe(0.7);
    expect(result.usedScale).toBe(3);
    expect(render).toHaveBeenNthCalledWith(2, 'jpeg', 0.7, 3);
  });

  it('keeps transparent PNG selected down to 1x', async () => {
    const render = vi.fn()
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(blob(100));

    const result = await renderWithFormatFallback('transparent', 0.92, 3, render);

    expect(result.usedFormat).toBe('transparent');
    expect(result.usedScale).toBe(1);
    expect(render.mock.calls.map(([format]) => format)).toEqual([
      'transparent',
      'transparent',
      'transparent',
    ]);
  });

  it('fails with an actionable message instead of substituting JPEG', async () => {
    const render = vi.fn().mockResolvedValue(blob(MAX_UPLOAD_BYTES + 1));

    await expect(renderWithFormatFallback('png', 0.92, 3, render)).rejects.toThrow(
      'Could not reduce PNG under 10 MB. Choose a smaller scale or JPEG.'
    );
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls.every(([format]) => format === 'png')).toBe(true);
  });
});

describe('renderOutputWithFallback', () => {
  const doc = { mode: 'image', outputs: [] } as any;
  const output = { id: 'out-1', width: 1080, height: 1350, children: [] } as any;

  it('renders transparent PNG through the server with only the selected output', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(blob(100)));
    await renderOutputWithFallback(doc, output, 'transparent', 0.92, 0.25, fetchFn);

    const [path, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(path).toBe('/media/designs/render');
    expect(init.method).toBe('POST');
    expect(body).toMatchObject({
      outputIndex: 0,
      pageNumber: 0,
      format: 'png',
      quality: 0.92,
      pixelRatio: 0.25,
      transparent: true,
    });
    expect(body.doc.outputs).toEqual([output]);
  });

  it('preserves JPEG while reducing quality before scale', async () => {
    const responseBlob = (size: number) => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array(size)]),
    });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(responseBlob(MAX_UPLOAD_BYTES + 1))
      .mockResolvedValueOnce(responseBlob(100));
    const result = await renderOutputWithFallback(doc, output, 'jpeg', 0.92, 3, fetchFn);
    const qualities = fetchFn.mock.calls.map(([, init]) => JSON.parse(init.body).quality);
    const scales = fetchFn.mock.calls.map(([, init]) => JSON.parse(init.body).pixelRatio);

    expect(result.usedFormat).toBe('jpeg');
    expect(qualities).toEqual([0.92, 0.7]);
    expect(scales).toEqual([3, 3]);
  });

  it('propagates the server error instead of returning an empty blob', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'render unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(renderOutputWithFallback(doc, output, 'png', 0.92, 1, fetchFn)).rejects.toThrow(
      'render unavailable'
    );
  });
});
