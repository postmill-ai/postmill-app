import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import type Konva from 'konva';
import type { DesignerOutput, VideoOutput } from './designer.store';
import { probeImageNaturalSize } from './elements';
import { replaceStaticImage } from './image-replacement';
import { replaceClipImage, type ClipMediaTarget } from './clip-media';
import { MAX_UPLOAD_BYTES } from './export-format';
import type { MediaImageItem } from './insert-image';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ImageDropTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'clip'; target: ClipMediaTarget };

export const imageDropTargetById = (store: Store, id: string): ImageDropTarget | null => {
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput];
  if (state.doc.mode === 'video') {
    for (const track of (output as VideoOutput | undefined)?.tracks || []) {
      if (track.locked || (track.type !== 'image' && track.type !== 'sticker')) continue;
      const clip = track.clips.find((item) => item.id === id);
      if (clip?.src && clip.mediaType !== 'video') {
        return {
          kind: 'clip',
          target: { outputIndex: state.currentOutput, trackId: track.id, clipId: clip.id },
        };
      }
    }
    return null;
  }

  const element = (output as DesignerOutput | undefined) && 'children' in output
    ? pageChildren(output as DesignerOutput, state.currentPage).find((item) => item.id === id)
    : undefined;
  return element?.type === 'image' && element.src && !element.locked && !element.hidden
    ? { kind: 'element', elementId: element.id }
    : null;
};

export interface ImageDropResolution {
  target: ImageDropTarget;
  bounds: { x: number; y: number; width: number; height: number };
}

export const imageDropNodeBounds = (node: Konva.Node) => {
  const width = node.width();
  const height = node.height();
  if (width > 0 && height > 0) {
    const transform = node.getAbsoluteTransform();
    const points = [
      transform.point({ x: 0, y: 0 }),
      transform.point({ x: width, y: 0 }),
      transform.point({ x: width, y: height }),
      transform.point({ x: 0, y: height }),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  return node.getClientRect({ skipShadow: true, skipStroke: true });
};

export const resolveImageDropTarget = ({
  stage,
  store,
  clientX,
  clientY,
  containerRect,
}: {
  stage: Konva.Stage | null;
  store: Store;
  clientX: number;
  clientY: number;
  containerRect: DOMRect;
}): ImageDropResolution | null => {
  let node = stage?.getIntersection({
    x: clientX - containerRect.left,
    y: clientY - containerRect.top,
  }) as Konva.Node | null | undefined;
  while (node) {
    const id = node.id();
    const target = id ? imageDropTargetById(store, id) : null;
    if (target) {
      const bounds = imageDropNodeBounds(node);
      return { target, bounds };
    }
    node = node.getParent();
  }
  return null;
};

export const isReplaceableImageMime = (type: string) =>
  type.startsWith('image/') && type !== 'image/svg+xml';

export const uploadDroppedImage = async (
  fetch: Fetch,
  file: File,
  probe = probeImageNaturalSize
): Promise<MediaImageItem> => {
  const formData = new FormData();
  formData.append('file', file);
  const endpoint = file.size > MAX_UPLOAD_BYTES ? '/files/upload-server' : '/files/upload-simple';
  const response = await fetch(endpoint, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Upload failed');
  const data = await response.json() as { id: string; path: string };
  const natural = await probe(data.path);
  if (!natural) {
    const cleanup = await fetch(`/files/${data.id}`, { method: 'DELETE' }).catch(() => null);
    if (!cleanup?.ok) throw new UploadedImageCleanupError();
    throw new Error('Image decode failed');
  }
  return {
    url: data.path,
    fileId: data.id,
    width: natural.width,
    height: natural.height,
  };
};

export const replaceImageAtDropTarget = (
  store: Store,
  target: ImageDropTarget,
  item: MediaImageItem
): Promise<boolean> => target.kind === 'element'
  ? replaceStaticImage({ store, elementId: target.elementId, item })
  : replaceClipImage({ store, target: target.target, item });

export class UploadedImageCleanupError extends Error {
  constructor() {
    super('Uploaded image cleanup failed');
    this.name = 'UploadedImageCleanupError';
  }
}

export class ImageReplacementApplyError extends Error {
  constructor() {
    super('Image replacement failed');
    this.name = 'ImageReplacementApplyError';
  }
}

export const replaceMediaImageAtDropTarget = async ({
  store,
  target,
  item,
  probe = probeImageNaturalSize,
}: {
  store: Store;
  target: ImageDropTarget;
  item: MediaImageItem;
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}): Promise<boolean> => {
  let resolved = item;
  if (!item.width || !item.height) {
    const natural = await probe(item.url);
    if (!natural) throw new Error('Image decode failed');
    resolved = { ...item, ...natural };
  }
  try {
    return await replaceImageAtDropTarget(store, target, resolved);
  } catch {
    throw new ImageReplacementApplyError();
  }
};

export const imageDropErrorMessage = (
  error: unknown,
  t: (key: string, fallback: string) => string
): string => {
  if (error instanceof UploadedImageCleanupError) {
    return t(
      'designer_image_cleanup_failed',
      'The image was uploaded, but the replacement could not be applied. The file remains in your library.'
    );
  }
  if (error instanceof Error && error.message === 'Image decode failed') {
    return t('failed_to_load_dropped_image', 'Failed to load dropped image');
  }
  if (error instanceof ImageReplacementApplyError) {
    return t('designer_image_replace_failed', 'That image replacement could not be applied');
  }
  return t('failed_to_upload_file', 'Failed to upload file');
};

export const replaceUploadedImageAtDropTarget = async ({
  fetch,
  store,
  target,
  item,
}: {
  fetch: Fetch;
  store: Store;
  target: ImageDropTarget;
  item: MediaImageItem;
}): Promise<boolean> => {
  let replaced = false;
  try {
    replaced = await replaceImageAtDropTarget(store, target, item);
    return replaced;
  } catch {
    throw new ImageReplacementApplyError();
  } finally {
    if (!replaced && item.fileId) {
      const response = await fetch(`/files/${item.fileId}`, { method: 'DELETE' }).catch(() => null);
      if (!response?.ok) throw new UploadedImageCleanupError();
    }
  }
};
