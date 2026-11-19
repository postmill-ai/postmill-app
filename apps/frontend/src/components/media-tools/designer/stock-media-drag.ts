import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import type { StockMediaSelection } from '@postmill-ai/frontend/components/media-tools/stock.types';
import type { DesignerMediaKind } from './use-designer-media-insertion';

export const STOCK_MEDIA_DRAG_MIME = 'application/x-postmill-stock-media';

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

export const writeStockMediaDrag = (
  dataTransfer: Pick<DataTransfer, 'setData'>,
  kind: DesignerMediaKind,
  item: StockMediaSelection
) => {
  dataTransfer.setData(STOCK_MEDIA_DRAG_MIME, JSON.stringify({
    version: 1,
    kind,
    item: mediaItemFromStockSelection(item),
  }));
};

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
