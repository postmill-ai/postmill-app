// Frontend mirror of libraries/nestjs-libraries/src/media/stock/stock.types.ts
// Keep in sync with the backend source of truth.

export interface StockItemBase {
  id: string;
  url: string;
  thumbUrl: string;
  description: string | null;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  source: string;
  width: number;
  height: number;
  license?: string;
  attribution?: Record<string, unknown>;
}

export interface StockPhotoItem extends StockItemBase {
  downloadLocation: string | null;
  color: string | null;
}

// Vectors reuse the photo shape; source is typically 'pixabay'.
export type StockVectorItem = StockItemBase;

export interface StockVideoItem extends StockItemBase {
  duration: number;
}

export interface StockStickerItem extends StockItemBase {
  mp4Url?: string;
  isSticker: true;
}

export interface StockIconItem extends StockItemBase {
  prefix: string;
  iconName: string;
  license: string;
  licenseUrl?: string;
}

export interface StockAudioItem {
  id: string;
  url: string;
  /** Stable download URL for saving (the streaming `url` carries an expiring token). */
  downloadUrl?: string;
  name: string;
  duration: number;
  author: string;
  source?: string;
  license?: string;
  attribution?: Record<string, unknown>;
}

export interface StockSearchResponse<T> {
  results: T[];
  page: number;
  totalPages: number;
  configured: boolean;
  source?: string;
}

export type StockPreviewableItem =
  | StockPhotoItem
  | StockVectorItem
  | StockVideoItem
  | StockStickerItem
  | StockIconItem;

export const stockSourceLabel = (source: string): string =>
  ({
    unsplash: 'Unsplash',
    pexels: 'Pexels',
    pixabay: 'Pixabay',
    giphy: 'GIPHY',
    iconify: 'Iconify',
    magnific: 'Magnific',
  }[source] || source);
