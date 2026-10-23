import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compositeStageCanvas,
  captureStageThumbnail,
} from './stage-thumbnail';

/**
 * jsdom has no canvas implementation, so the 2d context and toDataURL are
 * stubbed on the prototype — the specs pin the COMPOSITE BEHAVIOR (which
 * canvases are drawn, in which order, with what geometry), not pixels.
 */

let drawImage: ReturnType<typeof vi.fn>;
let fillRect: ReturnType<typeof vi.fn>;
let toDataURL: ReturnType<typeof vi.fn>;
let getContextSpy: ReturnType<typeof vi.spyOn>;
let toDataURLSpy: ReturnType<typeof vi.spyOn>;

const makeStage = (...canvasSizes: Array<[number, number]>) => {
  const stage = document.createElement('div');
  stage.className = 'konva-stage';
  for (const [w, h] of canvasSizes) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    stage.appendChild(canvas);
  }
  document.body.appendChild(stage);
  return stage;
};

beforeEach(() => {
  drawImage = vi.fn();
  fillRect = vi.fn();
  toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,thumb');
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage, fillRect } as any);
  toDataURLSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockImplementation((...args: any[]) => toDataURL(...args));
});

afterEach(() => {
  getContextSpy.mockRestore();
  toDataURLSpy.mockRestore();
  document.body.innerHTML = '';
});

describe('compositeStageCanvas', () => {
  it('returns null when there is no stage', () => {
    expect(compositeStageCanvas()).toBeNull();
  });

  it('composites EVERY layer canvas in stacking (DOM) order', () => {
    const stage = makeStage([800, 600], [800, 600], [400, 300]);
    const [base, overlay, small] = Array.from(stage.querySelectorAll('canvas'));

    const composite = compositeStageCanvas();

    expect(composite).not.toBeNull();
    // The composite takes the largest backing-store size.
    expect([composite!.width, composite!.height]).toEqual([800, 600]);
    // All three canvases painted, base first — the old code read only `base`.
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(drawImage.mock.calls[0][0]).toBe(base);
    expect(drawImage.mock.calls[1][0]).toBe(overlay);
    expect(drawImage.mock.calls[2][0]).toBe(small);
  });

  it('skips zero-sized canvases and nulls out when none are measurable', () => {
    makeStage([0, 0]);
    expect(compositeStageCanvas()).toBeNull();
  });
});

describe('captureStageThumbnail', () => {
  it('returns a downscaled JPEG data URL for the composite', () => {
    makeStage([800, 600], [800, 600]);

    const url = captureStageThumbnail();

    expect(url).toBe('data:image/jpeg;base64,thumb');
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  it('returns undefined when there is no stage', () => {
    expect(captureStageThumbnail()).toBeUndefined();
  });

  it('degrades to undefined (never throws) when the canvas is tainted', () => {
    makeStage([800, 600]);
    toDataURL.mockImplementation(() => {
      throw new DOMException('Tainted canvases may not be exported.', 'SecurityError');
    });

    expect(captureStageThumbnail()).toBeUndefined();
  });
});
