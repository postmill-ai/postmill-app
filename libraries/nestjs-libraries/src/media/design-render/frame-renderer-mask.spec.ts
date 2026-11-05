import { describe, expect, it } from 'vitest';
import { FRAME_RENDERER_SCRIPT } from './frame-renderer-script';

class FakeImage {
  naturalWidth = 100;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() {
    queueMicrotask(() => this.onload?.());
  }
}

describe('FRAME_RENDERER_SCRIPT still-image masks', () => {
  it('composites original pixels through the mask in an isolated clip buffer', async () => {
    const operations: { scope: string; name: string; args: unknown[]; gco?: unknown }[] = [];
    const makeContext = (scope: string) => {
      const state: Record<string, unknown> = { canvas: { width: 100, height: 100 } };
      return new Proxy(state, {
        get: (target, prop) => {
          if (prop === 'drawImage') {
            return (...args: unknown[]) => operations.push({ scope, name: 'drawImage', args, gco: target.globalCompositeOperation });
          }
          if (prop in target) return target[prop as string];
          return () => undefined;
        },
        set: (target, prop, value) => {
          target[prop as string] = value;
          return true;
        },
      });
    };
    const mainCanvas = { width: 0, height: 0, getContext: () => makeContext('main') };
    const maskedCanvas = { width: 0, height: 0, getContext: () => makeContext('mask') };
    const documentStub = {
      getElementById: () => mainCanvas,
      createElement: () => maskedCanvas,
    };
    const windowStub: Record<string, unknown> = {
      __DATA: {
        output: {
          id: 'output', width: 100, height: 100, fps: 30, durationMs: 1000,
          background: '#ffffff',
          tracks: [{
            id: 'image-track', type: 'image',
            clips: [{
              id: 'image', startMs: 0, endMs: 1000,
              src: '/original.png', mediaType: 'image',
              maskSrc: '/mask.png', maskEnabled: true,
              x: 0, y: 0, width: 100, height: 100,
            }],
          }],
        },
        baseUrl: 'https://example.test',
      },
    };
    new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT)(windowStub, documentStub, FakeImage);
    const api = windowStub.__FRAME_API as { renderFrame: (ms: number) => Promise<void> };
    await api.renderFrame(0);

    const maskDraws = operations.filter((operation) => operation.scope === 'mask' && operation.name === 'drawImage');
    expect(maskDraws).toHaveLength(2);
    expect(maskDraws[0].args[0]).toBeInstanceOf(FakeImage);
    expect(maskDraws[0].gco).not.toBe('destination-in');
    expect(maskDraws[1].args[0]).toBeInstanceOf(FakeImage);
    expect(maskDraws[1].gco).toBe('destination-in');
    expect(maskDraws[1].args.slice(1)).toEqual([0, 0, 100, 100]);

    const mainDraws = operations.filter((operation) => operation.scope === 'main' && operation.name === 'drawImage');
    expect(mainDraws).toHaveLength(1);
    expect(mainDraws[0].args[0]).toBe(maskedCanvas);
    expect(mainDraws[0].args[0]).not.toBe(maskDraws[0].args[0]);
  });
});
