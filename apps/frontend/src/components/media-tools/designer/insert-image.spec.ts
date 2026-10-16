import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./elements', () => ({
  probeImageNaturalSize: vi.fn(),
}));

import { createDesignerStore, type DesignerOutput } from './designer.store';
import { probeImageNaturalSize } from './elements';
import { addImageElementFromMedia } from './insert-image';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const imagesOf = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as DesignerOutput).children.filter(
    (c) => c.type === 'image'
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe('addImageElementFromMedia', () => {
  it('places aspect-correct immediately when the picker knows the dimensions', async () => {
    const store = createDesignerStore(1080, 1080);
    addImageElementFromMedia(store, {
      url: '/uploads/photo.png',
      fileId: 'f1',
      width: 3000,
      height: 2000,
    });

    const [el] = imagesOf(store);
    expect(el).toBeTruthy();
    expect(el.src).toBe('/uploads/photo.png');
    // fitWithin(3000, 2000, 864, 864) → 864×576, centred.
    expect(el.width).toBe(864);
    expect(el.height).toBe(576);
    expect(el.x).toBe((1080 - 864) / 2);
    expect(el.naturalWidth).toBe(3000);
    expect(el.naturalHeight).toBe(2000);
    // Known dims never trigger a probe.
    expect(probeImageNaturalSize).not.toHaveBeenCalled();
  });

  it('places immediately with unknown dims, then corrects the box when the probe resolves', async () => {
    vi.mocked(probeImageNaturalSize).mockResolvedValue({ width: 2000, height: 1000 });
    const store = createDesignerStore(1080, 1080);

    addImageElementFromMedia(store, { url: '/uploads/raw.jpg', fileId: 'f2' });

    // The element is on the canvas synchronously — no waiting on a download.
    const [placed] = imagesOf(store);
    expect(placed).toBeTruthy();
    expect(placed.width).toBe(864);
    expect(placed.height).toBe(864);
    expect(placed.naturalWidth).toBeUndefined();

    await flush();

    const [corrected] = imagesOf(store);
    // Re-fit to the real 2:1 aspect around the same center.
    expect(corrected.width).toBe(864);
    expect(corrected.height).toBe(432);
    expect(corrected.y).toBe(108 + (864 - 432) / 2);
    expect(corrected.naturalWidth).toBe(2000);
    expect(corrected.naturalHeight).toBe(1000);
  });

  it('keeps a user-resized box and only records the natural size', async () => {
    vi.mocked(probeImageNaturalSize).mockResolvedValue({ width: 2000, height: 1000 });
    const store = createDesignerStore(1080, 1080);

    addImageElementFromMedia(store, { url: '/uploads/raw.jpg' });
    const [placed] = imagesOf(store);
    // The user reshapes the element before the probe comes back.
    store.getState().updateElementsSilent([placed.id], { width: 400, height: 300 });

    await flush();

    const [el] = imagesOf(store);
    expect(el.width).toBe(400);
    expect(el.height).toBe(300);
    expect(el.naturalWidth).toBe(2000);
    expect(el.naturalHeight).toBe(1000);
  });

  it('keeps the provisional box when the probe fails', async () => {
    vi.mocked(probeImageNaturalSize).mockResolvedValue(null);
    const store = createDesignerStore(1080, 1080);

    addImageElementFromMedia(store, { url: '/uploads/broken.jpg' });
    await flush();

    const [el] = imagesOf(store);
    expect(el.width).toBe(864);
    expect(el.height).toBe(864);
    expect(el.naturalWidth).toBeUndefined();
  });

  it('does not resurrect an element that was removed before the probe resolved', async () => {
    vi.mocked(probeImageNaturalSize).mockResolvedValue({ width: 2000, height: 1000 });
    const store = createDesignerStore(1080, 1080);

    addImageElementFromMedia(store, { url: '/uploads/gone.jpg' });
    const [placed] = imagesOf(store);
    store.getState().removeElement(placed.id);

    await flush();

    expect(imagesOf(store)).toHaveLength(0);
  });
});
