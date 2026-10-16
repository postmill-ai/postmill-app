import { genId } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { fitWithin } from './panels/fit-within';
import { probeImageNaturalSize } from './elements';
import type { createDesignerStore, DesignerOutput } from './designer.store';

type Store = ReturnType<typeof createDesignerStore>;

export interface MediaImageItem {
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
}

/**
 * Insert ▸ image from the media picker.
 *
 * Placement never blocks on a download: when the picker already knows the
 * intrinsic size (stock metadata, or `File.metadata.dimensions` recorded at
 * upload) the element lands aspect-correct immediately. When it doesn't, the
 * element lands at the canvas fit right away and its box is corrected to the
 * real aspect once the probe resolves — the probe runs through the shared
 * image cache (`loadImage` in elements.tsx), so the Konva loader reuses that
 * same download rather than fetching again.
 */
export const addImageElementFromMedia = (store: Store, item: MediaImageItem): void => {
  const state = store.getState();
  const active = state.doc.outputs[state.currentOutput];
  const fitBox = { maxW: active.width * 0.8, maxH: active.height * 0.8 };

  const place = (id: string, natW?: number, natH?: number) => {
    const { width: w, height: h } = fitWithin(
      natW || active.width,
      natH || active.height,
      fitBox.maxW,
      fitBox.maxH
    );
    state.addElement({
      id,
      type: 'image',
      x: (active.width - w) / 2,
      y: (active.height - h) / 2,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: item.url,
      fileId: item.fileId,
      naturalWidth: natW,
      naturalHeight: natH,
    });
    return { w, h };
  };

  const id = genId();
  if (item.width && item.height) {
    place(id, item.width, item.height);
    return;
  }

  const { w, h } = place(id);
  void probeImageNaturalSize(item.url).then((dims) => {
    if (!dims) return;
    const cur = store.getState();
    const out = cur.doc.outputs[cur.currentOutput] as DesignerOutput | undefined;
    const el = out?.children.find((c) => c.id === id);
    // Deleted, replaced, or dragged into another output meanwhile — leave it.
    if (!el || el.src !== item.url) return;
    if (el.width === w && el.height === h) {
      // Untouched since placement: re-fit to the real aspect around the same
      // center. Silent — the correction is part of the placement, not a
      // separate history step.
      const fitted = fitWithin(dims.width, dims.height, fitBox.maxW, fitBox.maxH);
      cur.updateElementsSilent([id], {
        x: el.x + (el.width - fitted.width) / 2,
        y: el.y + (el.height - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height,
        naturalWidth: dims.width,
        naturalHeight: dims.height,
      });
    } else {
      // The user already resized the box — keep it, just record the real
      // natural size (crop math reads source-pixel dimensions).
      cur.updateElementsSilent([id], {
        naturalWidth: dims.width,
        naturalHeight: dims.height,
      });
    }
  });
};
