import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
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
  if (!natural) throw new Error('Image decode failed');
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
  } finally {
    if (!replaced && item.fileId) {
      const response = await fetch(`/files/${item.fileId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Uploaded image cleanup failed');
    }
  }
};
