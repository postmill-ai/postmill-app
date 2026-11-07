'use client';

import { computeMediaDraw } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';
import { MAX_DIMENSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { DesignerElement, DesignerOutput } from './designer.store';
import { probeImageNaturalSize } from './elements';
import { loadMaskImage } from './background-removal-mask';
import { readErrorMessage } from './read-error-message';

export type OutpaintMode =
  | 'zoom-1.5x'
  | 'zoom-2x'
  | 'make-square'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

export const OUTPAINT_MODES: OutpaintMode[] = [
  'zoom-1.5x',
  'zoom-2x',
  'make-square',
  'left',
  'right',
  'top',
  'bottom',
];

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export interface OutpaintCandidate {
  kind: 'image' | 'page';
  before: DesignerElement;
  outputIndex: number;
  history: unknown;
  sourceUrl: string;
  assetUrl: string;
  fileId?: string;
  sourceNatural: { width: number; height: number };
  resultNatural: { width: number; height: number };
  mode?: OutpaintMode;
  targetWidth?: number;
  targetHeight?: number;
}

const getElement = (store: Store, elementId: string): DesignerElement | undefined => {
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput] as any;
  return output?.children?.find((child: any) => child.id === elementId);
};

const mediaMatches = (before: DesignerElement, current?: DesignerElement): boolean => !!current &&
  current.src === before.src &&
  current.originalSrc === before.originalSrc &&
  current.originalFileId === before.originalFileId &&
  JSON.stringify(current.smartFilters || []) === JSON.stringify(before.smartFilters || []);

const candidateIsCurrent = (store: Store, candidate: OutpaintCandidate): boolean => {
  const state = store.getState();
  return state.currentOutput === candidate.outputIndex &&
    state.history === candidate.history &&
    mediaMatches(candidate.before, getElement(store, candidate.before.id));
};

const probe = async (
  element: DesignerElement,
  src: string
): Promise<{ width: number; height: number }> => {
  const known = element.naturalWidth && element.naturalHeight
    ? { width: element.naturalWidth, height: element.naturalHeight }
    : null;
  const size = known ?? await probeImageNaturalSize(src);
  if (!size) throw new Error('Could not determine the image dimensions.');
  return size;
};

export const outpaintGeometry = (
  before: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'>,
  mode: OutpaintMode,
  source: { width: number; height: number },
  result: { width: number; height: number }
): Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'> => {
  const scaleX = result.width / source.width;
  const scaleY = result.height / source.height;
  const width = before.width * scaleX;
  const height = before.height * scaleY;
  const addedX = width - before.width;
  const addedY = height - before.height;
  const center = mode === 'make-square' || mode.startsWith('zoom-');
  return {
    x: mode === 'left' ? before.x - addedX : center ? before.x - addedX / 2 : before.x,
    y: mode === 'top' ? before.y - addedY : center ? before.y - addedY / 2 : before.y,
    width,
    height,
  };
};

