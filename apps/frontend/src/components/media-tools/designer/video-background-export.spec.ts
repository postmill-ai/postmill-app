import { describe, expect, it } from 'vitest';
import { FRAME_RENDERER_SCRIPT } from '@postmill-ai/nestjs-libraries/media/design-render/frame-renderer-script';
import { createDesignerStore } from './designer.store';

describe('video canvas background export', () => {
  it('paints the solid bg color saved by setOutputBackground', async () => {
    const store = createDesignerStore(400, 400);
    store.getState().setMode('video');
    store.getState().setOutputBackground({ type: 'color', color: '#B61A32' });
    const output = store.getState().doc.outputs[0];
    expect(output.bg).toEqual({ type: 'color', color: '#B61A32' });
    expect('background' in output).toBe(false);

    const fills: string[] = [];
    const context = new Proxy<Record<string, unknown>>({}, {
      get: (target, prop) => {
        if (prop === 'fillRect') {
          return () => fills.push(target.fillStyle as string);
        }
        if (prop === 'canvas') return { width: 400, height: 400 };
        if (prop in target) return target[prop as string];
        return () => undefined;
      },
      set: (target, prop, value) => {
        target[prop as string] = value;
        return true;
      },
    });
    const canvas = { width: 0, height: 0, getContext: () => context };
    const windowStub: Record<string, unknown> = {
      __DATA: { output, baseUrl: 'https://example.test' },
    };
    const documentStub = {
      getElementById: () => canvas,
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    };

    new Function('window', 'document', 'Image', FRAME_RENDERER_SCRIPT)(
      windowStub,
      documentStub,
      class {},
    );
    const api = windowStub.__FRAME_API as {
      renderFrame: (ms: number) => Promise<void>;
    };
    await api.renderFrame(0);

    expect(fills[0]).toBe('#B61A32');
  });
});
