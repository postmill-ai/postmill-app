import { describe, expect, it } from 'vitest';
import { createDesignerStore, type DesignerOutput } from './designer.store';
import { replaceStaticImage, staticImageReplacementPatch } from './image-replacement';

const setup = () => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: 'image',
    type: 'image',
    x: 11,
    y: 12,
    width: 200,
    height: 100,
    rotation: 5,
    opacity: 0.8,
    locked: false,
    hidden: false,
    src: '/old.png',
    fileId: 'old-file',
    originalSrc: '/original.png',
    originalFileId: 'original-file',
    smartFilters: [{ id: 'blur', params: { radius: 4 }, enabled: true }],
    filters: ['sepia:0.2'],
    naturalWidth: 800,
    naturalHeight: 450,
    crop: { x: 40, y: 45, width: 400, height: 225 },
    fitMode: 'cover',
    focalPoint: { x: 0.25, y: 0.75 },
    mask: { type: 'shape', shape: 'ellipse' },
    maskSrc: '/mask.png',
    maskFileId: 'mask-file',
    maskEnabled: true,
  });
  return store;
};

const image = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as DesignerOutput).children[0];

describe('replaceStaticImage', () => {
  it('preserves the frame and media-fit intent while remapping source-pixel crop', async () => {
    const store = setup();
    const before = image(store);
    const history = store.getState().history.length;

    await expect(replaceStaticImage({
      store,
      elementId: 'image',
      item: { url: '/new.png', fileId: 'new-file', width: 1600, height: 900 },
    })).resolves.toBe(true);

    expect(image(store)).toMatchObject({
      id: before.id,
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      rotation: before.rotation,
      opacity: before.opacity,
      filters: before.filters,
      src: '/new.png',
      fileId: 'new-file',
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: { x: 80, y: 90, width: 800, height: 450 },
      fitMode: 'cover',
      focalPoint: { x: 0.25, y: 0.75 },
    });
    expect(image(store).originalSrc).toBeUndefined();
    expect(image(store).originalFileId).toBeUndefined();
    expect(image(store).smartFilters).toBeUndefined();
    expect(image(store).mask).toBeUndefined();
    expect(image(store).maskSrc).toBeUndefined();
    expect(image(store).maskFileId).toBeUndefined();
    expect(store.getState().history).toHaveLength(history + 1);

    store.getState().undo();
    expect(image(store)).toMatchObject({
      src: '/old.png',
      fileId: 'old-file',
      crop: before.crop,
      naturalWidth: 800,
      naturalHeight: 450,
    });
  });

  it('clears an incompatible crop when replacement dimensions are not measurable', () => {
    const store = setup();
    const patch = staticImageReplacementPatch(image(store), {
      url: '/new.png',
      fileId: 'new-file',
    });
    expect(patch.crop).toBeUndefined();
    expect(patch.naturalWidth).toBeUndefined();
    expect(patch.naturalHeight).toBeUndefined();
  });

  it('derives a bounded frame-aspect cover crop around the old relative center', () => {
    const store = setup();
    store.getState().updateElement('image', {
      width: 400,
      height: 200,
      naturalWidth: 1000,
      naturalHeight: 1000,
      crop: { x: 0, y: 0, width: 1000, height: 500 },
    });

    const patch = staticImageReplacementPatch(image(store), {
      url: '/new.png',
      fileId: 'new-file',
      width: 2000,
      height: 1000,
    });

    expect(patch.crop).toEqual({ x: 0, y: 0, width: 2000, height: 1000 });
    expect(patch.crop!.width / patch.crop!.height).toBe(2);
  });

  it('clamps a cover crop at the source edge without distorting it', () => {
    const store = setup();
    store.getState().updateElement('image', {
      width: 200,
      height: 100,
      naturalWidth: 1000,
      naturalHeight: 1000,
      crop: { x: 0, y: 0, width: 500, height: 500 },
    });

    const patch = staticImageReplacementPatch(image(store), {
      url: '/new.png', fileId: 'new-file', width: 1000, height: 2000,
    });
    expect(patch.crop).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });
});
