import type { DesignerCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { probeImageNaturalSize } from './elements';
import { staticMediaMatches } from './ai-image-actions';
import type { DesignerElement, DesignerOutput } from './designer.store';
import type { MediaImageItem } from './insert-image';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

type MediaFrame = Pick<
  DesignerElement,
  'src' | 'naturalWidth' | 'naturalHeight' | 'crop' | 'fitMode' | 'focalPoint' | 'width' | 'height'
>;

const elementAt = (store: Store, elementId: string): DesignerElement | undefined => {
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
  return output
    ? pageChildren(output, state.currentPage).find((element) => element.id === elementId)
    : undefined;
};

export const replacementCrop = (
  before: (
    Pick<MediaFrame, 'naturalWidth' | 'naturalHeight' | 'crop'> &
    Partial<Pick<MediaFrame, 'width' | 'height'>>
  ) | undefined,
  item: { width?: number | null; height?: number | null }
): DesignerCrop | undefined => {
  if (!before?.crop) return undefined;
  if (
    !before.naturalWidth || !before.naturalHeight ||
    !item.width || !item.height
  ) return undefined;

  const oldAspect = before.naturalWidth / before.naturalHeight;
  const newAspect = item.width / item.height;
  if (Math.abs(oldAspect - newAspect) < 0.0001) {
    return {
      x: before.crop.x * item.width / before.naturalWidth,
      y: before.crop.y * item.height / before.naturalHeight,
      width: before.crop.width * item.width / before.naturalWidth,
      height: before.crop.height * item.height / before.naturalHeight,
    };
  }

  if (!(before.width > 0) || !(before.height > 0)) return undefined;
  const frameAspect = before.width / before.height;
  const width = newAspect > frameAspect ? item.height * frameAspect : item.width;
  const height = newAspect > frameAspect ? item.height : item.width / frameAspect;
  const centerX = (before.crop.x + before.crop.width / 2) / before.naturalWidth;
  const centerY = (before.crop.y + before.crop.height / 2) / before.naturalHeight;
  return {
    x: Math.max(0, Math.min(item.width - width, centerX * item.width - width / 2)),
    y: Math.max(0, Math.min(item.height - height, centerY * item.height - height / 2)),
    width,
    height,
  };
};

export const staticImageReplacementPatch = (
  before: MediaFrame,
  item: MediaImageItem
): Partial<DesignerElement> => ({
  src: item.url,
  fileId: item.fileId,
  qr: undefined,
  naturalWidth: item.width || undefined,
  naturalHeight: item.height || undefined,
  crop: replacementCrop(before, item),
  fitMode: before.fitMode,
  focalPoint: before.focalPoint,
  subjectPoint: undefined,
  originalSrc: undefined,
  originalFileId: undefined,
  smartFilters: undefined,
  mask: undefined,
  maskSrc: undefined,
  maskFileId: undefined,
  maskEnabled: undefined,
});

const operations = new WeakMap<Store, Map<string, number>>();

export const replaceStaticImage = async ({
  store,
  elementId,
  item,
  probe = probeImageNaturalSize,
}: {
  store: Store;
  elementId: string;
  item: MediaImageItem;
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}): Promise<boolean> => {
  const before = elementAt(store, elementId);
  if (before?.type !== 'image' || !before.src) return false;
  let storeOperations = operations.get(store);
  if (!storeOperations) {
    storeOperations = new Map<string, number>();
    operations.set(store, storeOperations);
  }
  const operation = (storeOperations.get(elementId) || 0) + 1;
  storeOperations.set(elementId, operation);
  const history = store.getState().history;
  const natural = item.width && item.height
    ? { width: item.width, height: item.height }
    : await probe(item.url);
  const current = elementAt(store, elementId);
  if (
    storeOperations.get(elementId) !== operation ||
    store.getState().history !== history ||
    !staticMediaMatches(before, current)
  ) return false;

  store.getState().updateElementsSilent([elementId], staticImageReplacementPatch(before, {
    ...item,
    width: natural?.width,
    height: natural?.height,
  }));
  store.getState().pushHistory('Replace image');
  return true;
};
