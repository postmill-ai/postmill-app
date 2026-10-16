import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { textureCacheKey, textureFillProps, textureTile } from './textures';
import type { DesignerTexture } from './designer.store';

/**
 * Client side of background textures. jsdom has no 2D canvas, so getContext is
 * stubbed with a recording context — the tile PIXELS are pinned by the shared
 * generator's own spec in nestjs-libraries; here the caching and Konva fill
 * props are under test.
 */

const fillRect = vi.fn();
const stubCtx = {
  fillStyle: '',
  fillRect,
};

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    stubCtx as unknown as CanvasRenderingContext2D
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('textureCacheKey', () => {
  it('is stable for the same parameters and differs per parameter', () => {
    const a: DesignerTexture = { type: 'grain', intensity: 0.5, scale: 2, seed: 7 };
    expect(textureCacheKey(a)).toBe(textureCacheKey({ ...a }));
    expect(textureCacheKey(a)).not.toBe(textureCacheKey({ ...a, seed: 8 }));
    expect(textureCacheKey(a)).not.toBe(textureCacheKey({ ...a, type: 'paper' }));
    expect(textureCacheKey(a)).not.toBe(textureCacheKey({ ...a, intensity: 0.6 }));
    expect(textureCacheKey(a)).not.toBe(textureCacheKey({ ...a, scale: 1 }));
  });
});

describe('textureTile', () => {
  it('draws through the shared generator and caches per parameter set', () => {
    const texture: DesignerTexture = { type: 'grain', intensity: 0.5, seed: 1 };
    const first = textureTile(texture);
    expect(first).not.toBeNull();
    // The generator painted speckles into the stub.
    expect(fillRect).toHaveBeenCalled();

    // Same parameters → the cached canvas, not a redraw.
    const calls = fillRect.mock.calls.length;
    expect(textureTile({ ...texture })).toBe(first);
    expect(fillRect.mock.calls.length).toBe(calls);

    // A different seed → a new tile.
    expect(textureTile({ ...texture, seed: 2 })).not.toBe(first);
  });
});

describe('textureFillProps', () => {
  it('hands Konva the tile as a repeating pattern', () => {
    const props = textureFillProps({ type: 'paper', intensity: 0.4, seed: 3 });
    expect(props.fillPatternRepeat).toBe('repeat');
    expect(props.fillPatternImage).toBeInstanceOf(HTMLCanvasElement);
  });
});
