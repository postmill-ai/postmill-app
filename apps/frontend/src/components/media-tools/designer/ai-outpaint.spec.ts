import { describe, it, expect, vi, beforeEach } from 'vitest';

// probeImageNaturalSize loads a real <img> — stub it so the spec never touches
// the network and can pin the natural-size update explicitly.
vi.mock('./elements', () => ({
  probeImageNaturalSize: vi.fn().mockResolvedValue({ width: 1600, height: 900 }),
}));
vi.mock('./reflow', () => ({
  detectFocalPoint: vi.fn(),
}));
vi.mock('./image-edit-pixels', () => ({
  preserveOutpaintSource: vi.fn().mockResolvedValue({}),
}));
vi.mock('./raster-layers', () => ({
  commitCanvas: vi.fn().mockResolvedValue({ src: '/uploads/org/preserved.png', fileId: 'preserved-file' }),
}));

import { aiOutpaint } from './ai-image-actions';
import { probeImageNaturalSize } from './elements';
import { preserveOutpaintSource } from './image-edit-pixels';

interface FakeElement {
  id: string;
  type: 'image';
  src: string;
  fileId?: string;
  crop?: unknown;
  originalSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const makeStore = (element: FakeElement) => {
  const updates: Record<string, unknown>[] = [];
  const store = {
    updates,
    getState: () => ({
      doc: { outputs: { current: { children: [element] } } },
      currentOutput: 'current',
      updateElement: (id: string, u: Record<string, unknown>) => {
        expect(id).toBe(element.id);
        Object.assign(element, u);
        updates.push(u);
      },
      pushHistory: vi.fn(),
    }),
  };
  return store as never as ReturnType<typeof import('./designer.store').createDesignerStore> & {
    updates: Record<string, unknown>[];
  };
};

const okResponse = (url: string) =>
  ({ ok: true, json: () => Promise.resolve({ url }) }) as unknown as Response;

describe('aiOutpaint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts the image url, mode, and trimmed prompt to /media/outpaint', async () => {
    const store = makeStore({ id: 'el-1', type: 'image', src: 'https://x/chicken.png', x: 10, y: 20, width: 800, height: 450 });
    const fetchMock = vi.fn().mockResolvedValue(okResponse('https://cdn/expanded.png'));

    await aiOutpaint({ fetch: fetchMock, store, elementId: 'el-1' }, 'zoom-2x', '  more grass  ');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/media/outpaint');
    expect(JSON.parse(init.body as string)).toEqual({
      imageUrl: 'https://x/chicken.png',
      mode: 'zoom-2x',
      prompt: 'more grass',
    });
  });

  it('omits the prompt when it is empty', async () => {
    const store = makeStore({ id: 'el-1', type: 'image', src: 'https://x/chicken.png', x: 10, y: 20, width: 800, height: 450 });
    const fetchMock = vi.fn().mockResolvedValue(okResponse('https://cdn/expanded.png'));

    await aiOutpaint({ fetch: fetchMock, store, elementId: 'el-1' }, 'make-square');

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      imageUrl: 'https://x/chicken.png',
      mode: 'make-square',
    });
  });

  it('swaps src, refreshes the natural size, and clears stale fileId/crop/originalSrc', async () => {
    const element: FakeElement = {
      id: 'el-1',
      type: 'image',
      src: 'https://x/chicken.png',
      x: 10,
      y: 20,
      width: 800,
      height: 450,
      fileId: 'file-1',
      crop: { x: 10, y: 10, width: 100, height: 100 },
      originalSrc: 'https://x/original.png',
      naturalWidth: 800,
      naturalHeight: 450,
    };
    const store = makeStore(element);
    const fetchMock = vi.fn().mockResolvedValue(okResponse('https://cdn/expanded.png'));

    await aiOutpaint({ fetch: fetchMock, store, elementId: 'el-1' }, 'left');

    // A crop window or smart-filter source computed against the OLD pixels would
    // silently corrupt/revert the expansion — unlike bg-remove/upscale, outpaint
    // clears them.
    expect(store.updates).toEqual([
      {
        x: -790,
        y: 20,
        width: 1600,
        height: 900,
        src: '/uploads/org/preserved.png',
        fileId: 'preserved-file',
        crop: undefined,
        originalSrc: undefined,
        originalFileId: undefined,
        smartFilters: undefined,
        maskSrc: undefined,
        maskFileId: undefined,
        maskEnabled: undefined,
        naturalWidth: 1600,
        naturalHeight: 900,
      },
    ]);
    expect(probeImageNaturalSize).toHaveBeenCalledWith('https://cdn/expanded.png');
  });

  it('scales directional restore coordinates into output pixels', async () => {
    const store = makeStore({
      id: 'el-1', type: 'image', src: 'https://x/chicken.png', x: 100, y: 50,
      width: 400, height: 225, naturalWidth: 800, naturalHeight: 450,
    });
    const fetchMock = vi.fn().mockResolvedValue(okResponse('https://cdn/expanded.png'));

    await aiOutpaint({ fetch: fetchMock, store, elementId: 'el-1' }, 'right');

    expect(preserveOutpaintSource).toHaveBeenCalledWith(expect.objectContaining({
      resultNatural: { width: 1600, height: 900 },
      frame: expect.objectContaining({ x: 0, y: 0, width: 800, height: 450 }),
    }));
  });

  it('surfaces the server error message (502/409 envelope) instead of a bare failure', async () => {
    const store = makeStore({ id: 'el-1', type: 'image', src: 'https://x/chicken.png', x: 10, y: 20, width: 800, height: 450 });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Replicate is rate-limited' }),
    } as unknown as Response);

    await expect(
      aiOutpaint({ fetch: fetchMock, store, elementId: 'el-1' }, 'top'),
    ).rejects.toThrow('Replicate is rate-limited');
    expect(store.updates).toEqual([]);
  });
});