export const prepareAiOutpaint = async ({
  fetch,
  store,
  elementId,
  mode,
  prompt,
}: {
  fetch: FetchLike;
  store: Store;
  elementId: string;
  mode: OutpaintMode;
  prompt?: string;
}): Promise<OutpaintCandidate> => {
  const before = getElement(store, elementId);
  if (!before?.src) throw new Error('No image');
  const outputIndex = store.getState().currentOutput;
  const history = store.getState().history;
  const response = await fetch('/media/outpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: before.src,
      mode,
      ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Image expansion failed'));
  const data = await response.json() as { url?: string; fileId?: string };
  if (!data.url) throw new Error('Image expansion returned no result.');
  const [sourceNatural, resultNatural] = await Promise.all([
    probe(before, before.src),
    probeImageNaturalSize(data.url),
  ]);
  if (!resultNatural) throw new Error('Could not determine the expanded image dimensions.');
  const candidate: OutpaintCandidate = {
    kind: 'image',
    before,
    outputIndex,
    history,
    sourceUrl: before.src,
    assetUrl: data.url,
    fileId: data.fileId,
    sourceNatural,
    resultNatural,
    mode,
  };
  if (!candidateIsCurrent(store, candidate)) {
    throw new Error('The design changed while this expansion was being prepared. Please generate it again.');
  }
  return candidate;
};

export const applyAiOutpaint = ({
  store,
  candidate,
}: {
  store: Store;
  candidate: OutpaintCandidate;
}): boolean => {
  if (candidate.kind !== 'image' || !candidate.mode || !candidateIsCurrent(store, candidate)) return false;
  store.getState().updateElement(candidate.before.id, {
    ...outpaintGeometry(candidate.before, candidate.mode, candidate.sourceNatural, candidate.resultNatural),
    src: candidate.assetUrl,
    fileId: candidate.fileId,
    crop: undefined,
    originalSrc: undefined,
    originalFileId: undefined,
    smartFilters: undefined,
    maskSrc: undefined,
    maskFileId: undefined,
    maskEnabled: undefined,
    naturalWidth: candidate.resultNatural.width,
    naturalHeight: candidate.resultNatural.height,
  });
  store.getState().pushHistory('Expand image');
  return true;
};

export const aiOutpaint = async (
  args: { fetch: FetchLike; store: Store; elementId: string },
  mode: OutpaintMode,
  prompt?: string
): Promise<void> => {
  const candidate = await prepareAiOutpaint({ ...args, mode, prompt });
  if (!applyAiOutpaint({ store: args.store, candidate })) {
    throw new Error('The design changed before this expansion could be applied. Please generate it again.');
  }
};

export const prepareWholePageOutpaint = async ({
  fetch,
  store,
  elementId,
  targetWidth,
  targetHeight,
  prompt,
}: {
  fetch: FetchLike;
  store: Store;
  elementId: string;
  targetWidth: number;
  targetHeight: number;
  prompt?: string;
}): Promise<OutpaintCandidate> => {
  const before = getElement(store, elementId);
  if (!before?.src) throw new Error('No image');
  const state = store.getState();
  const outputIndex = state.currentOutput;
  const output = state.doc.outputs[outputIndex] as DesignerOutput;
  if (!output || !('children' in output)) throw new Error('Whole-page expansion requires a static design.');
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) ||
    targetWidth < output.width || targetHeight < output.height ||
    (targetWidth === output.width && targetHeight === output.height) ||
    targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    throw new Error(`Choose larger page dimensions up to ${MAX_DIMENSION} pixels.`);
  }
  if (targetWidth * targetHeight > 25_000_000) {
    throw new Error('Whole-page expansion is limited to 25 million pixels. Choose smaller page dimensions.');
  }

  const history = state.history;
  const image = await loadMaskImage(before.src);
  const sourceNatural = before.naturalWidth && before.naturalHeight
    ? { width: before.naturalWidth, height: before.naturalHeight }
    : { width: image.naturalWidth, height: image.naturalHeight };
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the expanded page preview.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  const geometry = computeMediaDraw({
    sourceWidth: sourceNatural.width,
    sourceHeight: sourceNatural.height,
    targetWidth: before.width,
    targetHeight: before.height,
    crop: before.crop,
    fitMode: before.fitMode,
    focalPoint: before.focalPoint,
  });
  const offsetX = (targetWidth - output.width) / 2;
  const offsetY = (targetHeight - output.height) / 2;
  const destination = {
    x: offsetX + before.x + geometry.destination.x,
    y: offsetY + before.y + geometry.destination.y,
    width: geometry.destination.width,
    height: geometry.destination.height,
  };
  // Other layers are repositioned over the result on Apply, never baked into the inpaint source.
  context.drawImage(
    image,
    geometry.source.x,
    geometry.source.y,
    geometry.source.width,
    geometry.source.height,
    destination.x,
    destination.y,
    destination.width,
    destination.height
  );
  const mask = document.createElement('canvas');
  mask.width = targetWidth;
  mask.height = targetHeight;
  const maskContext = mask.getContext('2d');
  if (!maskContext) throw new Error('Could not create the expansion mask.');
  maskContext.fillStyle = '#ffffff';
  maskContext.fillRect(0, 0, targetWidth, targetHeight);
  maskContext.fillStyle = '#000000';
  maskContext.fillRect(destination.x, destination.y, destination.width, destination.height);

  let imageData: string;
  let maskData: string;
  try {
    imageData = canvas.toDataURL('image/png');
    maskData = mask.toDataURL('image/png');
  } catch {
    throw new Error('The expanded page is too large for this browser. Choose smaller page dimensions.');
  }
  if (!imageData.startsWith('data:image/png') || !maskData.startsWith('data:image/png') ||
    imageData.length > 45 * 1024 * 1024 || maskData.length > 45 * 1024 * 1024) {
    throw new Error('The expanded page exceeds the 45 MB upload limit. Choose smaller page dimensions.');
  }
  const response = await fetch('/media/inpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: imageData,
      maskUrl: maskData,
      prompt: prompt?.trim() || 'Extend the image naturally beyond its borders, seamlessly matching the existing style, lighting, colors, and content.',
    }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Page expansion failed'));
  const data = await response.json() as { url?: string; fileId?: string };
  if (!data.url) throw new Error('Page expansion returned no result.');
  const candidate: OutpaintCandidate = {
    kind: 'page',
    before,
    outputIndex,
    history,
    sourceUrl: before.src,
    assetUrl: data.url,
    fileId: data.fileId,
    sourceNatural,
    resultNatural: { width: targetWidth, height: targetHeight },
    targetWidth,
    targetHeight,
  };
  if (!candidateIsCurrent(store, candidate)) {
    throw new Error('The design changed while this page expansion was being prepared. Please generate it again.');
  }
  return candidate;
};

export const applyWholePageOutpaint = ({
  store,
  candidate,
}: {
  store: Store;
  candidate: OutpaintCandidate;
}): boolean => {
  if (candidate.kind !== 'page' || !candidate.targetWidth || !candidate.targetHeight ||
    !candidateIsCurrent(store, candidate)) return false;
  const state = store.getState();
  const output = state.doc.outputs[candidate.outputIndex] as DesignerOutput;
  const width = candidate.targetWidth;
  const height = candidate.targetHeight;
  const offsetX = (width - output.width) / 2;
  const offsetY = (height - output.height) / 2;
  const children = output.children.map((element) => element.id === candidate.before.id
    ? {
        ...element,
        src: candidate.assetUrl,
        fileId: candidate.fileId,
        x: 0,
        y: 0,
        width,
        height,
        fitMode: 'fill' as const,
        crop: undefined,
        originalSrc: undefined,
        originalFileId: undefined,
        smartFilters: undefined,
        maskSrc: undefined,
        maskFileId: undefined,
        maskEnabled: undefined,
        naturalWidth: width,
        naturalHeight: height,
      }
    : { ...element, x: element.x + offsetX, y: element.y + offsetY });
  const outputs = [...state.doc.outputs];
  outputs[candidate.outputIndex] = {
    ...output,
    formatId: 'custom',
    name: `${width}×${height}`,
    width,
    height,
    children,
  };
  state.setDoc({ ...state.doc, outputs });
  store.getState().pushHistory('Expand page');
  return true;
};
