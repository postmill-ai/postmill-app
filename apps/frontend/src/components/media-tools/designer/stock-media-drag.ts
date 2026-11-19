import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import type { StockMediaSelection } from '@postmill-ai/frontend/components/media-tools/stock.types';
import type { FileItem } from '@postmill-ai/frontend/components/files/file-manager';
import type { DesignerMediaKind } from './use-designer-media-insertion';

export const STOCK_MEDIA_DRAG_MIME = 'application/x-postmill-stock-media';
export const STILL_IMAGE_DRAG_MIME = 'application/x-postmill-still-image';

const kinds = new Set<DesignerMediaKind>(['image', 'sticker', 'vector', 'icon', 'video', 'audio']);
const mediaTypes = new Set(['image', 'video', 'audio']);

export const mediaItemFromStockSelection = (item: StockMediaSelection): MediaSelectorItem => ({
  source: 'stock',
  url: item.url,
  width: item.width,
  height: item.height,
  thumbnail: item.thumbnail,
  type: item.type,
  name: item.name,
  stockSource: item.source,
  attribution: item.attribution,
  downloadLocation: item.downloadLocation,
});

export const mediaItemFromFileSelection = (file: FileItem): MediaSelectorItem => {
  const rawType = file.metadata?.mimeType || file.metadata?.mime || file.type;
  const normalizedType = rawType.split('/')[0];
  const extensionType = /\.(mp3|wav|ogg|m4a)$/i.test(file.name || '') ? 'audio' : undefined;
  const dimensions = file.metadata?.dimensions;
  return {
    source: 'file',
    url: file.path,
    fileId: file.id,
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
    thumbnail: file.thumbnail || undefined,
    type: (mediaTypes.has(normalizedType) ? normalizedType : extensionType || file.type) as MediaSelectorItem['type'],
    name: file.name,
  };
};

export const isStillImageMedia = (kind: DesignerMediaKind, item: MediaSelectorItem) =>
  (kind === 'image' || kind === 'sticker') && item.type === 'image';

export const writeDesignerMediaDrag = (
  dataTransfer: Pick<DataTransfer, 'setData'>,
  kind: DesignerMediaKind,
  item: MediaSelectorItem
) => {
  dataTransfer.setData(STOCK_MEDIA_DRAG_MIME, JSON.stringify({
    version: 1,
    kind,
    item,
  }));
  if (isStillImageMedia(kind, item)) {
    dataTransfer.setData(STILL_IMAGE_DRAG_MIME, '1');
  }
};

export const hasStillImageDrag = (
  dataTransfer: Pick<DataTransfer, 'types'>
) => Array.from(dataTransfer.types).includes(STILL_IMAGE_DRAG_MIME);

export const writeStockMediaDrag = (
  dataTransfer: Pick<DataTransfer, 'setData'>,
  kind: DesignerMediaKind,
  item: StockMediaSelection
) => writeDesignerMediaDrag(dataTransfer, kind, mediaItemFromStockSelection(item));

export const readStockMediaDrag = (
  dataTransfer: Pick<DataTransfer, 'getData'>
): { kind: DesignerMediaKind; item: MediaSelectorItem } | null => {
  const raw = dataTransfer.getData(STOCK_MEDIA_DRAG_MIME);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { version?: unknown; kind?: unknown; item?: Record<string, unknown> };
    const item = payload.item;
    if (
      payload.version !== 1
      || typeof payload.kind !== 'string'
      || !kinds.has(payload.kind as DesignerMediaKind)
      || !item
      || (item.source !== 'stock' && item.source !== 'file')
      || typeof item.url !== 'string'
      || !item.url
      || typeof item.type !== 'string'
      || !mediaTypes.has(item.type)
      || typeof item.width !== 'number'
      || !Number.isFinite(item.width)
      || item.width < 0
      || typeof item.height !== 'number'
      || !Number.isFinite(item.height)
      || item.height < 0
    ) return null;

    const optionalString = (value: unknown) => typeof value === 'string' ? value : undefined;
    return {
      kind: payload.kind as DesignerMediaKind,
      item: {
        source: item.source,
        url: item.url,
        width: item.width,
        height: item.height,
        type: item.type as MediaSelectorItem['type'],
        fileId: optionalString(item.fileId),
        thumbnail: optionalString(item.thumbnail),
        name: optionalString(item.name),
        stockSource: optionalString(item.stockSource),
        attribution: item.attribution && typeof item.attribution === 'object' && !Array.isArray(item.attribution)
          ? item.attribution as Record<string, unknown>
          : undefined,
        downloadLocation: item.downloadLocation === null ? null : optionalString(item.downloadLocation),
      },
    };
  } catch {
    return null;
  }
};
