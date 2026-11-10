import { describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
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
